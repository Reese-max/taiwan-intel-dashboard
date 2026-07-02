// 國際新聞風險分布健康稽核。
// 動機：LLM 風險評級會 drift（模型更新／新聞性質變化），且上游 slice/累積若退化會讓
// 低風險事件被洗光。此稽核偵測「明顯病態」而非強制配額——刻意用寬鬆邊界，符合
// 「分布目標是軟引導、不是硬配額」的設計哲學（真爆多起重大事件時不應被誤判失敗）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = join(ROOT, "public", "data", "international.json");

function argValue(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

// 病態邊界（比理想目標寬鬆；理想是 critical 5-10/high 20-30/medium 40-50/low 15-25）。
export function auditRiskDistribution(
  events,
  { highMaxPct = 50, criticalMaxPct = 20, mediumMinPct = 15, lowCheckMin = 20 } = {},
) {
  const list = Array.isArray(events) ? events : [];
  const n = list.length;
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const e of list) if (e && counts[e.riskLevel] !== undefined) counts[e.riskLevel]++;
  const pct = (k) => (n ? (counts[k] / n) * 100 : 0);
  const warnings = [];
  if (n === 0) return { ok: true, total: 0, counts, pct: { critical: 0, high: 0, medium: 0, low: 0 }, warnings: ["無事件可稽核"] };
  if (pct("high") > highMaxPct) warnings.push(`high ${pct("high").toFixed(1)}% > ${highMaxPct}%（疑似高風險洗版復發）`);
  if (pct("critical") > criticalMaxPct) warnings.push(`critical ${pct("critical").toFixed(1)}% > ${criticalMaxPct}%（過度 critical）`);
  if (pct("medium") < mediumMinPct) warnings.push(`medium ${pct("medium").toFixed(1)}% < ${mediumMinPct}%（中間層崩塌）`);
  if (n >= lowCheckMin && counts.low === 0) warnings.push("low = 0（低風險事件被洗光，疑 slice 偏斜或評級過高）");
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
  const result = auditRiskDistribution(events, {
    highMaxPct: Number(argValue("high-max") || process.env.INTL_RISK_HIGH_MAX || 50),
    criticalMaxPct: Number(argValue("critical-max") || process.env.INTL_RISK_CRITICAL_MAX || 20),
    mediumMinPct: Number(argValue("medium-min") || process.env.INTL_RISK_MEDIUM_MIN || 15),
  });
  const p = result.pct;
  console.log(`國際風險分布稽核（${result.total} 筆）：`);
  console.log(`  critical ${result.counts.critical} (${p.critical.toFixed(1)}%) | high ${result.counts.high} (${p.high.toFixed(1)}%) | medium ${result.counts.medium} (${p.medium.toFixed(1)}%) | low ${result.counts.low} (${p.low.toFixed(1)}%)`);
  console.log("  理想：critical 5-10 / high 20-30 / medium 40-50 / low 15-25");
  if (result.ok) {
    console.log("健康：無病態訊號");
  } else {
    console.error("病態訊號：\n  - " + result.warnings.join("\n  - "));
    process.exit(1);
  }
}
