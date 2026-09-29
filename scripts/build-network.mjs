// 對現有快照產出情報網 data/network.json（獨立於 live 抓取，供開發/CI 使用）。
// 用法：node scripts/build-network.mjs
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { correlateEvents, isNewsLikeEvent } from "./lib/correlate.mjs";
import { curateNewsEvents, logCurationSummary } from "./lib/curation.mjs";
import {
  formatNetworkContractErrors,
  NETWORK_FILE,
  validateNetworkContract,
} from "./lib/network-contract.mjs";
import {
  buildCohortManifest,
  writeCohortManifest,
  RULES_VERSION,
} from "./lib/manifest.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// 與 fetch-live 一致：實際服務／部署的資料在 public/data，dist/data 為已 build 副本。
const DATA_DIR = join(ROOT, "public", "data");
const DIST_DATA_DIR = join(ROOT, "dist", "data");

function readEvents(name) {
  const p = join(DATA_DIR, name);
  const fileName = `public/data/${name}`;
  if (!existsSync(p)) {
    throw new Error(`${fileName}：檔案不存在，無法建立 ${NETWORK_FILE}`);
  }
  try {
    const events = JSON.parse(readFileSync(p, "utf8"));
    if (!Array.isArray(events)) throw new Error("根值必須是陣列");
    return events;
  } catch (e) {
    throw new Error(`${fileName}：JSON 無法解析或不是事件陣列：${e.message}`);
  }
}

export function buildNetwork(domestic, international, nowIso, { snapshotId, rulesVersion = RULES_VERSION, ledgerPath } = {}) {
  const domesticNews = (domestic || []).filter(isNewsLikeEvent);
  const intlNews = (international || []).filter(isNewsLikeEvent);
  // 人工更正 ledger（issue #44）：normalize→自動關聯 之間套用，重播結果掛在 overrides 區段
  const curated = curateNewsEvents({ domestic: domesticNews, international: intlNews }, { ledgerPath });
  const domesticNet = correlateEvents(curated.domestic, { corrections: curated.corrections.domestic });
  const intlNet = correlateEvents(curated.international, { corrections: curated.corrections.international });
  const sid =
    snapshotId ||
    `cohort-${nowIso.slice(0, 10).replace(/-/g, "")}-${createHash("sha256").update(nowIso).digest("hex").slice(0, 8)}`;
  return {
    snapshotId: sid,
    generatedAt: nowIso,
    rulesVersion,
    scopeNote: "情報網僅含新聞類事件（RSS / tw-news），排除政府模板化統計資料",
    domestic: domesticNet,
    international: intlNet,
    excluded: {
      domestic: (domestic?.length || 0) - domesticNews.length,
      international: (international?.length || 0) - intlNews.length,
    },
    // correlate 之後收集：被間接擋下的 same_event 已從 applied 移到 skipped
    overrides: curated.collectOverrides(),
  };
}

function main() {
  const domestic = readEvents("domestic.json");
  const international = readEvents("international.json");
  const nowIso = new Date().toISOString();
  const net = buildNetwork(domestic, international, nowIso);
  logCurationSummary(net.overrides);
  const contractErrors = validateNetworkContract(net);
  if (contractErrors.length) {
    throw new Error(`產物契約驗收失敗：\n${formatNetworkContractErrors(NETWORK_FILE, contractErrors)}`);
  }

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const json = JSON.stringify(net, null, 2) + "\n";
  writeFileSync(join(DATA_DIR, "network.json"), json);
  if (existsSync(DIST_DATA_DIR)) writeFileSync(join(DIST_DATA_DIR, "network.json"), json);

  const manifest = buildCohortManifest({
    dataDir: DATA_DIR,
    snapshotId: net.snapshotId,
    rulesVersion: net.rulesVersion,
    nowIso,
  });
  writeCohortManifest(DATA_DIR, manifest);
  if (existsSync(DIST_DATA_DIR)) writeCohortManifest(DIST_DATA_DIR, manifest);

  const d = net.domestic.stats;
  const i = net.international.stats;
  console.log(
    `情報網已產出 → data/network.json（排除政府模板資料 國內 ${net.excluded.domestic}／國際 ${net.excluded.international} 筆）\n` +
      `  國內新聞：${d.events} 事件、${d.edges} 連結（佐證 ${d.byType["same-incident"]}／實體 ${d.byType["same-entity"]}／同題 ${d.byType["same-topic"]}）、${d.clusters} 群集（最大 ${d.largestCluster}）\n` +
      `  國際新聞：${i.events} 事件、${i.edges} 連結、${i.clusters} 群集`,
  );
}

// 僅在直接執行時跑 main（被 import 時不跑）。
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    console.error(`network build 失敗：${error.message}`);
    process.exitCode = 1;
  }
}
