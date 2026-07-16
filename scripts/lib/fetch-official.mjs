// 官方資料源：MND、CDC、TFDA、海巡署、TWCERT/CC、台電與水利署。
// 僅做官方資料的保守規則映射，不經 LLM；共用網路與來源 metadata，避免重複框架。
import { createHash } from "node:crypto";
import { countyCoordFromAddr } from "./coords.mjs";
import { detectCounty } from "./news-bulk.mjs";

const MND_BASE = "https://air.mnd.gov.tw";
const MND_LIST_URL = `${MND_BASE}/TW/News/News_List.aspx?CID=213`;
const CDC_URL = "https://od.cdc.gov.tw/eic/RODS_Influenza_like_illness.json";
const CDC_WEEKLY_BASE = "https://www.cdc.gov.tw";
const CDC_WEEKLY_URL = `${CDC_WEEKLY_BASE}/Category/Page/5f7iWnXma8LNhr_Q_7FVrQ`;
const CDC_WEEKLY_DATASET_ID = "cdc-weekly-surveillance-report";
const TFDA_URL = "https://data.fda.gov.tw/data/opendata/export/52/json";
const CGA_BASE = "https://www.cga.gov.tw";
const CGA_URL = `${CGA_BASE}/GipOpen/wSite/lp?ctNode=650&mp=999`;
const TWCERT_URL = "https://www.twcert.org.tw/tw/rss-132-1.xml";
const TAIPOWER_URL = "https://service.taipower.com.tw/data/opendata/apply/file/d006020/001.json";
const WRA_URL = "https://www.wra.gov.tw/ReservoirWarningTable.aspx?n=46046";

export const OFFICIAL_SOURCE_META = {
  mnd: {
    name: "國防部空軍 臺海周邊海空域動態",
    type: "gov-open-data",
    datasetId: "mnd-pla-activity",
    scope: "domestic",
    category: "國防",
    query: "國防部空軍每日臺海周邊海、空域動態",
    license: "政府網站資料開放宣告 — 國防部空軍司令部",
    cadence: "daily",
    maxAgeHours: 48,
  },
  cdc: {
    name: "衛生福利部疾病管制署 類流感急診就診人次",
    type: "gov-open-data",
    datasetId: "cdc-rods-influenza",
    scope: "domestic",
    category: "衛生",
    query: "CDC 開放資料 RODS_Influenza_like_illness 最新週全國彙總",
    license: "政府資料開放授權條款-第1版 — 衛生福利部疾病管制署",
    cadence: "daily",
    maxAgeHours: 48,
  },
  tfda: {
    name: "衛生福利部食品藥物管理署 邊境查驗不符合食品資訊",
    type: "gov-open-data",
    datasetId: "tfda-noncompliant-food",
    scope: "domestic",
    category: "食安",
    query: "TFDA 開放資料第 52 號 邊境查驗不符合食品資訊",
    license: "政府資料開放授權條款-第1版 — 衛生福利部食品藥物管理署",
    cadence: "daily",
    maxAgeHours: 48,
  },
  cga: {
    name: "海洋委員會海巡署 海巡新聞",
    type: "gov-open-data",
    datasetId: "cga-maritime-news",
    scope: "domestic",
    category: "海事",
    query: "海巡署海巡新聞清單：海域執法、救援、走私與偷渡事件",
    license: "政府網站資料開放宣告 — 海洋委員會海巡署",
    cadence: "hourly",
    maxAgeHours: 6,
  },
  twcert: {
    name: "TWCERT/CC 台灣漏洞揭露平台 TVN",
    type: "gov-open-data",
    datasetId: "twcert-tvn-rss",
    scope: "domestic",
    category: "資安",
    query: "TWCERT/CC TVN 漏洞公告 RSS",
    license: "政府網站資料開放宣告 — 國家資通安全研究院 TWCERT/CC",
    cadence: "hourly",
    maxAgeHours: 6,
  },
  taipower: {
    name: "台灣電力公司 今日系統供需狀況",
    type: "gov-open-data",
    datasetId: "taipower-supply-demand",
    scope: "domestic",
    category: "能源",
    query: "台電開放資料 d006020 今日每 10 分鐘系統供需狀況",
    license: "政府資料開放授權條款-第1版 — 台灣電力股份有限公司",
    cadence: "10min",
    maxAgeHours: 2,
  },
  wra: {
    name: "經濟部水利署 水庫水情一覽表",
    type: "gov-open-data",
    datasetId: "wra-reservoir-levels",
    scope: "domestic",
    category: "水情",
    query: "水利署水庫水情一覽表：蓄水率低於或等於 70%",
    license: "政府網站資料開放宣告 — 經濟部水利署",
    cadence: "hourly",
    maxAgeHours: 6,
  },
};

export const OFFICIAL_SOURCE_DATASET_IDS = Object.fromEntries(
  Object.entries(OFFICIAL_SOURCE_META).map(([key, meta]) => [
    key,
    key === "cdc" ? [meta.datasetId, CDC_WEEKLY_DATASET_ID] : [meta.datasetId],
  ]),
);

function stableId(prefix, value) {
  return `${prefix}-${createHash("sha1").update(String(value)).digest("hex").slice(0, 16)}`;
}

function compact(value, max = 500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function taiwanDateIso(value, fallback) {
  const match = String(value || "").match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return fallback;
  const [, y, m, d, hh = "00", mm = "00", ss = "00"] = match;
  const parsed = new Date(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${hh.padStart(2, "0")}:${mm}:${ss}+08:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function officialDateIso(value, fallback) {
  const text = String(value || "").trim();
  const roc = text.match(/(\d{3})[.\/-](\d{1,2})[.\/-](\d{1,2})(?:\([^)]*\))?(?:\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (roc) {
    const [, rocYear, month, day, hour = "00", minute = "00", second = "00"] = roc;
    return taiwanDateIso(
      `${Number(rocYear) + 1911}/${month}/${day} ${hour}:${minute}:${second}`,
      fallback,
    );
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : taiwanDateIso(text, fallback);
}

function isRetriableFetchError(error) {
  const status = Number(error?.status);
  return error?.name === "TypeError"
    || error?.name === "TimeoutError"
    || error?.name === "AbortError"
    || status === 408
    || status === 429
    || status >= 500;
}

function fetchErrorDetail(error) {
  const cause = error?.cause;
  return [error?.message, cause?.code, cause?.message]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(": ");
}

async function fetchChecked(url, {
  fetchImpl = fetch,
  timeoutMs = 30000,
  json = false,
  attempts = 1,
  retryDelayMs = 1000,
  headers,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers });
      if (!response.ok) {
        const error = new Error(`${new URL(url).hostname} HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return json ? response.json() : response.text();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetriableFetchError(error)) break;
      if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }
  }
  throw new Error(`${new URL(url).hostname} ${fetchErrorDetail(lastError) || "fetch failed"}`, { cause: lastError });
}

export function parseMndActivityLinks(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["']([^"']*News_Detail\.aspx\?CID=213(?:&amp;|&)ID=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || "").matchAll(re)) {
    if (seen.has(match[2])) continue;
    const text = decodeHtml(match[3]);
    const date = text.match(/(\d{4}\/\d{2}\/\d{2})\s*$/)?.[1] || "";
    const title = compact(date ? text.slice(0, -date.length) : text, 180);
    if (!title) continue;
    seen.add(match[2]);
    out.push({
      id: match[2],
      title,
      date,
      url: new URL(match[1].replace(/&amp;/g, "&"), MND_BASE).toString(),
    });
  }
  return out;
}

function mndRisk(detailText) {
  const aircraft = Number(detailText.match(/共機\s*(\d+)\s*架(?:次)?/)?.[1] || 0);
  const ships = Number(detailText.match(/共艦\s*(\d+)\s*艘(?:次)?/)?.[1] || 0);
  if (aircraft >= 50 || ships >= 20) return "critical";
  if (aircraft >= 20 || ships >= 10) return "high";
  if (aircraft > 0 || ships > 0) return "medium";
  return "low";
}

export function mapMndActivityEvent(item, { fetchedAt = new Date().toISOString() } = {}) {
  const detail = compact(item?.detailText || item?.title, 600);
  const activity = detail.match(/迄(?:今日)?\s*\d{4}時止[^。；]{0,300}[。；]?/)?.[0] || detail;
  return {
    id: stableId("mnd", item?.id || item?.url || item?.title),
    title: compact(item?.title, 180) || "國防部臺海周邊海空域動態",
    region: "臺灣周邊海空域",
    timestamp: taiwanDateIso(item?.date, fetchedAt),
    category: "國防",
    scope: "domestic",
    riskLevel: mndRisk(activity),
    riskBasis: "依官方公布共機與共艦架次分級之衍生指標",
    summary: activity,
    locationPrecision: "country",
    source: {
      ...OFFICIAL_SOURCE_META.mnd,
      url: item?.url || MND_LIST_URL,
      fetchedAt,
      recordRef: item?.id || item?.url || item?.title,
      retentionPolicy: "stateful",
    },
  };
}

export async function fetchMndActivity({ limit = 7, fetchImpl = fetch } = {}) {
  const fetchedAt = new Date().toISOString();
  const list = parseMndActivityLinks(await fetchChecked(MND_LIST_URL, { fetchImpl })).slice(0, limit);
  if (!list.length) throw new Error("MND 臺海動態清單解析為 0 筆");
  const settled = await Promise.allSettled(list.map(async (item) => ({
    ...item,
    detailText: decodeHtml(await fetchChecked(item.url, { fetchImpl })),
  })));
  const items = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
  if (!items.length) throw new Error("MND 臺海動態明細全數抓取失敗");
  return items.map((item) => mapMndActivityEvent(item, { fetchedAt }));
}

function isoWeekEnd(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (week - 1) * 7);
  monday.setUTCDate(monday.getUTCDate() + 6);
  return monday.toISOString();
}

export function mapCdcInfluenzaEvent(rows, { fetchedAt = new Date().toISOString() } = {}) {
  const totals = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const year = Number(row?.年);
    const week = Number(row?.週);
    if (!Number.isInteger(year) || !Number.isInteger(week)) continue;
    const key = year * 100 + week;
    const count = Number(String(row?.類流感急診就診人次 ?? "").replace(/,/g, "")) || 0;
    totals.set(key, (totals.get(key) || 0) + count);
  }
  const keys = [...totals.keys()].sort((a, b) => a - b);
  if (!keys.length) throw new Error("CDC 類流感資料無有效週次");
  const currentKey = keys.at(-1);
  const previousKey = keys.at(-2);
  const current = totals.get(currentKey);
  const previous = previousKey ? totals.get(previousKey) : 0;
  const year = Math.floor(currentKey / 100);
  const week = currentKey % 100;
  const changePct = previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;
  const riskLevel = changePct !== null && changePct >= 50 ? "high" : changePct !== null && changePct >= 20 ? "medium" : "low";
  const trend = changePct === null ? "無前週可比較" : `較前週${changePct >= 0 ? "增加" : "減少"} ${Math.abs(changePct)}%`;
  return {
    id: stableId("cdc-ili", currentKey),
    title: `CDC 類流感急診就診趨勢：${year} 年第 ${week} 週`,
    region: "全國",
    timestamp: isoWeekEnd(year, week),
    category: "衛生",
    scope: "domestic",
    riskLevel,
    riskBasis: "依最新週相較前週之就診人次增幅分級，非疫情預測",
    summary: `最新週類流感急診就診人次 ${current.toLocaleString("zh-TW")}；${trend}。`,
    locationPrecision: "country",
    source: {
      ...OFFICIAL_SOURCE_META.cdc,
      url: CDC_URL,
      fetchedAt,
      recordRef: `${year}-W${String(week).padStart(2, "0")}`,
      retentionPolicy: "stateful",
    },
  };
}

export function parseCdcWeeklyReports(html) {
  const reports = [];
  for (const rowMatch of String(html || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = rowMatch[1];
    const week = Number(row.match(/<td\b[^>]*headers=["']weeks["'][^>]*>\s*(\d+)\s*<\/td>/i)?.[1]);
    const dateRange = decodeHtml(row.match(/<td\b[^>]*headers=["']date["'][^>]*>([\s\S]*?)<\/td>/i)?.[1]);
    const link = row.match(/<td\b[^>]*headers=["']link["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const title = decodeHtml(link?.[2]);
    const year = Number(title.match(/_(\d{4})年第\d+週/i)?.[1] || dateRange.match(/^(\d{4})\//)?.[1]);
    if (!Number.isInteger(year) || !Number.isInteger(week) || !dateRange || !link?.[1] || !title) continue;
    reports.push({
      year,
      week,
      dateRange,
      url: new URL(link[1], CDC_WEEKLY_BASE).toString(),
      title,
    });
  }
  return reports.sort((a, b) => (b.year * 100 + b.week) - (a.year * 100 + a.week));
}

function mapCdcWeeklyReportEvent(report, { fetchedAt = new Date().toISOString() } = {}) {
  const endDate = report.dateRange.match(/-\s*(\d{4}\/\d{1,2}\/\d{1,2})\s*$/)?.[1];
  return {
    id: stableId("cdc-weekly", `${report.year}-W${report.week}`),
    title: `CDC 疫情監測週報：${report.year} 年第 ${report.week} 週`,
    region: "全國",
    timestamp: taiwanDateIso(endDate, fetchedAt),
    category: "衛生",
    scope: "domestic",
    riskLevel: "low",
    riskBasis: "僅表示最新官方監測週報已發布，未由 PDF 內容推導疫情強度",
    summary: `疾管署已發布 ${report.year} 年第 ${report.week} 週疫情監測週報，涵蓋期間 ${report.dateRange}；請開啟官方週報查閱各類傳染病最新監測。`,
    locationPrecision: "country",
    source: {
      ...OFFICIAL_SOURCE_META.cdc,
      name: "衛生福利部疾病管制署 例行疫情監測週報",
      datasetId: CDC_WEEKLY_DATASET_ID,
      query: "疾管署例行記者會疫情監測週報最新週",
      license: "政府網站資料開放宣告 — 衛生福利部疾病管制署",
      cadence: "weekly",
      maxAgeHours: 192,
      url: report.url,
      fetchedAt,
      recordRef: `${report.year}-W${String(report.week).padStart(2, "0")}`,
      retentionPolicy: "stateful",
      fallbackFrom: OFFICIAL_SOURCE_META.cdc.datasetId,
    },
  };
}

export async function fetchCdcInfluenza({ fetchImpl = fetch, retryDelayMs = 1000 } = {}) {
  const fetchedAt = new Date().toISOString();
  let rodsError;
  try {
    const rows = await fetchChecked(CDC_URL, {
      fetchImpl,
      timeoutMs: 90000,
      json: true,
      attempts: 3,
      retryDelayMs,
    });
    return [mapCdcInfluenzaEvent(rows, { fetchedAt })];
  } catch (error) {
    rodsError = error;
  }

  try {
    const html = await fetchChecked(CDC_WEEKLY_URL, {
      fetchImpl,
      timeoutMs: 30000,
      attempts: 2,
      retryDelayMs,
    });
    const report = parseCdcWeeklyReports(html)[0];
    if (!report) throw new Error("CDC 疫情監測週報清單解析為 0 筆");
    return [mapCdcWeeklyReportEvent(report, { fetchedAt })];
  } catch (weeklyError) {
    throw new Error(
      `CDC RODS 失敗（${fetchErrorDetail(rodsError)}）；官方週報 fallback 失敗（${fetchErrorDetail(weeklyError)}）`,
      { cause: weeklyError },
    );
  }
}

export function mapTfdaEvents(rows, {
  fetchedAt = new Date().toISOString(),
  now = Date.now(),
  retentionDays = 30,
  limit = 50,
} = {}) {
  const cutoff = now - retentionDays * 86400000;
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({ row, timestamp: taiwanDateIso(row?.發布日期, "") }))
    .filter(({ timestamp }) => Number.isFinite(Date.parse(timestamp)) && Date.parse(timestamp) >= cutoff)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, limit)
    .map(({ row, timestamp }) => {
      const recordRef = [row.發布日期, row.主旨, row.進口商名稱, row.產地].join("|");
      return {
        id: stableId("tfda", recordRef),
        title: `TFDA 邊境查驗不符合：${compact(row.主旨, 120) || "未命名食品"}`,
        region: "全國",
        timestamp,
        category: "食安",
        scope: "domestic",
        riskLevel: "medium",
        riskBasis: "官方判定不符合食品安全規定；事件已由邊境處置攔截",
        summary: compact(`產地：${row.產地 || "未提供"}；原因：${row.原因 || "未提供"}；處置：${row.處置情形 || "未提供"}`, 500),
        locationPrecision: "country",
        source: {
          ...OFFICIAL_SOURCE_META.tfda,
          url: row.附圖 || TFDA_URL,
          fetchedAt,
          recordRef,
          retentionPolicy: "stateful",
        },
      };
    });
}

export async function fetchTfdaNoncompliant({ fetchImpl = fetch, retentionDays = 30, limit = 50 } = {}) {
  const fetchedAt = new Date().toISOString();
  const rows = await fetchChecked(TFDA_URL, { fetchImpl, timeoutMs: 60000, json: true });
  if (!Array.isArray(rows) || !rows.length || !rows.some((row) => row && (row.主旨 || row.發布日期))) {
    throw new Error("TFDA 回應不是有效資料列陣列");
  }
  return mapTfdaEvents(rows, { fetchedAt, retentionDays, limit });
}

const OFFICIAL_USER_AGENT = { "User-Agent": "Mozilla/5.0 (taiwan-intel-dashboard pipeline)" };
const CGA_SIGNAL = /海警|偷渡|走私|毒品|槍|救援|救難|救溺|失聯|緝獲|查獲|驅離|扣押|漁船|船員|非法|魚槍|襲擾|海難/;

export function parseCgaNewsLinks(html) {
  const items = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["']([^"']*ct\?xItem=(\d+)[^"']*ctNode=650[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || "").matchAll(re)) {
    if (seen.has(match[2])) continue;
    const text = decodeHtml(match[3]);
    const date = text.match(/\b(\d{3}\/\d{1,2}\/\d{1,2})\b/)?.[1] || "";
    const title = compact(date ? text.replace(date, "") : text, 180);
    if (!title) continue;
    seen.add(match[2]);
    items.push({
      id: match[2],
      title,
      date,
      url: new URL(match[1].replace(/&amp;/g, "&"), CGA_URL).toString().replace(/^http:/, "https:"),
    });
  }
  return items;
}

function cgaRisk(title) {
  if (/宣教|宣導|講習|演練|研習|教育|座談/.test(title)) return "low";
  if (/死亡|罹難|失聯|翻覆|沉沒|偷渡|毒品|槍枝|槍械/.test(title)) return "high";
  if (/海警|襲擾|驅離|救援|救難|救溺|走私|緝獲|查獲|扣押|魚槍|海難/.test(title)) return "medium";
  return "low";
}

export function mapCgaEvents(items, {
  fetchedAt = new Date().toISOString(),
  now = Date.now(),
  retentionDays = 30,
  limit = 30,
} = {}) {
  const cutoff = now - retentionDays * 86400000;
  return (Array.isArray(items) ? items : [])
    .map((item) => ({ item, timestamp: officialDateIso(item?.date, fetchedAt) }))
    .filter(({ item, timestamp }) => CGA_SIGNAL.test(String(item?.title || ""))
      && Number.isFinite(Date.parse(timestamp)) && Date.parse(timestamp) >= cutoff)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, limit)
    .map(({ item, timestamp }) => {
      const coord = detectCounty(`${item.title} ${item.description || ""}`);
      const located = coord.region !== "全國";
      return {
        id: stableId("cga", item.id || item.url || item.title),
        title: compact(item.title, 180),
        region: located ? coord.region : "臺灣沿海",
        timestamp,
        category: "海事",
        scope: "domestic",
        riskLevel: cgaRisk(item.title),
        riskBasis: "依海巡署標題中的海域執法、救援與人員安全關鍵字分級",
        summary: compact(item.description || item.title, 500),
        ...(located
          ? { lat: coord.lat, lng: coord.lng, locationPrecision: "county-center" }
          : { locationPrecision: "country" }),
        source: {
          ...OFFICIAL_SOURCE_META.cga,
          url: item.url || CGA_URL,
          fetchedAt,
          recordRef: item.id || item.url || item.title,
          retentionPolicy: "stateful",
        },
      };
    });
}

export async function fetchCgaMaritime({ fetchImpl = fetch, limit = 30 } = {}) {
  const fetchedAt = new Date().toISOString();
  const html = await fetchChecked(CGA_URL, { fetchImpl, headers: OFFICIAL_USER_AGENT, attempts: 2 });
  const items = parseCgaNewsLinks(html);
  if (!items.length) throw new Error("海巡署新聞清單解析為 0 筆");
  return mapCgaEvents(items, { fetchedAt, limit });
}

function rssTag(block, tag) {
  return decodeHtml(String(block || "").match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1]);
}

export function parseTwcertRss(xml) {
  const items = [];
  for (const block of String(xml || "").match(/<item\b[\s\S]*?<\/item>/gi) || []) {
    const title = rssTag(block, "title");
    const url = rssTag(block, "link");
    if (!title || !url) continue;
    items.push({
      title,
      url,
      description: rssTag(block, "description"),
      pubDate: rssTag(block, "pubDate"),
    });
  }
  return items;
}

export function mapTwcertEvents(items, {
  fetchedAt = new Date().toISOString(),
  now = Date.now(),
  retentionDays = 30,
  limit = 50,
} = {}) {
  const cutoff = now - retentionDays * 86400000;
  return (Array.isArray(items) ? items : [])
    .map((item) => ({ item, timestamp: officialDateIso(item?.pubDate, fetchedAt) }))
    .filter(({ timestamp }) => Number.isFinite(Date.parse(timestamp)) && Date.parse(timestamp) >= cutoff)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, limit)
    .map(({ item, timestamp }) => ({
      id: stableId("twcert", item.url || item.title),
      title: `TWCERT/CC 漏洞公告：${compact(item.title, 150)}`,
      region: "全國",
      timestamp,
      category: "資安",
      scope: "domestic",
      riskLevel: "medium",
      riskBasis: "TWCERT/CC 已確認並發布 TVN 漏洞公告；未從標題推測 CVSS 或利用狀態",
      summary: compact(item.description || item.title, 500),
      locationPrecision: "country",
      source: {
        ...OFFICIAL_SOURCE_META.twcert,
        url: item.url || TWCERT_URL,
        fetchedAt,
        recordRef: item.url || item.title,
        retentionPolicy: "stateful",
      },
    }));
}

export async function fetchTwcertVulnerabilities({ fetchImpl = fetch, limit = 50 } = {}) {
  const fetchedAt = new Date().toISOString();
  const xml = await fetchChecked(TWCERT_URL, { fetchImpl, headers: OFFICIAL_USER_AGENT, attempts: 2 });
  const items = parseTwcertRss(xml);
  if (!items.length) throw new Error("TWCERT/CC TVN RSS 解析為 0 筆");
  return mapTwcertEvents(items, { fetchedAt, limit });
}

function taipowerRisk(reserveRate) {
  if (reserveRate < 6) return "critical";
  if (reserveRate < 10) return "high";
  if (reserveRate < 15) return "medium";
  return "low";
}

export function mapTaipowerSupplyEvent(payload, { fetchedAt = new Date().toISOString() } = {}) {
  const rows = Array.isArray(payload?.records) ? payload.records : [];
  const row = Object.assign({}, ...rows);
  const reserveRate = Number(row.fore_peak_resv_rate);
  if (!Number.isFinite(reserveRate)) throw new Error("台電供需資料缺少 fore_peak_resv_rate");
  const indicator = { G: "綠燈", Y: "黃燈", O: "橘燈", R: "紅燈" }[row.fore_peak_resv_indicator] || "燈號未提供";
  const timestamp = officialDateIso(row.publish_time, fetchedAt);
  return {
    id: stableId("taipower", row.publish_time || fetchedAt),
    title: `台電今日供電：預估備轉容量率 ${reserveRate}%（${indicator}）`,
    region: "全國",
    timestamp,
    category: "能源",
    scope: "domestic",
    riskLevel: taipowerRisk(reserveRate),
    riskBasis: "依台電預估尖峰備轉容量率衍生分級：<6% 危急、<10% 高、<15% 中",
    summary: compact(
      `目前用電 ${row.curr_load || "未提供"} 萬瓩（使用率 ${row.curr_util_rate || "未提供"}%）；` +
      `預估尖峰負載 ${row.fore_peak_dema_load || "未提供"} 萬瓩、備轉容量 ${row.fore_peak_resv_capacity || "未提供"} 萬瓩。`,
      500,
    ),
    locationPrecision: "country",
    source: {
      ...OFFICIAL_SOURCE_META.taipower,
      url: TAIPOWER_URL,
      fetchedAt,
      recordRef: row.publish_time || fetchedAt,
      retentionPolicy: "stateful",
    },
  };
}

export async function fetchTaipowerSupply({ fetchImpl = fetch } = {}) {
  const fetchedAt = new Date().toISOString();
  const payload = await fetchChecked(TAIPOWER_URL, {
    fetchImpl,
    json: true,
    headers: OFFICIAL_USER_AGENT,
    attempts: 2,
  });
  if (!Array.isArray(payload?.records) || !payload.records.length) throw new Error("台電供需回應缺少 records");
  return [mapTaipowerSupplyEvent(payload, { fetchedAt })];
}

const RESERVOIR_COUNTY = {
  石門水庫: "桃園市", 新山水庫: "基隆市", 翡翠水庫: "新北市",
  寶山水庫: "新竹縣", 寶山第二水庫: "新竹縣", 永和山水庫: "苗栗縣",
  明德水庫: "苗栗縣", 鯉魚潭水庫: "苗栗縣", 德基水庫: "臺中市",
  日月潭水庫: "南投縣", 湖山水庫: "雲林縣", 仁義潭水庫: "嘉義縣",
  蘭潭水庫: "嘉義市", 烏山頭水庫: "臺南市", 曾文水庫: "嘉義縣",
  南化水庫: "臺南市", 阿公店水庫: "高雄市", 牡丹水庫: "屏東縣",
};

export function parseWraReservoirRows(html) {
  const rows = [];
  for (const rowHtml of String(html || "").match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || []) {
    const cells = [...rowHtml.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((match) => decodeHtml(match[1]));
    if (cells.length < 5) continue;
    const name = cells[0].match(/^(.+?水庫)/)?.[1] || "";
    const storageRate = Number(String(cells[3]).replace("%", ""));
    if (!name || !Number.isFinite(storageRate)) continue;
    rows.push({
      name,
      label: cells[0],
      effectiveStorage: cells[1],
      waterLevel: cells[2],
      storageRate,
      recordedAt: cells[4],
      plannedEmpty: /空庫防淤|不蓄水/.test(cells[0]),
    });
  }
  return rows;
}

function reservoirRisk(storageRate) {
  if (storageRate <= 20) return "high";
  if (storageRate <= 40) return "medium";
  return "low";
}

export function mapWraReservoirEvents(rows, { fetchedAt = new Date().toISOString(), limit = 20 } = {}) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => !row?.plannedEmpty && Number.isFinite(row?.storageRate) && row.storageRate <= 70)
    .sort((a, b) => a.storageRate - b.storageRate)
    .slice(0, limit)
    .map((row) => {
      const region = RESERVOIR_COUNTY[row.name] || "全國";
      const coord = countyCoordFromAddr(region);
      const timestamp = officialDateIso(row.recordedAt, fetchedAt);
      return {
        id: stableId("wra-reservoir", `${row.name}|${timestamp}`),
        title: `${row.name}蓄水率 ${row.storageRate}%`,
        region: coord?.region || region,
        timestamp,
        category: "水情",
        scope: "domestic",
        riskLevel: reservoirRisk(row.storageRate),
        riskBasis: "依水利署水庫蓄水率衍生分級；計畫性空庫防淤水庫排除",
        summary: `有效蓄水量 ${row.effectiveStorage || "未提供"} 萬立方公尺；水位 ${row.waterLevel || "未提供"} 公尺；蓄水率 ${row.storageRate}%。`,
        ...(coord
          ? { lat: coord.lat, lng: coord.lng, locationPrecision: "county-center" }
          : { locationPrecision: "country" }),
        source: {
          ...OFFICIAL_SOURCE_META.wra,
          url: WRA_URL,
          fetchedAt,
          recordRef: `${row.name}|${row.recordedAt || timestamp}`,
          retentionPolicy: "stateful",
        },
      };
    });
}

export async function fetchWraReservoirLevels({ fetchImpl = fetch, limit = 20 } = {}) {
  const fetchedAt = new Date().toISOString();
  const html = await fetchChecked(WRA_URL, { fetchImpl, timeoutMs: 60000, headers: OFFICIAL_USER_AGENT, attempts: 2 });
  const rows = parseWraReservoirRows(html);
  if (!rows.length) throw new Error("水利署水庫水情解析為 0 筆");
  return mapWraReservoirEvents(rows, { fetchedAt, limit });
}
