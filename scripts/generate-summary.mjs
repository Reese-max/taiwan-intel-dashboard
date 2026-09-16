import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { summarize } from "./lib/nvidia.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = process.env.FETCH_LIVE_DATA_DIR || join(ROOT, "public", "data");

async function loadData() {
  const domesticPath = join(DATA_DIR, "domestic.json");
  const networkPath = join(DATA_DIR, "network.json");
  const intlPath = join(DATA_DIR, "international.json");

  let domestic = [];
  let clusters = [];
  let international = [];

  // 優先檢查本地檔案是否新鮮（近 24 小時以內），若過舊則自遠端線上快照同步最新事件
  let needRemoteSync = false;
  if (existsSync(domesticPath)) {
    try {
      domestic = JSON.parse(readFileSync(domesticPath, "utf8"));
      const latestTs = Date.parse(domestic[0]?.timestamp || 0);
      if (!Number.isFinite(latestTs) || Date.now() - latestTs > 864e5 * 2) {
        console.log("本地 domestic.json 較舊，從線上儀表板同步最新資料以利摘要生成...");
        needRemoteSync = true;
      }
    } catch {
      needRemoteSync = true;
    }
  } else {
    needRemoteSync = true;
  }

  if (needRemoteSync) {
    try {
      console.log("正在從 taiwan-intel-dashboard.pages.dev 下載今日最新事件與情報網...");
      const [domRes, netRes, intlRes] = await Promise.all([
        fetch("https://taiwan-intel-dashboard.pages.dev/data/domestic.json"),
        fetch("https://taiwan-intel-dashboard.pages.dev/data/network.json"),
        fetch("https://taiwan-intel-dashboard.pages.dev/data/international.json").catch(() => null),
      ]);
      if (domRes.ok) {
        domestic = await domRes.json();
        writeFileSync(domesticPath, JSON.stringify(domestic), "utf8");
      }
      if (netRes.ok) {
        const net = await netRes.json();
        clusters = net.domestic?.clusters || [];
        writeFileSync(networkPath, JSON.stringify(net), "utf8");
      }
      if (intlRes && intlRes.ok) {
        international = await intlRes.json();
        writeFileSync(intlPath, JSON.stringify(international), "utf8");
      }
      console.log(`同步完成：國內事件 ${domestic.length} 則、情報群 ${clusters.length} 個。`);
    } catch (err) {
      console.warn("同步遠端資料失敗，回退使用本地既有快照：", err.message);
    }
  } else {
    if (existsSync(networkPath)) {
      try {
        const net = JSON.parse(readFileSync(networkPath, "utf8"));
        clusters = net.domestic?.clusters || [];
      } catch {}
    }
    if (existsSync(intlPath)) {
      try {
        international = JSON.parse(readFileSync(intlPath, "utf8"));
      } catch {}
    }
  }

  return { domestic, international, clusters };
}

async function main() {
  console.log("=== 產出最新 summary.json (NVIDIA Nemotron 3 Ultra 550B 優先) ===");
  const { domestic, international, clusters } = await loadData();
  console.log(`準備生成摘要：國內 ${domestic.length} 則、國際 ${international.length} 則、情報群 ${clusters.length} 個`);

  const start = Date.now();
  const summary = await summarize({ domestic, international, clusters });
  const costSec = ((Date.now() - start) / 1000).toFixed(1);

  const outPath = join(DATA_DIR, "summary.json");
  writeFileSync(outPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(`\n✅ 成功寫入 ${outPath} (耗時 ${costSec}s)`);
  console.log(`模型：${summary.model}`);
  console.log(`國內摘要：\n${summary.domestic}\n`);
  console.log(`24h 脈動：\n${summary.recent24h}\n`);
  console.log(`趨勢描述：${summary.trend}\n`);
  console.log("分類別重點：", JSON.stringify(summary.byCategory, null, 2));
  console.log(`情報群摘要數量：${Object.keys(summary.clusterSummaries || {}).length} 個`);
}

main().catch((err) => {
  console.error("❌ 生成摘要失敗：", err);
  process.exit(1);
});
