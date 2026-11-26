// 正式站巡檢：資料新鮮度、每日重建不變量、站外搜尋、轉發密鑰、LLM 複核。
// 有失敗就以非零結束碼結束，讓 GitHub 對排程失敗發出通知；警告只寫進 job summary。
import { setTimeout as sleep } from "node:timers/promises";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const SITE = "https://taiwan-intel-dashboard.pages.dev";
export const RELAY = "https://video-mcp-a1.tail930e77.ts.net/gnews";
const MAX_AGE_MINUTES = 120; // 75 分鐘內由 refresh-watchdog 補觸發；這裡只抓真正停擺
const DAILY_MAX_HOURS = 34; // 補跑最晚 20:30Z 才派出、再約 30 分鐘跑完，真實間隔可達約 32 小時；超過 34 代表 cron 與補跑都沒發生
const DAILY_MARKER_DATASET = "tfda-noncompliant-food";
const FUTURE_TOLERANCE_MS = 5 * 60_000;

export function evaluateProductionHealth({ provenance, searchUpstreams, relayStatus, now = Date.now() }) {
  const failures = [];
  const warnings = [];
  // 比較用原始值（四捨五入只用於顯示），未來超過容忍度的時間戳視為異常（與 refresh-watchdog 相同 5 分鐘）。
  const generated = Date.parse(provenance?.generatedAt);
  const ageMs = now - generated;
  if (!Number.isFinite(ageMs)) failures.push("正式站資料時間不明（讀不到 provenance 或格式錯誤）");
  else if (ageMs < -FUTURE_TOLERANCE_MS) failures.push(`正式站資料時間在未來 ${Math.round(-ageMs / 60000)} 分鐘，時間戳異常`);
  else if (ageMs > MAX_AGE_MINUTES * 60000) failures.push(`正式站資料 ${Math.round(ageMs / 60000)} 分鐘未更新（上限 ${MAX_AGE_MINUTES} 分鐘）`);
  const sources = Array.isArray(provenance?.sources) ? provenance.sources : [];
  const attempted = Date.parse(sources.find((s) => s?.datasetId === DAILY_MARKER_DATASET)?.lastAttemptAt ?? "");
  const dailyMs = now - attempted;
  if (!Number.isFinite(dailyMs)) failures.push("每日重建時間不明（找不到 TFDA lastAttemptAt）");
  else if (dailyMs < -FUTURE_TOLERANCE_MS) failures.push(`每日重建時間在未來 ${(-dailyMs / 3600e3).toFixed(1)} 小時，時間戳異常`);
  else if (dailyMs > DAILY_MAX_HOURS * 3600e3) {
    failures.push(`每日重建 ${(dailyMs / 3600e3).toFixed(1)} 小時未執行（上限 ${DAILY_MAX_HOURS} 小時；cron 與接力補跑都沒發生）`);
  }
  const okSearches = (searchUpstreams || []).filter((u) => u === "ok").length;
  if (!okSearches) failures.push(`站外搜尋全部失敗：${JSON.stringify(searchUpstreams)}`);
  else if (okSearches < (searchUpstreams || []).length) warnings.push(`站外搜尋部分失敗：${JSON.stringify(searchUpstreams)}`);
  if (relayStatus !== 401) failures.push(`轉發服務不帶密鑰應回 401，實際 ${relayStatus || "連線失敗"}`);
  const gate = provenance?.pipeline?.twnews?.llmGate || {};
  if (gate.failedBatches > 0 || gate.skippedBatches > 0) {
    warnings.push(`LLM 複核 failedBatches=${gate.failedBatches} skippedBatches=${gate.skippedBatches}（該批照規則保留）`);
  }
  return { ok: failures.length === 0, failures, warnings };
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const provenance = await fetchJson(`${SITE}/data/provenance.json`).catch(() => null);
  const searchUpstreams = [];
  for (const [i, q] of ["詐騙", "車禍"].entries()) {
    if (i) await sleep(31_000); // 間隔避免自造限流
    const params = new URLSearchParams({ q, days: "7" });
    searchUpstreams.push(await fetchJson(`${SITE}/api/search?${params}`).then((j) => j.upstream).catch((e) => `error:${e.message}`));
  }
  const relayStatus = await fetch(`${RELAY}?${new URLSearchParams({ q: "詐騙", days: "7" })}`, { signal: AbortSignal.timeout(30_000) })
    .then((r) => r.status).catch(() => 0);
  const result = evaluateProductionHealth({ provenance, searchUpstreams, relayStatus });
  const lines = [
    `## 正式站巡檢：${result.ok ? "正常" : "異常"}`,
    ...result.failures.map((f) => `- ❌ ${f}`),
    ...result.warnings.map((w) => `- ⚠️ ${w}`),
  ];
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`PRODUCTION_HEALTH_ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
