// Live 抓取 orchestrator：四源 → 統一 IntelEvent 快照 → public/data/*.json
// 設計原則：
//  - 單一來源失敗不影響其他來源；失敗時保留該檔上一版快照（不以空資料覆蓋）。
//  - 所有 fetchedAt 真實寫入；provenance 誠實標註衍生欄位（推估座標、衍生風險）。
// 執行：node --env-file=.env scripts/fetch-live.mjs
//      （若未用 --env-file，會自動讀同層 .env）

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchCwa, fetchCwaWarnings } from "./lib/fetch-cwa.mjs";
import { fetchMofaTravelWarnings } from "./lib/fetch-mofa.mjs";
import { fetchNcdrAlerts, NCDR_DATASET_ID } from "./lib/fetch-ncdr.mjs";
import {
  OFFICIAL_SOURCE_META,
  OFFICIAL_SOURCE_DATASET_IDS,
} from "./lib/fetch-official.mjs";
import { DIRECT_OFFICIAL_SOURCE_KEYS, fetchDirectOfficialSources } from "./lib/direct-official-sources.mjs";
import { createSourcePlan } from "./lib/source-plan.mjs";
import { fetchMissing } from "./lib/fetch-missing.mjs";
import {
  fetchPolice,
  POLICE_HOURLY_MINIMUM,
  POLICE_NEW_PER_HOUR_FALLBACK,
  POLICE_TODAY_MINIMUM,
} from "./lib/fetch-police.mjs";
import { fetchRssItems, TW_NEWS_FEEDS } from "./lib/fetch-rss.mjs";
import { fetchGdelt } from "./lib/fetch-gdelt.mjs";
import { googleNewsHealth } from "./lib/gn-health.mjs";
import { getInternationalRuntimeConfig, selectInternationalFeeds } from "./lib/international-feeds.mjs";
import { accumulateInternational } from "./lib/intl-accumulate.mjs";
import { carryOver } from "./lib/carry-over.mjs";
import {
  isNonEventNoise,
  isPoliceNewsNoise,
  isRelevantNewsItem,
  buildNewsRelevanceAudit,
  mapBulkNews,
  titleKey as bulkTitleKey,
} from "./lib/news-bulk.mjs";
import { buildNewsSourceContribution, eventFeedLabel, formatNewsSourceContributionReport } from "./lib/news-source-contribution.mjs";
import {
  normalizeInternational,
  normalizeDomesticNews,
  summarize,
  respondedModel,
  intlNormalizeFailed,
  domesticNormalizeFailed,
  lastIntlNormalizeSkippedBatches,
  lastDomesticNormalizeSkippedBatches,
} from "./lib/nvidia.mjs";
import { correlateEvents, isNewsLikeEvent } from "./lib/correlate.mjs";
import {
  formatNetworkContractErrors,
  NETWORK_FILE,
  validateNetworkContract,
} from "./lib/network-contract.mjs";
import {
  applyPoliceHourlyRun,
  calibratePoliceHourlyMinimum,
  eventFingerprint,
} from "./lib/police-hourly-history.mjs";
import { applyDailyRollup, taiwanLocalDay } from "./lib/daily-rollup.mjs";
import { buildPoliceSourceTree, taiwanLocalDate } from "./lib/police-tree.mjs";
import { validateEventContract, clampImplausibleTimestamps, isReferenceEvent } from "./lib/event-contract.mjs";
import { applyTemporal } from "./lib/temporal.mjs";
import { buildCoverageMatrix } from "./audit-coverage.mjs";
import { buildDomainCoverage } from "./domain-coverage.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
// 測試隔離用；生產不設定 FETCH_LIVE_DATA_DIR 時維持既有 public/data。
const DATA_DIR = process.env.FETCH_LIVE_DATA_DIR || join(ROOT, "public", "data");

// 若未透過 --env-file 載入，手動讀 .env（n8n Execute Command 等情境）
function loadDotEnv() {
  const p = join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const byTimeDesc = (a, b) => new Date(b.timestamp) - new Date(a.timestamp);
const DAY_MS = 864e5;

const TW_NEWS_ADVISORY_LABELS = new Set(TW_NEWS_FEEDS.filter((feed) => feed.advisory).map((feed) => feed.label));

function finiteRetentionDays(value, fallback) {
  const days = Number(value);
  return Number.isFinite(days) && days > 0 ? days : fallback;
}

export function isAdvisoryTwNewsEvent(event, { advisoryLabels = TW_NEWS_ADVISORY_LABELS } = {}) {
  const source = event?.source || {};
  if (source.advisory === true || source.retentionPolicy === "advisory") return true;
  const label = source.feedLabel || eventFeedLabel(event);
  return advisoryLabels?.has?.(label) || false;
}

export function retentionDaysForTwNewsEvent(
  event,
  { retentionDays = 5, advisoryRetentionDays, resolveRetentionDays } = {},
) {
  if (typeof resolveRetentionDays === "function") {
    const resolved = resolveRetentionDays(event);
    return finiteRetentionDays(resolved, retentionDays);
  }
  if (advisoryRetentionDays != null && isAdvisoryTwNewsEvent(event)) {
    return finiteRetentionDays(advisoryRetentionDays, retentionDays);
  }
  return finiteRetentionDays(retentionDays, 5);
}

export function shouldRetainTwNewsEvent(
  event,
  { retentionDays = 5, advisoryRetentionDays, resolveRetentionDays, now = Date.now() } = {},
) {
  const days = retentionDaysForTwNewsEvent(event, { retentionDays, advisoryRetentionDays, resolveRetentionDays });
  const retentionFrom = now - days * DAY_MS;
  const t = Date.parse(event?.timestamp);
  return !(Number.isFinite(t) && t < retentionFrom);
}

export function buildTwNewsEvents({
  twnews = [],
  oldNews = [],
  twnewsStatus,
  dropStaleNews = false,
  retentionDays = 5,
  advisoryRetentionDays,
  resolveRetentionDays,
  now = Date.now(),
} = {}) {
  const newsDedupKey = (e) => e.source?.recordRef || (e.title ? "t:" + bulkTitleKey(e.title) : "");
  const keep = (event) => {
    const item = event?.summary && !event?.description ? { ...event, description: event.summary } : event;
    return (
      !isNonEventNoise(item) &&
      !isPoliceNewsNoise(item) &&
      shouldRetainTwNewsEvent(event, { retentionDays, advisoryRetentionDays, resolveRetentionDays, now })
    );
  };
  const hasFreshTwnews = twnewsStatus?.ok && twnews.length;
  const carriedNews = carryOver({
    status: hasFreshTwnews ? twnewsStatus : undefined,
    fresh: twnews,
    dropStale: () => dropStaleNews,
    oldEvents: oldNews,
    match: keep,
  });
  const seen = new Set();
  const newsEvents = [];
  for (const e of hasFreshTwnews ? [...carriedNews, ...oldNews] : carriedNews) {
    const k = newsDedupKey(e);
    if (k && seen.has(k)) continue;
    if (!keep(e)) continue; // 超過保留窗丟棄
    if (k) seen.add(k);
    newsEvents.push(e);
  }
  return newsEvents;
}

export function buildCategoryBasisDistribution(events = []) {
  const counts = {};
  for (const event of events || []) {
    const basis = event?.categoryBasis;
    if (!basis) continue;
    counts[basis] = (counts[basis] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b, "zh-Hant")));
}

const DIST_DATA_DIR = join(ROOT, "dist", "data");

function writeJson(name, obj) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const json = JSON.stringify(obj, null, 2) + "\n";
  writeFileSync(join(DATA_DIR, name), json, "utf8");
  // 若已有部署用 dist，同步寫入，使 prod 資料即時更新（不需重 build）
  let synced = "";
  if (!process.env.FETCH_LIVE_DATA_DIR && existsSync(DIST_DATA_DIR)) {
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

export async function run() {
  loadDotEnv();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const status = {};
  const { sourceKeys, exclusive, wants: want, dropStale } = createSourcePlan();
  const RETENTION_DAYS = Number(process.env.NEWS_RETENTION_DAYS) || 5;
  const ADVISORY_RETENTION_DAYS = Number(process.env.NEWS_ADVISORY_RETENTION_DAYS) || 30;
  const TEMPORAL_HISTORICAL_DAYS = finiteRetentionDays(process.env.TEMPORAL_HISTORICAL_DAYS, 180);
  console.log(`本次來源：${sourceKeys.join(", ")}${exclusive ? "（EXCLUSIVE：未選來源不沿用舊快照）" : ""}`);

  // --- 國內：地震 + 天氣警特報（互不影響）---
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

  let policeResult = { events: [], substatus: {} };
  if (want("police")) {
    try {
      policeResult = await fetchPolice();
      status.police = { ok: true, count: policeResult.events.length, ...policeResult.substatus };
      console.log(`警政署犯罪週報：${policeResult.events.length} 筆`);
    } catch (e) {
      status.police = { ok: false, error: e.message };
      console.error(`警政失敗：${e.message}`);
    }
  } else status.police = { skipped: true };

  // 失蹤人口查尋：警政署 live 協尋名單，併入警政事件 → 進每小時 ledger（真實新進、無座標只進列表）。
  let missing = [];
  if (want("missing")) {
    try {
      missing = await fetchMissing({});
      status.missing = { ok: true, count: missing.length };
      console.log(`失蹤人口查尋：${missing.length} 筆`);
    } catch (e) {
      status.missing = { ok: false, error: e.message };
      console.error(`失蹤人口查尋失敗：${e.message}`);
    }
  } else status.missing = { skipped: true };

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
      const rssFeedStatus = rss.feedStatus;
      const rssOkFeeds = rssFeedStatus.filter((f) => f.ok && f.count).length;
      // 全 feed 失敗＝來源級故障，不可標 ok:true count:0（twnews/missing/police 同族修正）。
      if (intlFeeds.length > 0 && rssOkFeeds === 0) {
        throw new Error(`國際 RSS 全數失敗（0/${intlFeeds.length} 來源有回）`);
      }

      let gdelt = { ok: false, skipped: true, label: "GDELT Global News", items: [] };
      if (want("gdelt") && (intlCfg.topic === "all" || intlCfg.topic === "general")) {
        try {
          gdelt = await fetchGdelt();
          status.gdelt = {
            ok: true,
            count: gdelt.items.length,
            query: gdelt.query,
            timespan: gdelt.timespan,
            maxRecords: gdelt.maxRecords,
            fetchedAt: gdelt.fetchedAt,
            requestUrl: gdelt.requestUrl,
          };
          console.log(`GDELT：${gdelt.items.length} 則原文`);
        } catch (e) {
          // GDELT 是補充訊號；API 限流或暫時失敗只告警，RSS 主線照常更新。
          status.gdelt = { ok: false, error: e.message, label: "GDELT Global News" };
          console.warn(`GDELT 失敗（補充來源，繼續部署）：${e.message}`);
        }
      } else {
        status.gdelt = { skipped: true, reason: want("gdelt") ? `topic=${intlCfg.topic}` : "未選取" };
      }

      const rawItems = [...rss.items, ...(gdelt.ok ? gdelt.items : [])];
      const gdeltFeedStatus = gdelt.ok || status.gdelt?.ok === false
        ? [{
            label: "GDELT Global News",
            ok: gdelt.ok === true,
            count: gdelt.ok ? gdelt.items.length : 0,
            error: status.gdelt?.error,
            method: "gdelt-doc",
          }]
        : [];
      feedStatus = [...rssFeedStatus, ...gdeltFeedStatus];
      const okFeeds = feedStatus.filter((f) => f.ok && f.count).length;
      console.log(
        `國際原文：${rawItems.length} 則（${okFeeds}/${feedStatus.length} 來源有回；${feedStatus
          .map((f) => `${f.label}:${f.ok ? f.count : "X"}`)
          .join(" ")}）`,
      );
      // 跨輪快取：重用前一輪 international.json 已正規化的同一篇（依連結 id），跳過 LLM 省成本。
      // INTL_RENORM_ALL=true 時忽略快取、全部重新正規化（一次性，用於套用風險校準等 prompt 變更）。
      const priorIntl =
        process.env.INTL_RENORM_ALL === "true"
          ? new Map()
          : new Map(readOld("international.json").map((e) => [e.id, e]));
      // general topic feed 集合＝assert 門檻驗的主題；正規化優先啃、挑選時保底（見 nvidia.mjs GENERAL_FLOOR）。
      const generalFeedLabels = new Set(
        selectInternationalFeeds({ tier: "expanded", topic: "general" }).map((feed) => feed.label),
      );
      intl = await normalizeInternational(rawItems, {
        max: intlCfg.maxEvents,
        priorById: priorIntl,
        priorityFeedLabels: generalFeedLabels,
      });
      const normalizedByFeed = new Map();
      for (const event of intl) {
        const label = event.source?.feedLabel || event.source?.name;
        if (label) normalizedByFeed.set(label, (normalizedByFeed.get(label) || 0) + 1);
      }
      status.international = {
        ok: true,
        // 全批失敗（有新項卻零 LLM 產出）＝管線級故障：本輪只剩快取重用，需告警追查。
        normalizeFailed: intlNormalizeFailed(),
        ...(lastIntlNormalizeSkippedBatches > 0 ? { normalizeSkippedBatches: lastIntlNormalizeSkippedBatches } : {}),
        count: intl.length,
        rawCount: rawItems.length,
        rssRawCount: rss.items.length,
        gdeltRawCount: gdelt.ok ? gdelt.items.length : 0,
        okFeeds,
        totalFeeds: feedStatus.length,
        tier: intlCfg.tier,
        topic: intlCfg.topic,
        perFeed: intlCfg.perFeed,
        maxEvents: intlCfg.maxEvents,
        feeds: feedStatus.map((feed) => ({ ...feed, normalizedCount: normalizedByFeed.get(feed.label) || 0 })),
      };
      console.log(`國際正規化：${intl.length} 筆`);
    } catch (e) {
      status.international = { ok: false, error: e.message, feeds: feedStatus };
      console.error(`國際失敗：${e.message}`);
    }
  } else status.international = { skipped: true };

  // --- 外交部國外旅遊警示：官方 RSS 燈號 → 結構化國際事件（不走 LLM）---
  let mofa = [];
  if (want("mofa")) {
    try {
      mofa = await fetchMofaTravelWarnings({});
      status.mofa = { ok: true, count: mofa.length };
      console.log(`外交部旅遊警示：${mofa.length} 筆`);
    } catch (e) {
      status.mofa = { ok: false, error: e.message };
      console.error(`外交部旅遊警示失敗：${e.message}`);
    }
  } else status.mofa = { skipped: true };

  // --- NCDR 災防示警：Atom 聚合 + CAP 明細 → 國內事件（fail-soft，不中斷主管線）---
  let ncdr = [];
  if (want("ncdr")) {
    try {
      const result = await fetchNcdrAlerts({});
      ncdr = result.events || [];
      status.ncdr = { ok: true, ...result.status };
      console.log(`NCDR 災防示警：${ncdr.length} 筆（白名單 ${status.ncdr.whitelisted}/${status.ncdr.raw}；明細失敗 ${status.ncdr.failedDetail}）`);
    } catch (e) {
      status.ncdr = { ok: false, error: e.message };
      console.error(`NCDR 災防示警失敗：${e.message}`);
    }
  } else status.ncdr = { skipped: true };

  // --- 官方來源 registry：互相獨立、平行執行、fail-soft ---
  const {
    freshByKey: officialFresh,
    statusByKey: officialStatus,
    labelsByKey: officialLabels,
  } = await fetchDirectOfficialSources({ wants: want });
  Object.assign(status, officialStatus);

  // --- 台灣警政新聞：全量收錄（解耦）---
  //  抓取層 perFeed 拉滿、全量去重 → LLM 精修最近一批（地理定位上地球儀）＋其餘輕量收錄（免 LLM）。
  let twnews = [];
  let twFeedStatus = [];
  if (want("twnews")) {
    try {
      const rss = await fetchRssItems({ perFeed: 100, feeds: TW_NEWS_FEEDS, concurrency: 6 });
      twFeedStatus = rss.feedStatus;
      const gnHealth = googleNewsHealth(twFeedStatus);
      if (!twFeedStatus.some((f) => f.ok)) {
        throw new Error("all twnews RSS feeds failed");
      }
      if (gnHealth.systemic) {
        console.warn(`[GN健康] 系統性異常：${gnHealth.gnOk}/${gnHealth.gnFeeds} GN feed 正常（okRate ${gnHealth.okRate}）`);
      }
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
      const policeUniq = uniq.filter((it) => isRelevantNewsItem(it));
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
      const deliveredTwnews = twnews.filter((event) =>
        shouldRetainTwNewsEvent(event, {
          retentionDays: RETENTION_DAYS,
          advisoryRetentionDays: ADVISORY_RETENTION_DAYS,
          now: nowMs,
        }),
      );
      const sourceContribution = buildNewsSourceContribution({
        rawItems: rss.items,
        uniqueItems: uniq,
        policeItems: policeUniq,
        preRetentionEvents: twnews,
        finalEvents: deliveredTwnews,
        feedStatus: twFeedStatus,
      });
      const categoryBasis = buildCategoryBasisDistribution(deliveredTwnews);
      const relevanceAudit = buildNewsRelevanceAudit(uniq, {
        generatedAt: nowIso,
        sampleSize: Number(process.env.NEWS_RELEVANCE_SAMPLE_SIZE) || 20,
      });
      status.twnews = {
        ok: true,
        normalizeFailed: domesticNormalizeFailed(),
        ...(lastDomesticNormalizeSkippedBatches > 0 ? { normalizeSkippedBatches: lastDomesticNormalizeSkippedBatches } : {}),
        count: twnews.length,
        enriched: enriched.length,
        bulk: bulk.length,
        policeRelevant: policeUniq.length,
        rawUnique,
        relevanceAudit: relevanceAudit.population,
        categoryBasis,
        gnHealth,
        sourceContribution: sourceContribution.rows,
        sourceContributionTotals: sourceContribution.totals,
        lowContributionFeeds: sourceContribution.lowContributionFeeds,
        feeds: twFeedStatus,
      };
      writeJson("news-relevance-audit.json", relevanceAudit);
      console.log(`台灣新聞：警政 ${twnews.length} 筆（LLM 精修 ${enriched.length}＋輕量 ${bulk.length}；警政相關 ${policeUniq.length}／全量去重 ${rawUnique}）`);
      console.log(`新聞相關性抽樣：近 24 小時通過 ${relevanceAudit.population.accepted}／排除 ${relevanceAudit.population.rejected}`);
      console.log(formatNewsSourceContributionReport(sourceContribution, { limit: 20 }));
    } catch (e) {
      status.twnews = { ok: false, error: e.message, feeds: twFeedStatus };
      console.error(`台灣新聞失敗：${e.message}`);
    }
  } else status.twnews = { skipped: true };

  // --- 國內快照（last-good carry-over：單源失敗則沿用舊快照中該源事件，保留舊 fetchedAt）---
  const oldDomestic = readOld("domestic.json");
  // 地震與天氣警特報同屬「災防」類，carry-over 必須依 datasetId 精準切分，避免互相吃到對方。
  const quakeEvents = carryOver({ status: status.cwa, fresh: quakes, dropStale, oldEvents: oldDomestic, match: "E-A0015-001" });
  const warningEvents = carryOver({ status: status.cwaWarnings, fresh: warnings, dropStale, oldEvents: oldDomestic, match: "W-C0033-001" });
  const ncdrEvents = carryOver({ status: status.ncdr, fresh: ncdr, dropStale, oldEvents: oldDomestic, match: NCDR_DATASET_ID });
  const officialEventsByKey = Object.fromEntries(
    DIRECT_OFFICIAL_SOURCE_KEYS.map((key) => {
      const meta = OFFICIAL_SOURCE_META[key];
      return [
        key,
        carryOver({
          status: status[key],
          fresh: officialFresh[key],
          dropStale,
          oldEvents: oldDomestic,
          match: (event) => (OFFICIAL_SOURCE_DATASET_IDS[key] || [meta.datasetId]).includes(event.source?.datasetId),
        }),
      ];
    }),
  );
  const officialEvents = Object.values(officialEventsByKey).flat();
  const why = (st) => (st?.skipped ? "本次未選" : "失敗");
  if (!status.cwa?.ok && quakeEvents.length) console.warn(`地震${why(status.cwa)}，沿用舊快照 ${quakeEvents.length} 筆`);
  if (!status.cwaWarnings?.ok && warningEvents.length)
    console.warn(`天氣警特報${why(status.cwaWarnings)}，沿用舊快照 ${warningEvents.length} 筆`);
  if (!status.ncdr?.ok && ncdrEvents.length) console.warn(`NCDR 災防示警${why(status.ncdr)}，沿用舊快照 ${ncdrEvents.length} 筆`);
  for (const [key, events] of Object.entries(officialEventsByKey)) {
    if (status[key]?.ok === false && events.length) {
      console.warn(`${officialLabels[key]}失敗，沿用舊快照 ${events.length} 筆`);
    }
  }
  // 跨輪累積 + 保留窗：成功時 union 本輪與舊 tw-news（recordRef→標題去重，本輪優先以保留 LLM 精修版），
  // 再剪掉超過保留窗者 → 量隨時間複利成長到保留窗深度，每輪仍只 when:Nd 抓增量、LLM 成本不變。
  const oldNews = oldDomestic.filter((e) => e.source?.datasetId === "tw-news");
  const newsEvents = buildTwNewsEvents({
    twnews,
    oldNews,
    twnewsStatus: status.twnews,
    dropStaleNews: dropStale(status.twnews),
    retentionDays: RETENTION_DAYS,
    advisoryRetentionDays: ADVISORY_RETENTION_DAYS,
    now: nowMs,
  });
  if (status.twnews?.ok && twnews.length) {
    console.log(
      `台灣新聞累積：本輪 ${twnews.length}＋舊 ${oldNews.length} → 去重保留 ${newsEvents.length} 筆（一般保留窗 ${RETENTION_DAYS} 天；公告保留窗 ${ADVISORY_RETENTION_DAYS} 天）`,
    );
  } else if (!status.twnews?.ok && newsEvents.length) {
    console.warn(`台灣新聞${why(status.twnews)}，沿用舊快照 ${newsEvents.length} 筆`);
  }
  const oldNewsFingerprints = new Set(oldNews.map(eventFingerprint));
  const newNewsEvents = newsEvents.filter((event) => !oldNewsFingerprints.has(eventFingerprint(event)));

  const corePoliceEvents = carryOver({
    status: status.police,
    fresh: policeResult.events,
    dropStale,
    oldEvents: oldDomestic,
    match: (event) => event.source?.datasetId === "13166" || event.id?.startsWith("crime-week-"),
  });
  const missingEvents = carryOver({
    status: status.missing,
    fresh: missing,
    dropStale,
    oldEvents: oldDomestic,
    match: (event) => event.source?.datasetId === "14420" || event.id?.startsWith("missing-"),
  });
  const policeEvents = [...corePoliceEvents, ...missingEvents];
  let policeHourly = null;
  if (status.police?.ok) {
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
    const policeMinimum = calibratePoliceHourlyMinimum({
      generatedAt: nowIso,
      previousHistory,
      fallback: POLICE_NEW_PER_HOUR_FALLBACK,
    });
    policeHourly = applyPoliceHourlyRun({
      generatedAt: nowIso,
      events: [...newNewsEvents, ...policeEvents.filter((event) => event.source?.datasetId === "7505")],
      previousHistory,
      previousLedger,
      minimumNewPerHour: policeMinimum.minimumNewPerHour,
      retentionDays: Number(process.env.POLICE_HISTORY_RETENTION_DAYS) || 7,
    });
    policeHourly.history.calibration = policeMinimum;
    status.police.newMinimumPerHour = policeMinimum.minimumNewPerHour;
    status.police.newMinimumLookbackDays = policeMinimum.lookbackDays;
    status.police.newMinimumPercentile = policeMinimum.percentile;
    status.police.newMinimumSampleSize = policeMinimum.sampleSize;
    status.police.hourLocal = policeHourly.run.hourLocal;
    status.police.newPoliceRelatedCount = policeHourly.run.newPoliceRelatedCount;
    status.police.duplicateFromPriorCount = policeHourly.run.duplicateFromPriorCount;
    status.police.deferredNewCandidateCount = policeHourly.run.deferredNewCandidateCount;
    status.police.meetsNewHourlyMinimum = policeHourly.run.meetsNewHourlyMinimum;
    if (!policeHourly.run.meetsNewHourlyMinimum) {
      console.warn(
        `警政新聞全新資料不足：${policeHourly.run.newPoliceRelatedCount}/${policeMinimum.minimumNewPerHour}（7 日 P${policeMinimum.percentile}，${policeMinimum.sampleSize} 個有效時段；重複 ${policeHourly.run.duplicateFromPriorCount} 筆）`,
      );
    }
  } else if (corePoliceEvents.length) {
    console.warn(`警政${why(status.police)}，沿用舊快照 ${corePoliceEvents.length} 筆`);
  }

  const domesticClamp = clampImplausibleTimestamps([
    ...quakeEvents,
    ...warningEvents,
    ...ncdrEvents,
    ...officialEvents,
    ...policeEvents,
    ...newsEvents,
  ]);
  if (domesticClamp.clamped) console.warn(`[時間戳] 夾住 ${domesticClamp.clamped} 筆遠未來時間戳（疑來源解析錯誤，如民國→西元誤植）`);
  const domesticEvents = applyTemporal(domesticClamp.events.sort(byTimeDesc), { now: nowMs, historicalDays: TEMPORAL_HISTORICAL_DAYS });
  const temporalCounts = domesticEvents.reduce(
    (acc, event) => {
      if (event.temporal === "historical") acc.historical++;
      else if (event.temporal === "judicial") acc.judicial++;
      return acc;
    },
    { historical: 0, judicial: 0 },
  );
  console.log(`[時效] historical ${temporalCounts.historical} 筆 / judicial ${temporalCounts.judicial} 筆`);
  if (domesticEvents.length) {
    const { valid, invalid } = validateEventContract(domesticEvents);
    if (invalid.length) {
      console.error(
        `[合約] domestic.json：${invalid.length}/${domesticEvents.length} 筆不符 IntelEvent 契約，已剔除（範例 ${invalid[0].id}: ${invalid[0].reason}）`,
      );
    }
    if (!valid.length) {
      console.error("[合約] domestic.json 全部事件不符契約，疑似 mapper 欄位漂移；保留舊 domestic.json，本輪標記失敗。");
      process.exitCode = 1;
    } else {
      writeJson("domestic.json", valid);
    }
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
  const freshIntlEvents = [...(status.international?.ok ? intl : []), ...(status.mofa?.ok ? mofa : [])];
  const intlOk = freshIntlEvents.length > 0;
  const dropIntlStale = dropStale(status.international) && dropStale(status.mofa);
  // 累積式滾動視窗：成功時合併本輪 + 舊快照（依 id 去重、保留近 INTL_RETENTION_DAYS 天、
  // 分主題輪詢挑選至 INTL_ACCUM_CAP），取代「每輪只留當輪 ≤maxEvents」，讓國際數量穩定更多、主題分布更廣。
  const intlEvents = intlOk
    ? accumulateInternational(freshIntlEvents, oldIntl, {
        retentionDays: Number(process.env.INTL_RETENTION_DAYS) || 5,
        // 預設 rolling cap 提高，讓新增的一般國際／警政來源能在五日窗口內留下；可由 CI 以 INTL_ACCUM_CAP 覆蓋。
        cap: Number(process.env.INTL_ACCUM_CAP) || 400,
      })
    : dropIntlStale
      ? []
      : oldIntl;
  if (intlOk) {
    const { valid, invalid } = validateEventContract(intlEvents);
    if (invalid.length) {
      console.error(
        `[合約] international.json：${invalid.length}/${intlEvents.length} 筆不符 IntelEvent 契約，已剔除（範例 ${invalid[0].id}: ${invalid[0].reason}）`,
      );
    }
    if (!valid.length) {
      console.error("[合約] international.json 全部事件不符契約，疑似 mapper 欄位漂移；保留舊 international.json，本輪標記失敗。");
      process.exitCode = 1;
    } else {
      writeJson("international.json", valid);
    }
  } else if (dropIntlStale) {
    writeJson("international.json", []);
    console.warn("國際本次未選（EXCLUSIVE），清空 international.json");
  } else if (intlEvents.length) {
    console.warn(`國際未更新（${status.international?.skipped ? "本次未選" : "失敗"}），沿用舊快照 ${intlEvents.length} 筆`);
  } else {
    console.warn("國際無任何事件，保留舊 international.json");
  }

  const prevRollup = readJson("daily-rollup.json", { days: {} });
  // 清單型 reference 來源（設施點位/歷史批次/統計）不進事件統計，避免灌水（保留於地圖/tree）
  const domesticIncidents = domesticEvents.filter((e) => !isReferenceEvent(e));
  const dailyRollup = applyDailyRollup(prevRollup, [...domesticIncidents, ...intlEvents]);
  writeJson("daily-rollup.json", dailyRollup);
  const rollupToday = taiwanLocalDay(nowIso);
  const rollupTodayDomestic = rollupToday
    ? domesticEvents.filter((event) => taiwanLocalDay(event.timestamp) === rollupToday).length
    : 0;
  const rollupTodayInternational = rollupToday
    ? intlEvents.filter((event) => taiwanLocalDay(event.timestamp) === rollupToday).length
    : 0;
  console.log(
    `[rollup] 每日基線 ${Object.keys(dailyRollup.days || {}).length} 天（今日 domestic ${rollupTodayDomestic} / international ${rollupTodayInternational}）`,
  );

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
    const contractErrors = validateNetworkContract(network);
    if (contractErrors.length) {
      throw new Error(`產物契約驗收失敗：\n${formatNetworkContractErrors(NETWORK_FILE, contractErrors)}`);
    }
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
    const summary = await summarize({ domestic: domesticIncidents, international: intlEvents, clusters: domesticClusters });
    writeJson("summary.json", summary);
    status.summary = { ok: true };
    console.log("AI 摘要：完成");
  } catch (e) {
    status.summary = { ok: false, error: e.message };
    console.error(`AI 摘要失敗：${e.message}`);
  }

  // --- provenance（誠實標註；carry-over 來源標 stale 並用舊 fetchedAt）---
  const sources = [];
  const previousProvenance = readJson("provenance.json", { sources: [] });
  const previousSources = Array.isArray(previousProvenance?.sources) ? previousProvenance.sources : [];
  const latestFetchedAt = (events) => (Array.isArray(events) ? events : [])
    .map((event) => event?.source?.fetchedAt)
    .filter((value) => value && Number.isFinite(Date.parse(value)))
    .sort()
    .pop();
  const previousSourceFor = ({ datasetId, key, name }) => {
    if (key) {
      const exact = previousSources.find((source) =>
        source?.key === key
          && (!datasetId || source?.datasetId === datasetId)
          && (!name || source?.name === name),
      );
      if (exact) return exact;
    }
    if (datasetId) {
      const exact = previousSources.find((source) =>
        source?.datasetId === datasetId && (!name || source?.name === name),
      );
      if (exact) return exact;
    }
    return name ? previousSources.find((source) => source?.name === name) : undefined;
  };
  const sourceHealthFields = ({ sourceStatus, events, datasetId, key, name }) => {
    const previous = previousSourceFor({ datasetId, key, name });
    const successful = sourceStatus?.ok === true;
    const configured = sourceStatus?.configured !== false;
    const attempted = sourceStatus && (sourceStatus.skipped !== true || configured === false);
    const eventSuccessAt = latestFetchedAt(events);
    const previousSuccessAt = previous?.lastSuccessAt
      || (previous?.stale !== true ? previous?.fetchedAt : undefined)
      || eventSuccessAt;
    const lastSuccessAt = successful ? eventSuccessAt || nowIso : previousSuccessAt;
    const stale = sourceStatus?.skipped === true && configured
      ? previous?.stale
      : successful
        ? undefined
        : true;
    return {
      configured,
      fetchedAt: lastSuccessAt,
      lastSuccessAt,
      lastAttemptAt: attempted ? nowIso : previous?.lastAttemptAt,
      stale: stale || undefined,
      // 新鮮度稽核據此把「本輪抓取模式未涵蓋」的陳舊來源降為警告（停擺後 hourly 才能自癒）
      skippedThisRun: attempted ? undefined : true,
      ...(sourceStatus?.error ? { error: sourceStatus.error } : {}),
    };
  };
  if (quakeEvents.length || want("cwa"))
    sources.push({
      name: "中央氣象署 顯著有感地震報告",
      type: "cwa",
      datasetId: "E-A0015-001",
      scope: "domestic",
      category: "災防",
      count: quakeEvents.length,
      ...sourceHealthFields({ sourceStatus: status.cwa, events: quakeEvents, datasetId: "E-A0015-001" }),
      query: "CWA opendata API E-A0015-001 (顯著有感地震報告)",
      license: "政府資料開放授權條款-第1版 — 交通部中央氣象署",
    });
  if (warningEvents.length || want("cwa"))
    sources.push({
      name: "中央氣象署 天氣警特報",
      type: "cwa",
      datasetId: "W-C0033-001",
      scope: "domestic",
      category: "災防",
      count: warningEvents.length,
      ...sourceHealthFields({ sourceStatus: status.cwaWarnings, events: warningEvents, datasetId: "W-C0033-001" }),
      query: "CWA opendata API W-C0033-001 (天氣特報-各縣市目前天氣警特報情形)",
      license: "政府資料開放授權條款-第1版 — 交通部中央氣象署",
    });
  if (ncdrEvents.length || want("ncdr") || previousSourceFor({ datasetId: NCDR_DATASET_ID }))
    sources.push({
      name: "NCDR 災防示警 CAP",
      type: "gov-open-data",
      datasetId: NCDR_DATASET_ID,
      scope: "domestic",
      category: "災防",
      count: ncdrEvents.length,
      maxAgeHours: 6,
      ...sourceHealthFields({ sourceStatus: status.ncdr, events: ncdrEvents, datasetId: NCDR_DATASET_ID }),
      query: "NCDR JSON Atom Feed + CAP 1.2 明細（突發地理示警白名單）",
      license: "政府資料開放授權條款-第1版 — 國家災害防救科技中心／發布機關",
    });
  if (policeEvents.length || want("police")) {
    const policeSourceDefs = [
      { key: "crimeWeekly", name: "警政署 犯罪資料統計週報", datasetId: "13166", category: "治安" },
      { key: "missing", name: "警政署 失蹤人口查尋", datasetId: "14420", category: "協尋" },
    ];
    for (const def of policeSourceDefs) {
      const currentEvents = policeEvents.filter((event) => event.source?.datasetId === def.datasetId);
      const count = currentEvents.length;
      const sub = status.police?.[def.key];
      const previousEvents = oldDomestic.filter((event) => event.source?.datasetId === def.datasetId);
      if (!count && !sub && !previousEvents.length) continue;
      const defStatus = def.key === "missing"
        ? status.missing || status.police
        : sub || (count && status.police?.ok ? { ok: true } : status.police);
      sources.push({
        key: def.key,
        name: def.name,
        type: "gov-open-data",
        datasetId: def.datasetId,
        scope: "domestic",
        category: def.category,
        count,
        ...sourceHealthFields({
          sourceStatus: defStatus,
          events: currentEvents.length ? currentEvents : previousEvents,
          datasetId: def.datasetId,
          key: def.key,
          name: def.name,
        }),
        query: def.key === "crimeWeekly"
          ? "data.gov.tw 13166 ZIP → latest ODS"
          : "內政部警政署失蹤人口查尋公開頁面",
        license: "政府資料開放授權條款-第1版 — 內政部警政署／地方政府警察局",
      });
    }
  }
  if (newsEvents.length) {
    const newsByFeed = new Map();
    for (const e of newsEvents) {
      const name = e.source.feedLabel || e.source.name;
      const key = `${name}\u0000${e.category || "治安"}`;
      if (!newsByFeed.has(key)) newsByFeed.set(key, { name, category: e.category || "治安", count: 0, source: e.source });
      newsByFeed.get(key).count++;
    }
    for (const { name, category, count, source } of newsByFeed.values()) {
      sources.push({
        name: `台灣新聞：${name}`,
        type: "news-rss",
        datasetId: "tw-news",
        scope: "domestic",
        category,
        count,
        fetchedAt: source?.fetchedAt || nowIso,
        authority: source?.authority,
        jurisdiction: source?.jurisdiction,
        stale: !status.twnews?.ok || undefined,
        query: `台灣社會新聞 RSS → LLM(${respondedModel()}) 正規化`,
        license: source?.authority === "official"
          ? "政府網站資料開放宣告；實際授權條款以原始來源網站為準"
          : "各新聞媒體著作權所有；本平台僅彙整標題/摘要與原文連結，分類與座標為 LLM 衍生",
      });
    }
  }
  const mofaEvents = intlEvents.filter((e) => e.source?.datasetId === "mofa-travel-warning");
  if (mofaEvents.length || want("mofa") || previousSourceFor({ datasetId: "mofa-travel-warning" }))
    sources.push({
      name: "外交部領事事務局 旅遊警示",
      type: "gov-open-data",
      datasetId: "mofa-travel-warning",
      scope: "international",
      category: "地緣政治",
      count: mofaEvents.length,
      maxAgeHours: 6,
      ...sourceHealthFields({ sourceStatus: status.mofa, events: mofaEvents, datasetId: "mofa-travel-warning" }),
      query: "外交部領事事務局 國外旅遊警示 RSS（結構化燈號映射，不經 LLM）",
      license: "政府網站資料開放宣告 — 外交部領事事務局",
    });
  for (const key of DIRECT_OFFICIAL_SOURCE_KEYS) {
    const meta = OFFICIAL_SOURCE_META[key];
    const events = officialEventsByKey[key] || [];
    const datasetIds = OFFICIAL_SOURCE_DATASET_IDS[key] || [meta.datasetId];
    const previous = datasetIds.map((datasetId) => previousSourceFor({ datasetId })).find(Boolean);
    if (!events.length && !want(key) && !previous) continue;
    const eventSource = events[0]?.source;
    const effectiveMeta = eventSource
      ? {
        ...meta,
        ...Object.fromEntries(
          ["name", "type", "datasetId", "scope", "category", "query", "license", "cadence", "maxAgeHours", "latestDataDate"]
            .filter((field) => eventSource[field] != null)
            .map((field) => [field, eventSource[field]]),
        ),
      }
      : meta;
    sources.push({
      ...effectiveMeta,
      count: events.length,
      ...sourceHealthFields({
        sourceStatus: status[key],
        events,
        datasetId: effectiveMeta.datasetId,
        name: effectiveMeta.name,
      }),
    });
  }
  const internationalFeedLabels = new Set();
  for (const f of feedStatus) {
    const name = `國際新聞：${f.label}`;
    internationalFeedLabels.add(name);
    const events = intlEvents.filter((e) => e.source?.feedLabel === f.label || e.source?.name === f.label);
    const sourceStatus = f.ok === true ? { ok: true } : { ok: false, error: f.error || "來源抓取失敗" };
    sources.push({
      name,
      type: "news-rss",
      scope: "international",
      category: f.hint || (f.method === "gdelt-doc" ? "地緣政治" : undefined),
      count: events.length,
      authority: f.official === true ? "official" : undefined,
      query: f.method === "gdelt-doc"
        ? `GDELT DOC ${status.gdelt?.query || ""} → LLM(${respondedModel()}) 正規化`
        : `RSS ${f.label} → LLM(${respondedModel()}) 正規化`,
      ...sourceHealthFields({ sourceStatus, events, name }),
    });
  }
  if (!status.international?.ok) {
    // carry-over：由舊國際快照還原未出現在本輪 feedStatus 的來源（標 stale）。
    const byName = {};
    for (const e of intlEvents) {
      if (e.source?.datasetId === "mofa-travel-warning") continue;
      const name = `國際新聞：${e.source?.feedLabel || e.source?.name}`;
      if (internationalFeedLabels.has(name)) continue;
      byName[name] = (byName[name] || 0) + 1;
    }
    for (const [name, count] of Object.entries(byName)) {
      const event = intlEvents.find((e) => `國際新聞：${e.source?.feedLabel || e.source?.name}` === name);
      sources.push({
        name,
        type: "news-rss",
        scope: "international",
        count,
        fetchedAt: event?.source?.fetchedAt || nowIso,
        lastSuccessAt: event?.source?.fetchedAt || nowIso,
        stale: true,
        query: `RSS ${name.slice("國際新聞：".length)} → LLM(${respondedModel()}) 正規化`,
      });
    }
  }

  writeJson("coverage.json", buildCoverageMatrix({
    generatedAt: nowIso,
    events: [...domesticEvents, ...intlEvents],
    sources,
  }));
  writeJson("domain-coverage.json", buildDomainCoverage({ generatedAt: nowIso, sources, enabledSourceKeys: sourceKeys }));

  writeJson("provenance.json", {
    generatedAt: nowIso,
    note:
      "Live 抓取。座標：採購為依機關所在縣市/區中心推估、新聞事件為 LLM 依事件地點推估，皆非原始資料欄位；地震為真實震央。風險等級為衍生指標（採購依決標金額、地震依規模、新聞由 LLM 依嚴重度判定），非原始欄位。新聞摘要與分類由 LLM " +
      respondedModel() +
      " 自 RSS 原文生成，原始連結保留可回溯。MND、CDC、TFDA、海巡署、TWCERT/CC、台電、水利署與 MOFA/NCDR 皆為官方資料的規則映射，不經 LLM。",
    pipeline: status,
    sources,
  });

  console.log("\n=== 完成 ===");
  console.log(JSON.stringify(status, null, 2));
}

if (process.argv[1] === __filename) {
  run().catch((e) => {
    console.error("PIPELINE FATAL:", e);
    process.exit(1);
  });
}
