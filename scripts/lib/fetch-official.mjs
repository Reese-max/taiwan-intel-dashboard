// 第一波官方資料源：MND 臺海動態、CDC 類流感、MOENV AQI、TFDA 邊境查驗。
// 僅做官方結構化資料的保守映射，不經 LLM；共用網路與來源 metadata，避免四套重複框架。
import { createHash } from "node:crypto";
import { countyCoordFromAddr } from "./coords.mjs";

const MND_BASE = "https://air.mnd.gov.tw";
const MND_LIST_URL = `${MND_BASE}/TW/News/News_List.aspx?CID=213`;
const CDC_URL = "https://od.cdc.gov.tw/eic/RODS_Influenza_like_illness.json";
const TFDA_URL = "https://data.fda.gov.tw/data/opendata/export/52/json";
const AQI_URL = "https://data.moenv.gov.tw/api/v2/aqx_p_432";

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
  aqi: {
    name: "環境部 空氣品質監測網 AQI",
    type: "gov-open-data",
    datasetId: "moenv-aqi-hourly",
    scope: "domestic",
    category: "環境",
    query: "環境部資料開放平臺 aqx_p_432 即時 AQI",
    license: "政府資料開放授權條款-第1版 — 環境部",
    cadence: "hourly",
    maxAgeHours: 6,
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
};

function stableId(prefix, value) {
  return `${prefix}-${createHash("sha1").update(String(value)).digest("hex").slice(0, 16)}`;
}

function compact(value, max = 500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
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
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
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

export async function fetchCdcInfluenza({ fetchImpl = fetch, retryDelayMs = 1000 } = {}) {
  const fetchedAt = new Date().toISOString();
  const rows = await fetchChecked(CDC_URL, {
    fetchImpl,
    timeoutMs: 90000,
    json: true,
    attempts: 3,
    retryDelayMs,
  });
  return [mapCdcInfluenzaEvent(rows, { fetchedAt })];
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

function aqiRisk(status, aqi) {
  const text = String(status || "");
  if (/非常不健康|危害/.test(text) || aqi > 200) return "critical";
  if (/所有族群不健康/.test(text) || aqi > 150) return "high";
  if (/敏感族群不健康/.test(text) || aqi > 100) return "medium";
  return "low";
}

export function mapAqiEvents(payload, { fetchedAt = new Date().toISOString() } = {}) {
  const highestByCounty = new Map();
  for (const row of Array.isArray(payload?.records) ? payload.records : []) {
    const county = compact(row?.county, 20);
    const aqi = Number(row?.aqi);
    if (!county || !Number.isFinite(aqi) || aqi <= 100) continue;
    if (!highestByCounty.has(county) || aqi > highestByCounty.get(county).aqi) highestByCounty.set(county, { row, aqi });
  }
  return [...highestByCounty.entries()].map(([county, { row, aqi }]) => {
    const latText = String(row.latitude ?? "").trim();
    const lngText = String(row.longitude ?? "").trim();
    const officialLat = Number(latText);
    const officialLng = Number(lngText);
    const officialCoord = latText && lngText
      && Number.isFinite(officialLat) && officialLat >= -90 && officialLat <= 90
      && Number.isFinite(officialLng) && officialLng >= -180 && officialLng <= 180
      ? { lat: officialLat, lng: officialLng, region: county }
      : null;
    const coord = officialCoord || countyCoordFromAddr(county);
    const timestamp = taiwanDateIso(row.datacreationdate || row.publishtime, fetchedAt);
    return {
      id: stableId("aqi", `${county}|${row.sitename}|${timestamp}`),
      title: `${county}${row.sitename ? ` ${row.sitename}測站` : ""} AQI ${aqi}（${row.status || "狀態未提供"}）`,
      region: coord?.region || county,
      timestamp,
      category: "環境",
      scope: "domestic",
      riskLevel: aqiRisk(row.status, aqi),
      riskBasis: "依環境部 AQI 狀態文字映射",
      summary: `AQI ${aqi}，空氣品質狀態：${row.status || "未提供"}。`,
      ...(coord
        ? { lat: coord.lat, lng: coord.lng, locationPrecision: officialCoord ? "exact" : "county-center" }
        : { locationPrecision: "county" }),
      source: {
        ...OFFICIAL_SOURCE_META.aqi,
        name: `${OFFICIAL_SOURCE_META.aqi.name}${row.sitename ? `（${row.sitename}）` : ""}`,
        url: "https://airtw.moenv.gov.tw/",
        fetchedAt,
        recordRef: `${county}|${row.sitename || ""}|${timestamp}`,
        retentionPolicy: "stateful",
      },
    };
  });
}

export async function fetchAqi({ apiKey, fetchImpl = fetch } = {}) {
  if (!String(apiKey || "").trim()) throw new Error("MOENV_API_KEY 未設定（環境部 API 要求 api_key）");
  const fetchedAt = new Date().toISOString();
  const url = `${AQI_URL}?format=json&limit=1000&api_key=${encodeURIComponent(apiKey)}`;
  const payload = await fetchChecked(url, { fetchImpl, json: true });
  if (!Array.isArray(payload?.records)) throw new Error("MOENV AQI 回應缺少 records");
  return mapAqiEvents(payload, { fetchedAt });
}
