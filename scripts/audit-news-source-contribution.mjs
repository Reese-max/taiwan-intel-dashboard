import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findLowContributionRows } from "./lib/news-source-contribution.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const provenancePath = join(ROOT, "public", "data", "provenance.json");

const rawMin = Number(process.env.NEWS_SOURCE_RAW_MIN) || 10;
const finalMax = Number(process.env.NEWS_SOURCE_FINAL_MAX) || 1;
const strict = process.argv.includes("--strict") || process.env.NEWS_SOURCE_CONTRIBUTION_STRICT === "1";

function readRows() {
  if (!existsSync(provenancePath)) {
    throw new Error("找不到 public/data/provenance.json，請先執行 npm run refresh:news。");
  }
  const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
  return provenance?.pipeline?.twnews?.sourceContribution || [];
}

try {
  const rows = readRows();
  const warnings = findLowContributionRows(rows, { rawMin, finalMax });
  if (!warnings.length) {
    console.log(`新聞來源貢獻 audit passed：無 raw >= ${rawMin} 且 final <= ${finalMax} 的來源`);
  } else {
    for (const row of warnings) {
      const message = `${row.label} 原始 ${row.raw} 則，但最終只貢獻 ${row.finalEvents} 則；請檢查是否被去重、關鍵字過濾，或來源本身不適合。`;
      console.warn(`::warning title=新聞來源低貢獻::${message}`);
    }
    console.log(`新聞來源貢獻 audit warnings：${warnings.length} 個來源低於門檻（raw >= ${rawMin}, final <= ${finalMax}）`);
    if (strict) process.exitCode = 1;
  }
} catch (error) {
  console.error(`新聞來源貢獻 audit 失敗：${error.message}`);
  process.exitCode = 1;
}
