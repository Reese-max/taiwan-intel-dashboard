// Keep the approved data pipeline moving when GitHub's best-effort schedule
// events are delayed. This job runs after the current fetch/deploy attempt and
// dispatches one successor at the next 30-minute mark, unless one is queued.
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const EXPECTED_REPO = "Reese-max/taiwan-intel-dashboard";
export const WORKFLOW_NAME = "update-and-deploy.yml";
export const REFRESH_INTERVAL_MS = 30 * 60_000;
export const PROVENANCE_URL = "https://taiwan-intel-dashboard.pages.dev/data/provenance.json";
// TFDA 只在每日重建抓取；lastAttemptAt 失敗也會更新，來源本身壞掉時不會每輪都改派 daily。
const DAILY_MARKER_DATASET = "tfda-noncompliant-food";
const DAILY_OVERDUE_MS = 20 * 60 * 60_000;
// 只在原本每日重建的時段（UTC 18:30–20:30，台北 02:30–04:30）補跑：daily 失敗不發布時 provenance 不變，
// 時窗外一律 hourly，每日來源持續壞掉也最多多試 4 輪，不會卡住每 30 分鐘的更新。
const DAILY_WINDOW_UTC_MINUTES = [18 * 60 + 30, 20 * 60 + 30];
const ACTIVE_STATUSES = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);

export function nextRefreshDelay({ createdAt, now = Date.now() }) {
  const started = Date.parse(createdAt);
  if (!Number.isFinite(started) || !Number.isFinite(now) || started > now + 5 * 60_000) {
    throw new Error("invalid workflow creation time");
  }
  return Math.max(0, started + REFRESH_INTERVAL_MS - now);
}

// GitHub 的 30 18 cron 會延遲數小時或被丟棄（2026-11-24 實測未送達）；每日來源逾期時由接力補跑 daily。
export function nextRefreshMode(provenance, now) {
  const sources = Array.isArray(provenance?.sources) ? provenance.sources : [];
  const attempted = Date.parse(sources.find((s) => s?.datasetId === DAILY_MARKER_DATASET)?.lastAttemptAt ?? "");
  const at = new Date(now);
  const minute = at.getUTCHours() * 60 + at.getUTCMinutes();
  const inWindow = minute >= DAILY_WINDOW_UTC_MINUTES[0] && minute < DAILY_WINDOW_UTC_MINUTES[1];
  return inWindow && Number.isFinite(attempted) && now - attempted > DAILY_OVERDUE_MS ? "daily" : "hourly";
}

async function readProvenance(fetchImpl) {
  try {
    // 公開快照，不帶 GitHub token。
    const response = await fetchImpl(PROVENANCE_URL, { signal: AbortSignal.timeout(15_000) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export function hasOtherActiveRun(runs, currentRunId) {
  if (!Array.isArray(runs) || !Number.isInteger(currentRunId) || currentRunId <= 0) {
    throw new Error("invalid workflow run list or current run ID");
  }
  return runs.some((run) => Number(run?.id) !== currentRunId && ACTIVE_STATUSES.has(run?.status));
}

async function githubRequest(url, { token, fetchImpl, sleepImpl, method = "GET", body } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchImpl(url, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "taiwan-intel-dashboard-next-refresh",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await sleepImpl(1000 * 2 ** attempt);
        continue;
      }
      if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`);
      return response;
    } catch (error) {
      if (attempt === 2 || /^GitHub API HTTP 4\d\d$/.test(String(error?.message))) throw error;
      await sleepImpl(1000 * 2 ** attempt);
    }
  }
}

export async function dispatchNextRefresh({
  token = process.env.GITHUB_TOKEN,
  repository = process.env.GITHUB_REPOSITORY,
  runId = Number(process.env.GITHUB_RUN_ID),
  now = () => Date.now(),
  fetchImpl = fetch,
  sleepImpl = sleep,
} = {}) {
  if (repository !== EXPECTED_REPO || !token || !Number.isInteger(runId) || runId <= 0) {
    throw new Error("next refresh requires the expected repository, run ID and GITHUB_TOKEN");
  }
  const apiBase = `https://api.github.com/repos/${repository}`;
  const current = await (await githubRequest(`${apiBase}/actions/runs/${runId}`, { token, fetchImpl, sleepImpl })).json();
  if (Number(current.id) !== runId) throw new Error("current workflow run ID mismatch");
  const waitMs = nextRefreshDelay({ createdAt: current.created_at, now: now() });
  if (waitMs > 0) await sleepImpl(waitMs);

  // A normal schedule, a code release or another watchdog dispatch may already
  // be queued. Let that run proceed instead of replacing it in the group.
  const workflowBase = `${apiBase}/actions/workflows/${WORKFLOW_NAME}`;
  const list = await (await githubRequest(`${workflowBase}/runs?per_page=10`, { token, fetchImpl, sleepImpl })).json();
  if (hasOtherActiveRun(list.workflow_runs, runId)) {
    return { action: "skip", reason: "another-update-active", waitMs };
  }

  const mode = nextRefreshMode(await readProvenance(fetchImpl), now());
  const response = await githubRequest(`${workflowBase}/dispatches`, {
    token,
    fetchImpl,
    sleepImpl,
    method: "POST",
    body: { ref: "main", inputs: { mode, renorm_intl: "false" } },
  });
  if (response.status !== 204) throw new Error(`unexpected dispatch response HTTP ${response.status}`);
  return { action: "dispatch", waitMs, ...(mode === "daily" ? { mode } : {}) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  dispatchNextRefresh()
    .then((result) => console.log(`NEXT_REFRESH ${JSON.stringify(result)}`))
    .catch((error) => {
      console.error(`NEXT_REFRESH_ERROR ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
