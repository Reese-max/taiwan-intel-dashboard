// Backup trigger for delayed or dropped GitHub Actions schedule events.
// A scheduled invocation checks the canonical published snapshot before it
// considers dispatching the existing, audited update-and-deploy workflow.

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { loadContract } from "./operating-state.mjs";

export const EXPECTED_REPO = "Reese-max/taiwan-intel-dashboard";
export const PROVENANCE_URL = "https://taiwan-intel-dashboard.pages.dev/data/provenance.json";
export const WORKFLOW_NAME = "update-and-deploy.yml";
export const MAX_AGE_MINUTES = 75;
export const RUN_COOLDOWN_MINUTES = 45;
const ACTIVE_STATUSES = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);

function timestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function decideRefreshWatchdog({
  now = Date.now(),
  generatedAt,
  runs = [],
  state,
  maxAgeMinutes = MAX_AGE_MINUTES,
  cooldownMinutes = RUN_COOLDOWN_MINUTES,
} = {}) {
  if (!["ACTIVE", "DEGRADED"].includes(state)) {
    return { action: "skip", reason: "operating-state-blocks-mutation", state };
  }
  if (!Number.isFinite(now) || maxAgeMinutes <= 0 || cooldownMinutes <= 0) {
    return { action: "error", reason: "invalid-watchdog-configuration" };
  }
  const snapshotTime = timestamp(generatedAt);
  if (snapshotTime === null || snapshotTime > now + 5 * 60_000) {
    return { action: "error", reason: "invalid-canonical-generatedAt" };
  }
  const ageMinutes = Math.round(((now - snapshotTime) / 60_000) * 10) / 10;
  if (ageMinutes <= maxAgeMinutes) {
    return { action: "skip", reason: "canonical-fresh", ageMinutes };
  }
  if (!Array.isArray(runs)) {
    return { action: "error", reason: "invalid-workflow-runs" };
  }
  if (runs.some((run) => ACTIVE_STATUSES.has(run?.status))) {
    return { action: "skip", reason: "update-already-active", ageMinutes };
  }
  const latestRun = runs
    .map((run) => timestamp(run?.created_at))
    .filter((value) => value !== null)
    .sort((a, b) => b - a)[0];
  if (latestRun !== undefined && now - latestRun < cooldownMinutes * 60_000) {
    return { action: "skip", reason: "recent-update-run", ageMinutes };
  }
  return { action: "dispatch", reason: "canonical-stale-and-no-recent-run", ageMinutes };
}

async function readJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache", ...headers },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  return response.json();
}

export async function runWatchdog({
  dispatch = false,
  token = process.env.GITHUB_TOKEN,
  repository = process.env.GITHUB_REPOSITORY || EXPECTED_REPO,
  now = Date.now(),
} = {}) {
  if (repository !== EXPECTED_REPO) throw new Error("unexpected repository");
  const contract = loadContract();
  if (contract.errors.length) throw new Error(`invalid operating-state contract: ${contract.errors.join("; ")}`);
  if (!["ACTIVE", "DEGRADED"].includes(contract.doc.state)) {
    return decideRefreshWatchdog({ now, state: contract.doc.state });
  }

  // The canonical URL is the user-visible publication, not the earlier
  // pipeline-state commit. A successful save-state is not proof of deployment.
  const provenance = await readJson(PROVENANCE_URL);
  const apiHeaders = {
    "User-Agent": "taiwan-intel-dashboard-refresh-watchdog",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const apiBase = `https://api.github.com/repos/${repository}/actions/workflows/${WORKFLOW_NAME}`;
  const runList = await readJson(`${apiBase}/runs?per_page=10`, apiHeaders);
  if (!Array.isArray(runList.workflow_runs)) throw new Error("invalid workflow run list");
  const decision = decideRefreshWatchdog({
    now,
    generatedAt: provenance.generatedAt,
    runs: runList.workflow_runs,
    state: contract.doc.state,
  });
  if (decision.action !== "dispatch" || !dispatch) return decision;
  if (!token || process.env.GITHUB_REPOSITORY !== EXPECTED_REPO) {
    throw new Error("dispatch requires the expected repository and GITHUB_TOKEN");
  }
  const response = await fetch(`${apiBase}/dispatches`, {
    method: "POST",
    headers: {
      ...apiHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main", inputs: { mode: "hourly", renorm_intl: "false" } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 204) throw new Error(`workflow dispatch failed: HTTP ${response.status}`);
  return { ...decision, dispatched: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runWatchdog({ dispatch: process.argv.includes("--dispatch") })
    .then((result) => {
      console.log(`REFRESH_WATCHDOG ${JSON.stringify(result)}`);
      if (result.action === "error") process.exitCode = 1;
    })
    .catch((error) => {
      console.error(`REFRESH_WATCHDOG_ERROR ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
