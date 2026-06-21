// 對現有快照產出情報網 data/network.json（獨立於 live 抓取，供開發/CI 使用）。
// 用法：node scripts/build-network.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { correlateEvents, isNewsLikeEvent } from "./lib/correlate.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// 與 fetch-live 一致：實際服務／部署的資料在 public/data，dist/data 為已 build 副本。
const DATA_DIR = join(ROOT, "public", "data");
const DIST_DATA_DIR = join(ROOT, "dist", "data");

function readEvents(name) {
  const p = join(DATA_DIR, name);
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`讀取 ${name} 失敗：${e.message}`);
    return [];
  }
}

export function buildNetwork(domestic, international, nowIso) {
  const domesticNews = (domestic || []).filter(isNewsLikeEvent);
  const intlNews = (international || []).filter(isNewsLikeEvent);
  return {
    generatedAt: nowIso,
    scopeNote: "情報網僅含新聞類事件（RSS / tw-news），排除政府模板化統計資料",
    domestic: correlateEvents(domesticNews),
    international: correlateEvents(intlNews),
    excluded: {
      domestic: (domestic?.length || 0) - domesticNews.length,
      international: (international?.length || 0) - intlNews.length,
    },
  };
}

function main() {
  const domestic = readEvents("domestic.json");
  const international = readEvents("international.json");
  const net = buildNetwork(domestic, international, new Date().toISOString());

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const json = JSON.stringify(net, null, 2) + "\n";
  writeFileSync(join(DATA_DIR, "network.json"), json);
  if (existsSync(DIST_DATA_DIR)) writeFileSync(join(DIST_DATA_DIR, "network.json"), json);

  const d = net.domestic.stats;
  const i = net.international.stats;
  console.log(
    `情報網已產出 → data/network.json（排除政府模板資料 國內 ${net.excluded.domestic}／國際 ${net.excluded.international} 筆）\n` +
      `  國內新聞：${d.events} 事件、${d.edges} 連結（佐證 ${d.byType["same-incident"]}／實體 ${d.byType["same-entity"]}／同題 ${d.byType["same-topic"]}）、${d.clusters} 群集（最大 ${d.largestCluster}）\n` +
      `  國際新聞：${i.events} 事件、${i.edges} 連結、${i.clusters} 群集`,
  );
}

// 僅在直接執行時跑 main（被 import 時不跑）。
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
