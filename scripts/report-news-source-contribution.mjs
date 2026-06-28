import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatNewsSourceContributionReport } from "./lib/news-source-contribution.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const provenancePath = join(ROOT, "public", "data", "provenance.json");

function readProvenance() {
  if (!existsSync(provenancePath)) {
    throw new Error("找不到 public/data/provenance.json，請先執行 npm run refresh:news 或完整 refresh。");
  }
  return JSON.parse(readFileSync(provenancePath, "utf8"));
}

try {
  const provenance = readProvenance();
  const twnews = provenance?.pipeline?.twnews || {};
  const rows = twnews.sourceContribution || [];
  if (!rows.length) {
    throw new Error("provenance.json 尚無 pipeline.twnews.sourceContribution，請先重新執行 npm run refresh:news。");
  }
  console.log(
    formatNewsSourceContributionReport(
      {
        rows,
        totals: twnews.sourceContributionTotals,
        lowContributionFeeds: twnews.lowContributionFeeds,
      },
      { limit: Number(process.env.NEWS_SOURCE_REPORT_LIMIT) || 50 },
    ),
  );
} catch (error) {
  console.error(`新聞來源貢獻報表失敗：${error.message}`);
  process.exitCode = 1;
}
