// 國內新聞（domestic）風險分布健康稽核。
// 目的：避免 risk 分布被輸入端或分類邏輯扭曲，偵測明顯病態（例如低風險大量洗版）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = join(ROOT, "public", "data", "domestic.json");

function argValue(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

// 病態邊界：放寬檢核，只阻擋明顯偏斜。
export function auditDomesticRiskDistribution(events, { maxSinglePct = 85, maxLowPct = 75 } = {}) {
  const list = Array.isArray(events) ? events : [];
  const n = list.length;
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const e of list) if (e && counts[e.riskLevel] !== undefined) counts[e.riskLevel]++;
  const pct = (k) => (n ? (counts[k] / n) * 100 : 0);
  const warnings = [];
  if (n === 0) return { ok: true, total: 0, counts, pct: { critical: 0, high: 0, medium: 0, low: 0 }, warnings: ["無事件可稽核"] };

  if (pct("critical") > maxSinglePct) warnings.push(`critical ${pct("critical").toFixed(1)}% > ${maxSinglePct}%`);
  if (pct("high") > maxSinglePct) warnings.push(`high ${pct("high").toFixed(1)}% > ${maxSinglePct}%`);
  if (pct("medium") > maxSinglePct) warnings.push(`medium ${pct("medium").toFixed(1)}% > ${maxSinglePct}%`);
  if (pct("low") > maxSinglePct || pct("low") > maxLowPct) warnings.push(`low ${pct("low").toFixed(1)}% > ${maxLowPct}%`);

  return {
    ok: warnings.length === 0,
    total: n,
    counts,
    pct: { critical: pct("critical"), high: pct("high"), medium: pct("medium"), low: pct("low") },
    warnings,
  };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = argValue("file") || DATA_FILE;
  let events = [];
  try {
    events = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`無法讀取 ${file}：${e.message}`);
    process.exit(1);
  }
  const result = auditDomesticRiskDistribution(events, {
    maxSinglePct: Number(argValue("single-max") || process.env.DOMESTIC_RISK_SINGLE_MAX || 85),
    maxLowPct: Number(argValue("low-max") || process.env.DOMESTIC_RISK_LOW_MAX || 75),
  });

  const p = result.pct;
  console.log(`國內風險分布稽核（${result.total} 筆）：`);
  console.log(`  critical ${result.counts.critical} (${p.critical.toFixed(1)}%) | high ${result.counts.high} (${p.high.toFixed(1)}%) | medium ${result.counts.medium} (${p.medium.toFixed(1)}%) | low ${result.counts.low} (${p.low.toFixed(1)}%)`);
  if (result.ok) {
    console.log("健康：無病態訊號");
  } else {
    console.error("病態訊號：\n  - " + result.warnings.join("\n  - "));
    process.exit(1);
  }
}
