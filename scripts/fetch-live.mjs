// Live 抓取 orchestrator：四源 → 統一 IntelEvent 快照 → public/data/*.json
// 設計原則：
//  - 單一來源失敗不影響其他來源；失敗時保留該檔上一版快照（不以空資料覆蓋）。
//  - 所有 fetchedAt 真實寫入；provenance 誠實標註衍生欄位（推估座標、衍生風險）。
// 執行：node --env-file=.env scripts/fetch-live.mjs
//      （若未用 --env-file，會自動讀同層 .env）

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchPcc } from "./lib/fetch-pcc.mjs";
import { fetchCwa, fetchCwaWarnings } from "./lib/fetch-cwa.mjs";
import { fetchJudicialBulk } from "./lib/fetch-judicial.mjs";
import { fetchMissing } from "./lib/fetch-missing.mjs";
import {
  fetchPolice,
  isPoliceDomesticEvent,
  POLICE_HOURLY_MINIMUM,
  POLICE_NEW_PER_HOUR_MINIMUM,
  POLICE_TODAY_MINIMUM,
  POLICE_TAIPEI_IDS,
} from "./lib/fetch-police.mjs";
import { fetchRssItems, TW_NEWS_FEEDS } from "./lib/fetch-rss.mjs";
import { getInternationalRuntimeConfig, selectInternationalFeeds } from "./lib/international-feeds.mjs";
import { mapBulkNews, titleKey as bulkTitleKey, isPoliceRelevant } from "./lib/news-bulk.mjs";
import { buildNewsSourceContribution, formatNewsSourceContributionReport } from "./lib/news-source-contribution.mjs";
import { normalizeInternational, normalizeDomesticNews, summarize, respondedModel } from "./lib/nvidia.mjs";
import { correlateEvents, isNewsLikeEvent } from "./lib/correlate.mjs";
import { applyPoliceHourlyRun } from "./lib/police-hourly-history.mjs";
import { buildPoliceSourceTree, taiwanLocalDate } from "./lib/police-tree.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "public", "data");

// 若未透過 --env-file 載入，手動讀 .env（n8n Execute Command 等情境）
function loadDotEnv() {
  if (process.env.NVIDIA_API_KEY) return;
  const p = join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const byTimeDesc = (a, b) => new Date(b.timestamp) - new Date(a.timestamp);
const todayTW = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

const DIST_DATA_DIR = join(ROOT, "dist", "data");

function writeJson(name, obj) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const json = JSON.stringify(obj, null, 2) + "\n";
  writeFileSync(join(DATA_DIR, name), json, "utf8");
  // 若已有部署用 dist，同步寫入，使 prod 資料即時更新（不需重 build）
  let synced = "";
  if (existsSync(DIST_DATA_DIR)) {
    writeFileSync(join(DIST_DATA_DIR, name), json, "utf8");
    synced = " (+dist)";
  }
  console.log(`  ✔ 寫入 ${name}${synced}`);
}

function readOld(name) {
  const p = join(DATA_DIR, name);
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return [];
  }
}

function readJson(name, fallback) {
  const p = join(DATA_DIR, name);
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

async function run() {
  loadDotEnv();
  const today = todayTW();
  const nowIso = new Date().toISOString();
  const status = {};
  // 可用 SOURCES 環境變數選擇本次抓取的來源（n8n 分頻用），預設全部。
  // 未選的來源會沿用上一版快照（carry-over）。
  const sourcesArg = process.argv.find((a) => a.startsWith("--sources="))?.slice("--sources=".length);
  const SOURCES = (sourcesArg || process.env.SOURCES || "cwa,pcc,police,rss,judicial").split(",").map((s) => s.trim());
  const want = (s) => SOURCES.includes(s);
  // EXCLUSIVE：只保留本次選取的來源；未選來源不沿用舊快照（一次性窄抓用）。
  // 預設 off，故 n8n 分頻 carry-over 行為不變。
  const EXCLUSIVE = process.argv.includes("--exclusive") || process.env.EXCLUSIVE === "1";
  const dropStale = (st) => EXCLUSIVE && st?.skipped;
  console.log(`本次來源：${SOURCES.join(", ")}${EXCLUSIVE ? "（EXCLUSIVE：未選來源不沿用舊快照）" : ""}`);

  // --- 國內：地震 + 天氣警特報 + 採購（互不影響）---
  let quakes = [];
  let warnings = [];
  if (want("cwa")) {
    try {
      quakes = await fetchCwa({ apiKey: process.env.CWA_API_KEY, limit: 10 });
      status.cwa = { ok: true, count: quakes.length };
      console.log(`地震 CWA：${quakes.length} 筆`);
    } catch (e) {
      status.cwa = { ok: false, error: e.message };
      console.error(`地震 CWA 失敗：${e.message}`);
    }
    try {
      warnings = await fetchCwaWarnings({ apiKey: process.env.CWA_API_KEY });
      status.cwaWarnings = { ok: true, count: warnings.length };
      console.log(`天氣警特報 CWA：${warnings.length} 筆`);
    } catch (e) {
      status.cwaWarnings = { ok: false, error: e.message };
      console.error(`天氣警特報 CWA 失敗：${e.message}`);
    }
  } else {
    status.cwa = { skipped: true };
    status.cwaWarnings = { skipped: true };
  }

  let tenders = [];
  if (want("pcc")) {
    try {
      tenders = await fetchPcc({
        url: process.env.TWINKLE_MCP_URL,
        token: process.env.TWINKLE_MCP_TOKEN,
        today,
        limit: 15,
      });
      status.pcc = { ok: true, count: tenders.length };
      console.log(`採購 pcc-tender：${tenders.length} 筆`);
    } catch (e) {
      status.pcc = { ok: false, error: e.message };
      console.error(`採購 pcc-tender 失敗：${e.message}`);
    }
  } else status.pcc = { skipped: true };

  let policeResult = { events: [], substatus: {} };
  if (want("police")) {
    try {
      policeResult = await fetchPolice({
        url: process.env.TWINKLE_MCP_URL,
        token: process.env.TWINKLE_MCP_TOKEN,
        today,
      });
      status.police = { ok: true, count: policeResult.events.length, ...policeResult.substatus };
      console.log(
        `警政：${policeResult.events.length} 筆（Tier1 事件 + Tier2 測速熱點/週統計/打詐儀表板）`,
      );
    } catch (e) {
      status.police = { ok: false, error: e.message };
      console.error(`警政失敗：${e.message}`);
    }
  } else status.police = { skipped: true };

  // 司法院裁判書：高量真實刑案判決，併入警政事件 → 進每小時 ledger（達成新進量）。
  if (status.police?.ok && want("judicial")) {
    try {
      const now = new Date();
      const runSeed = now.getUTCHours() + now.getUTCDate() * 24;
      const judicial = await fetchJudicialBulk({
        url: process.env.TWINKLE_MCP_URL,
        token: process.env.TWINKLE_MCP_TOKEN,
        perQuery: 30,
        queryCount: 12,
        runSeed,
      });
      if (judicial.length) {
        policeResult.events = [...policeResult.events, ...judicial];
        status.police.count = policeResult.events.length;
        status.judicial = { ok: true, count: judicial.length };
        console.log(`司法院裁判書：${judicial.length} 筆`);
      } else status.judicial = { ok: true, count: 0 };
    } catch (e) {
      status.judicial = { ok: false, error: e.message };
      console.error(`司法院裁判書失敗：${e.message}`);
    }
  }

  // 失蹤人口查尋：警政署 live 協尋名單，併入警政事件 → 進每小時 ledger（真實新進、無座標只進列表）。
  if (status.police?.ok && want("missing")) {
    try {
      const missing = await fetchMissing({});
      if (missing.length) {
        policeResult.events = [...policeResult.events, ...missing];
        status.police.count = policeResult.events.length;
        status.missing = { ok: true, count: missing.length };
        console.log(`失蹤人口查尋：${missing.length} 筆`);
      } else status.missing = { ok: true, count: 0 };
    } catch (e) {
      status.missing = { ok: false, error: e.message };
      console.error(`失蹤人口查尋失敗：${e.message}`);
    }
  }

  // --- 國際：RSS → NVIDIA 正規化 ---
  let intl = [];
  let feedStatus = [];
  if (want("rss")) {
    try {
      const intlCfg = getInternationalRuntimeConfig();
      const intlFeeds = selectInternationalFeeds({ tier: intlCfg.tier, topic: intlCfg.topic });
      const rss = await fetchRssItems({
        perFeed: intlCfg.perFeed,
        feeds: intlFeeds,
        concurrency: intlCfg.concurrency,
      });
      feedStatus = rss.feedStatus;
      const okFeeds = feedStatus.filter((f) => f.ok && f.count).length;
      console.log(
        `RSS：${rss.items.length} 則原文（${okFeeds}/${intlFeeds.length} 來源有回；${feedStatus
          .map((f) => `${f.label}:${f.ok ? f.count : "X"}`)
          .join(" ")}）`,
      );
      // 跨輪快取：重用前一輪 international.json 已正規化的同一篇（依連結 id），跳過 LLM 省成本。
      // INTL_RENORM_ALL=true 時忽略快取、全部重新正規化（一次性，用於套用風險校準等 prompt 變更）。
      const priorIntl =
        process.env.INTL_RENORM_ALL === "true"
          ? new Map()
          : new Map(readOld("international.json").map((e) => [e.id, e]));
      intl = await normalizeInternational(rss.items, { max: intlCfg.maxEvents, priorById: priorIntl });
      status.international = {
        ok: true,
        count: intl.length,
        rawCount: rss.items.length,
        okFeeds,
        totalFeeds: intlFeeds.length,
        tier: intlCfg.tier,
        topic: intlCfg.topic,
        perFeed: intlCfg.perFeed,
        maxEvents: intlCfg.maxEvents,
        feeds: feedStatus,
      };
      console.log(`國際正規化：${intl.length} 筆`);
    } catch (e) {
      status.international = { ok: false, error: e.message, feeds: feedStatus };
      console.error(`國際失敗：${e.message}`);
    }
  } else status.international = { skipped: true };

  // --- 台灣警政新聞：全量收錄（解耦）---
  //  抓取層 perFeed 拉滿、全量去重 → LLM 精修最近一批（地理定位上地球儀）＋其餘輕量收錄（免 LLM）。
  let twnews = [];
  let twFeedStatus = [];
  if (want("twnews")) {
    try {
      const rss = await fetchRssItems({ perFeed: 100, feeds: TW_NEWS_FEEDS, concurrency: 6 });
      twFeedStatus = rss.feedStatus;
      const okFeeds = twFeedStatus.filter((f) => f.ok && f.count).length;
      console.log(`台灣新聞 RSS：${rss.items.length} 則原文（${okFeeds}/${TW_NEWS_FEEDS.length} 來源有回）`);
      // 全量去重（標題）+ 警政相關性過濾（兩層共用同一標準）+ 依時間新到舊排序
      const seen = new Set();
      const uniq = [];
      for (const it of rss.items) {
        const k = bulkTitleKey(it.title);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        uniq.push(it);
      }
      const rawUnique = uniq.length;
      // 先過警政過濾 → enriched 與 bulk 共用此池（LLM 名額不被非警政排擠、不浪費 token）。
      const policeUniq = uniq.filter((it) => isPoliceRelevant(it.title, it.description));
      policeUniq.sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0));
      // LLM 精修最近 N 筆（語意分類＋座標→上地球儀），其餘全量輕量收錄。
      const ENRICH_N = Number(process.env.NEWS_ENRICH_N) || 500;
      let enriched = [];
      try {
        // 跨輪快取：只重用前一輪「LLM enriched」事件（有 aiTopic/aiEntities 標記；
        // bulk 輕量事件 id 用不同雜湊、且無 LLM 標記，不會被重用）。命中即跳過 LLM。
        const priorDom = new Map(
          readOld("domestic.json")
            .filter((e) => e && (e.aiTopic || (Array.isArray(e.aiEntities) && e.aiEntities.length)))
            .map((e) => [e.id, e]),
        );
        enriched = await normalizeDomesticNews(policeUniq.slice(0, ENRICH_N), { max: ENRICH_N, priorById: priorDom });
      } catch (e) {
        console.error(`新聞 LLM 精修失敗（改全走輕量）：${e.message}`);
      }
      // 用原始連結排除已被 LLM 精修者（LLM 會改寫標題，故不能用標題比對）。
      const enrichedLinks = new Set(enriched.map((e) => e.source?.recordRef).filter(Boolean));
      const bulk = mapBulkNews(policeUniq.filter((it) => !enrichedLinks.has(it.link)), { fetchedAt: nowIso });
      twnews = [...enriched, ...bulk];
      const sourceContribution = buildNewsSourceContribution({
        rawItems: rss.items,
        uniqueItems: uniq,
        policeItems: policeUniq,
        finalEvents: twnews,
        feedStatus: twFeedStatus,
      });
      status.twnews = {
        ok: true,
        count: twnews.length,
        enriched: enriched.length,
        bulk: bulk.length,
        policeRelevant: policeUniq.length,
        rawUnique,
        sourceContribution: sourceContribution.rows,
        sourceContributionTotals: sourceContribution.totals,
        lowContributionFeeds: sourceContribution.lowContributionFeeds,
        feeds: twFeedStatus,
      };
      console.log(`台灣新聞：警政 ${twnews.length} 筆（LLM 精修 ${enriched.length}＋輕量 ${bulk.length}；警政相關 ${policeUniq.length}／全量去重 ${rawUnique}）`);
      console.log(formatNewsSourceContributionReport(sourceContribution, { limit: 20 }));
    } catch (e) {
      status.twnews = { ok: false, error: e.message, feeds: twFeedStatus };
      console.error(`台灣新聞失敗：${e.message}`);
    }
  } else status.twnews = { skipped: true };

  // --- 國內快照（last-good carry-over：單源失敗則沿用舊快照中該源事件，保留舊 fetchedAt）---
  const oldDomestic = readOld("domestic.json");
  // 地震與天氣警特報同屬「災防」類，carry-over 必須依 datasetId 精準切分，避免互相吃到對方。
  const quakeEvents = status.cwa?.ok
    ? quakes
    : dropStale(status.cwa)
      ? []
      : oldDomestic.filter((e) => e.source?.datasetId === "E-A0015-001");
  const warningEvents = status.cwaWarnings?.ok
    ? warnings
    : dropStale(status.cwaWarnings)
      ? []
      : oldDomestic.filter((e) => e.source?.datasetId === "W-C0033-001");
  const tenderEvents = status.pcc?.ok
    ? tenders
    : dropStale(status.pcc)
      ? []
      : oldDomestic.filter((e) => e.category === "採購" && !isPoliceDomesticEvent(e));
  const why = (st) => (st?.skipped ? "本次未選" : "失敗");
  if (!status.cwa?.ok && quakeEvents.length) console.warn(`地震${why(status.cwa)}，沿用舊快照 ${quakeEvents.length} 筆`);
  if (!status.cwaWarnings?.ok && warningEvents.length)
    console.warn(`天氣警特報${why(status.cwaWarnings)}，沿用舊快照 ${warningEvents.length} 筆`);
  if (!status.pcc?.ok && tenderEvents.length) console.warn(`採購${why(status.pcc)}，沿用舊快照 ${tenderEvents.length} 筆`);
  // 跨輪累積 + 保留窗：成功時 union 本輪與舊 tw-news（recordRef→標題去重，本輪優先以保留 LLM 精修版），
  // 再剪掉超過保留窗者 → 量隨時間複利成長到保留窗深度，每輪仍只 when:Nd 抓增量、LLM 成本不變。
  const RETENTION_DAYS = Number(process.env.NEWS_RETENTION_DAYS) || 5;
  const retentionFrom = Date.now() - RETENTION_DAYS * 864e5;
  const oldNews = oldDomestic.filter((e) => e.source?.datasetId === "tw-news");
  const newsDedupKey = (e) => e.source?.recordRef || (e.title ? "t:" + bulkTitleKey(e.title) : "");
  let newsEvents;
  if (status.twnews?.ok && twnews.length) {
    const seen = new Set();
    newsEvents = [];
    for (const e of [...twnews, ...oldNews]) {
      const k = newsDedupKey(e);
      if (k && seen.has(k)) continue;
      const t = Date.parse(e.timestamp);
      if (Number.isFinite(t) && t < retentionFrom) continue; // 超過保留窗丟棄
      if (k) seen.add(k);
      newsEvents.push(e);
    }
    console.log(
      `台灣新聞累積：本輪 ${twnews.length}＋舊 ${oldNews.length} → 去重保留 ${newsEvents.length} 筆（保留窗 ${RETENTION_DAYS} 天）`,
    );
  } else {
    newsEvents = dropStale(status.twnews) ? [] : oldNews;
    if (!status.twnews?.ok && newsEvents.length) console.warn(`台灣新聞${why(status.twnews)}，沿用舊快照 ${newsEvents.length} 筆`);
  }

  let policeEvents = [];
  let policeHourly = null;
  if (status.police?.ok) {
    const generalPccIds = new Set(tenderEvents.map((e) => e.id));
    policeEvents = policeResult.events.filter((e) => {
      if (!e.id.startsWith("pcc-police-")) return true;
      const altId = e.id.replace("pcc-police-", "pcc-");
      return !generalPccIds.has(altId);
    });
    status.police.minimumPerHour = POLICE_HOURLY_MINIMUM;
    status.police.meetsHourlyMinimum = policeEvents.length >= POLICE_HOURLY_MINIMUM;
    status.police.todayMinimum = POLICE_TODAY_MINIMUM;
    status.police.todayLocalDate = taiwanLocalDate(nowIso);
    status.police.todayCount = policeEvents.filter(
      (event) => taiwanLocalDate(event.source?.fetchedAt || event.timestamp) === status.police.todayLocalDate,
    ).length;
    status.police.meetsTodayMinimum = status.police.todayCount >= POLICE_TODAY_MINIMUM;

    const previousHistory = readJson("police-hourly-history.json", { runs: [] });
    const previousLedger = readJson("police-seen-ledger.json", { seen: [] });
    policeHourly = applyPoliceHourlyRun({
      generatedAt: nowIso,
      events: policeEvents,
      previousHistory,
      previousLedger,
      minimumNewPerHour: POLICE_NEW_PER_HOUR_MINIMUM,
      maxNewPerRun: POLICE_NEW_PER_HOUR_MINIMUM,
    });
    status.police.newMinimumPerHour = POLICE_NEW_PER_HOUR_MINIMUM;
    status.police.hourLocal = policeHourly.run.hourLocal;
    status.police.newPoliceRelatedCount = policeHourly.run.newPoliceRelatedCount;
    status.police.duplicateFromPriorCount = policeHourly.run.duplicateFromPriorCount;
    status.police.deferredNewCandidateCount = policeHourly.run.deferredNewCandidateCount;
    status.police.meetsNewHourlyMinimum = policeHourly.run.meetsNewHourlyMinimum;
    if (!policeHourly.run.meetsNewHourlyMinimum) {
      console.warn(
        `警政全新資料不足：${policeHourly.run.newPoliceRelatedCount}/${POLICE_NEW_PER_HOUR_MINIMUM}（重複 ${policeHourly.run.duplicateFromPriorCount} 筆）`,
      );
    }
  } else {
    policeEvents = oldDomestic.filter(isPoliceDomesticEvent);
    if (policeEvents.length) console.warn(`警政${why(status.police)}，沿用舊快照 ${policeEvents.length} 筆`);
  }

  const domesticEvents = [...quakeEvents, ...warningEvents, ...tenderEvents, ...policeEvents, ...newsEvents].sort(byTimeDesc);
  if (domesticEvents.length) {
    writeJson("domestic.json", domesticEvents);
  } else {
    console.warn("國內無任何事件，保留舊 domestic.json");
  }

  if (policeEvents.length) {
    writeJson(
      "police-tree.json",
      buildPoliceSourceTree({
        generatedAt: nowIso,
        events: policeEvents,
        minimumPerHour: POLICE_HOURLY_MINIMUM,
        todayMinimum: POLICE_TODAY_MINIMUM,
      }),
    );
    if (policeHourly) {
      writeJson("police-hourly-history.json", policeHourly.history);
      writeJson("police-seen-ledger.json", policeHourly.ledger);
    }
  }

  // --- 國際快照（carry-over：失敗或未抓則沿用舊快照；EXCLUSIVE 且未選則清空）---
  const oldIntl = readOld("international.json");
  const intlOk = status.international?.ok && intl.length;
  const intlEvents = intlOk ? [...intl].sort(byTimeDesc) : dropStale(status.international) ? [] : oldIntl;
  if (intlOk) {
    writeJson("international.json", intlEvents);
  } else if (dropStale(status.international)) {
    writeJson("international.json", []);
    console.warn("國際本次未選（EXCLUSIVE），清空 international.json");
  } else if (intlEvents.length) {
    console.warn(`國際未更新（${status.international?.skipped ? "本次未選" : "失敗"}），沿用舊快照 ${intlEvents.length} 筆`);
  } else {
    console.warn("國際無任何事件，保留舊 international.json");
  }

  // --- 情報網：把新聞事件串成關聯圖（純加法，不影響既有輸出）---
  let domesticClusters = []; // 供 AI 群摘要用（cluster id 與 build-network 一致，因同 correlateEvents/同 domestic.json）
  try {
    const domesticNews = domesticEvents.filter(isNewsLikeEvent);
    const intlNews = intlEvents.filter(isNewsLikeEvent);
    const network = {
      generatedAt: nowIso,
      scopeNote: "情報網僅含新聞類事件（RSS / tw-news），排除政府模板化統計資料",
      domestic: correlateEvents(domesticNews),
      international: correlateEvents(intlNews),
      excluded: {
        domestic: domesticEvents.length - domesticNews.length,
        international: intlEvents.length - intlNews.length,
      },
    };
    writeJson("network.json", network);
    domesticClusters = network.domestic.clusters || [];
    status.network = { ok: true, edges: network.domestic.stats.edges, clusters: network.domestic.stats.clusters };
    console.log(`情報網：國內新聞 ${network.domestic.stats.events} 事件 → ${network.domestic.stats.edges} 連結、${network.domestic.stats.clusters} 群集`);
  } catch (e) {
    status.network = { ok: false, error: e.message };
    console.error(`情報網建立失敗（不影響其他輸出）：${e.message}`);
  }

  // --- AI 摘要（NVIDIA）---
  try {
    const summary = await summarize({ domestic: domesticEvents, international: intlEvents, clusters: domesticClusters });
    writeJson("summary.json", summary);
    status.summary = { ok: true };
    console.log("AI 摘要：完成");
  } catch (e) {
    status.summary = { ok: false, error: e.message };
    console.error(`AI 摘要失敗：${e.message}`);
  }

  // --- provenance（誠實標註；carry-over 來源標 stale 並用舊 fetchedAt）---
  const sources = [];
  const staleFetchedAt = (events) => events[0]?.source?.fetchedAt || nowIso;
  if (tenderEvents.length)
    sources.push({
      name: "政府電子採購網 決標公告",
      type: "gov-open-data",
      datasetId: "pcc-tender",
      scope: "domestic",
      category: "採購",
      count: tenderEvents.length,
      fetchedAt: status.pcc?.ok ? nowIso : staleFetchedAt(tenderEvents),
      stale: !status.pcc?.ok || undefined,
      query: `announcement_type='決標公告' AND award_price != '' AND date <= '${today}' ORDER BY date DESC (twinkle-hub query_rows)`,
      license: "政府網站資料開放宣告 — 行政院公共工程委員會 政府電子採購網 (https://web.pcc.gov.tw)",
    });
  if (quakeEvents.length)
    sources.push({
      name: "中央氣象署 顯著有感地震報告",
      type: "cwa",
      datasetId: "E-A0015-001",
      scope: "domestic",
      category: "災防",
      count: quakeEvents.length,
      fetchedAt: status.cwa?.ok ? nowIso : staleFetchedAt(quakeEvents),
      stale: !status.cwa?.ok || undefined,
      query: "CWA opendata API E-A0015-001 (顯著有感地震報告)",
      license: "政府資料開放授權條款-第1版 — 交通部中央氣象署",
    });
  if (warningEvents.length)
    sources.push({
      name: "中央氣象署 天氣警特報",
      type: "cwa",
      datasetId: "W-C0033-001",
      scope: "domestic",
      category: "災防",
      count: warningEvents.length,
      fetchedAt: status.cwaWarnings?.ok ? nowIso : staleFetchedAt(warningEvents),
      stale: !status.cwaWarnings?.ok || undefined,
      query: "CWA opendata API W-C0033-001 (天氣特報-各縣市目前天氣警特報情形)",
      license: "政府資料開放授權條款-第1版 — 交通部中央氣象署",
    });
  if (policeEvents.length) {
    const policeSourceDefs = [
      { key: "traffic", name: "警政署 114年傷亡道路交通事故", datasetId: "177136", category: "交通" },
      { key: "speedHotspots", name: "警政署 測速執法點取締件數", datasetId: "13908", category: "交通" },
      { key: "fraudDomains", name: "165反詐騙 涉詐網站停解析", datasetId: "176455", category: "反詐" },
      { key: "fraudDebunk", name: "165反詐騙 詐騙闢謠專區", datasetId: "38262", category: "反詐" },
      { key: "fraudDashboard", name: "警政署 打詐儀表板執行成效", datasetId: "172159", category: "反詐" },
      { key: "taipeiCrime", name: "臺北市政府警察局 犯罪點位", datasetId: "taipei-crime", category: "治安" },
      { key: "crimeWeekly", name: "警政署 犯罪資料統計週報", datasetId: "13166", category: "治安" },
      { key: "taichungTraffic", name: "臺中市政府警察局 114年10月交通事故", datasetId: "176086", category: "交通" },
      { key: "taichungHotspots", name: "臺中市政府警察局 十大高肇事路口", datasetId: "176610", category: "交通" },
      { key: "taoyuanTheft", name: "桃園市政府警察局 竊盜點位", datasetId: "167673", category: "治安" },
      { key: "tainanAlerts", name: "臺南市政府警察局 婦幼犯罪警示", datasetId: "100208", category: "治安" },
      { key: "ntpcAlerts", name: "新北市政府警察局 婦幼犯罪警示", datasetId: "125645", category: "治安" },
      { key: "fraudInvest", name: "165反詐騙 假投資(博弈)網站", datasetId: "160055", category: "反詐" },
      { key: "policeNews", name: "警政署 各警察機關新聞發布", datasetId: "7505", category: "治安" },
      { key: "historicalTraffic", name: "警政署 歷史交通事故資料", datasetId: "12197", category: "交通" },
      { key: "drugCrime", name: "警政署 毒品犯罪資料", datasetId: "57268", category: "治安" },
      { key: "assemblies", name: "警政署 集會遊行資訊", datasetId: "11307", category: "治安" },
      { key: "taipeiTrafficSpots", name: "臺北市政府警察局 道路交通事故斑點圖", datasetId: "136123", category: "交通" },
      { key: "taipeiTrafficViolations", name: "臺北市政府警察局 交通違規舉發", datasetId: "173625", category: "交通" },
      { key: "kaohsiungA3Traffic", name: "高雄市政府警察局 小港區 A3 交通事故", datasetId: "168403", category: "交通" },
      { key: "kaohsiungFixedCameras", name: "高雄市政府警察局 固定式違規照相設備", datasetId: "169080", category: "交通" },
      { key: "kaohsiungAvgSpeedCameras", name: "高雄市政府警察局 區間平均速率執法設備", datasetId: "146885", category: "交通" },
      { key: "hsinchuCityTrafficStats", name: "新竹市警察局 每月交通事故統計", datasetId: "167814", category: "交通" },
      { key: "hsinchuCountyAvgSpeed", name: "新竹縣政府警察局 區間平均速率裝置", datasetId: "172950", category: "交通" },
      { key: "chiayiTheft", name: "嘉義縣警察局 住宅竊盜點位", datasetId: "133922", category: "治安" },
      { key: "chiayiTheft", name: "嘉義縣警察局 汽車竊盜點位", datasetId: "133923", category: "治安" },
      { key: "chiayiTheft", name: "嘉義縣警察局 自行車竊盜點位", datasetId: "133924", category: "治安" },
      { key: "yilanCctv", name: "宜蘭縣政府警察局 治安交通監錄系統", datasetId: "143467", category: "治安" },
      { key: "miaoliReportStats", name: "苗栗縣警察勤務指揮中心 報案統計", datasetId: "171164", category: "治安" },
      { key: "miaoliCaseStats", name: "苗栗縣警察勤務指揮中心 治安交通案件", datasetId: "171167", category: "治安" },
      { key: "nantouTechEnforcement", name: "南投縣政府警察局 固定式科技執法", datasetId: "176021", category: "交通" },
      { key: "nantouImpoundLots", name: "南投縣政府警察局 違規車輛保管場", datasetId: "78638", category: "交通" },
      { key: "pingtungCctv", name: "屏東縣政府警察局 路口錄監系統", datasetId: "155895", category: "治安" },
      { key: "pingtungCrashHotspots", name: "屏東縣政府警察局 交通肇事案件", datasetId: "90589", category: "交通" },
      { key: "pingtungTechEnforcement", name: "屏東縣政府警察局 科技執法路段", datasetId: "159972", category: "交通" },
      { key: "hualienAvgSpeed", name: "花蓮縣警察局 區間測速執法地點", datasetId: "171349", category: "交通" },
      { key: "taitungAirRaidShelters", name: "臺東縣警察局 防空避難設施", datasetId: "173142", category: "災防" },
      { key: "penghuScienceEnforcement", name: "澎湖縣 科學儀器執法與測速照相", datasetId: "172940", category: "交通" },
      { key: "penghuTrafficOrderStats", name: "澎湖縣政府警察局 交通秩序成果", datasetId: "157949", category: "交通" },
      { key: "kinmenAirRaidShelters", name: "金門縣警察局 防空避難設施", datasetId: "151006", category: "災防" },
      { key: "lienchiangServiceStats", name: "連江縣警察局 為民服務成果", datasetId: "146936", category: "治安" },
      { key: "crimeRate", name: "警政署統計處 刑案發生率／破獲率（按機關別）", datasetId: "103351", category: "治安" },
      { key: "duiTaichung", name: "臺中市政府警察局 取締酒駕情形", datasetId: "88170", category: "交通" },
      { key: "dvTaipei", name: "臺北市 家暴通報案件數統計", datasetId: "145744", category: "治安" },
      { key: "policePcc", name: "政府電子採購網 警政決標公告", datasetId: "pcc-tender", category: "採購" },
      { key: "missing", name: "警政署 失蹤人口查尋", datasetId: "14420", category: "協尋" },
    ];
    for (const def of policeSourceDefs) {
      const currentEvents = policeEvents.filter((e) => {
        if (def.datasetId === "taipei-crime") return POLICE_TAIPEI_IDS.has(e.source?.datasetId || "");
        if (def.datasetId === "pcc-tender") return e.id.startsWith("pcc-police-");
        return e.source?.datasetId === def.datasetId;
      });
      const count = currentEvents.length;
      const sub = status.police?.[def.key];
      if (!count && sub?.ok !== false) continue;
      const previousEvents = oldDomestic.filter((e) => {
        if (def.datasetId === "taipei-crime") return POLICE_TAIPEI_IDS.has(e.source?.datasetId || "");
        if (def.datasetId === "pcc-tender") return e.id?.startsWith("pcc-police-");
        return e.source?.datasetId === def.datasetId;
      });
      const successFetchedAt = [...currentEvents, ...previousEvents]
        .map((e) => e.source?.fetchedAt)
        .filter(Boolean)
        .sort()
        .pop();
      sources.push({
        key: def.key,
        name: def.name,
        type: def.datasetId === "pcc-tender" ? "gov-open-data" : "gov-open-data",
        datasetId: def.datasetId,
        scope: "domestic",
        category: def.category,
        count,
        fetchedAt: sub?.ok === false ? successFetchedAt || staleFetchedAt(previousEvents) : currentEvents[0]?.source?.fetchedAt || nowIso,
        lastSuccessAt: successFetchedAt || undefined,
        stale: sub?.ok === false || !status.police?.ok || undefined,
        query: `twinkle-hub police/${def.key}`,
        license: "政府資料開放授權條款-第1版 — 內政部警政署／地方政府警察局",
      });
    }
  }
  if (newsEvents.length) {
    const newsByFeed = {};
    for (const e of newsEvents) newsByFeed[e.source.name] = (newsByFeed[e.source.name] || 0) + 1;
    for (const [name, count] of Object.entries(newsByFeed))
      sources.push({
        name: `台灣新聞：${name}`,
        type: "news-rss",
        datasetId: "tw-news",
        scope: "domestic",
        category: "治安",
        count,
        fetchedAt: newsEvents.find((e) => e.source.name === name)?.source?.fetchedAt || nowIso,
        stale: !status.twnews?.ok || undefined,
        query: `台灣社會新聞 RSS → LLM(${respondedModel()}) 正規化`,
        license: "各新聞媒體著作權所有；本平台僅彙整標題/摘要與原文連結，分類與座標為 LLM 衍生",
      });
  }
  if (intlOk) {
    for (const f of feedStatus.filter((x) => x.ok && x.count)) {
      const c = intlEvents.filter((e) => e.source.name === f.label).length;
      if (!c) continue;
      sources.push({
        name: `國際新聞：${f.label}`,
        type: "news-rss",
        scope: "international",
        count: c,
        fetchedAt: nowIso,
        query: `RSS ${f.label} → LLM(${respondedModel()}) 正規化`,
      });
    }
  } else {
    // carry-over：由舊國際快照還原各來源（標 stale）
    const byName = {};
    for (const e of intlEvents) byName[e.source.name] = (byName[e.source.name] || 0) + 1;
    for (const [name, count] of Object.entries(byName))
      sources.push({
        name: `國際新聞：${name}`,
        type: "news-rss",
        scope: "international",
        count,
        fetchedAt: intlEvents.find((e) => e.source.name === name)?.source?.fetchedAt || nowIso,
        stale: true,
        query: `RSS ${name} → LLM(${respondedModel()}) 正規化`,
      });
  }

  writeJson("provenance.json", {
    generatedAt: nowIso,
    note:
      "Live 抓取。座標：採購為依機關所在縣市/區中心推估、新聞事件為 LLM 依事件地點推估，皆非原始資料欄位；地震為真實震央。風險等級為衍生指標（採購依決標金額、地震依規模、新聞由 LLM 依嚴重度判定），非原始欄位。新聞摘要與分類由 LLM " +
      respondedModel() +
      " 自 RSS 原文生成，原始連結保留可回溯。",
    pipeline: status,
    sources,
  });

  console.log("\n=== 完成 ===");
  console.log(JSON.stringify(status, null, 2));
}

run().catch((e) => {
  console.error("PIPELINE FATAL:", e);
  process.exit(1);
});
