// 官方資料源：MND、CDC、TFDA、海巡署、TWCERT/CC、台電與水利署。
// 僅做官方資料的保守規則映射，不經 LLM；共用網路與來源 metadata，避免重複框架。
import { createHash } from "node:crypto";
import { countyCoordFromAddr } from "./coords.mjs";
import { detectCounty } from "./news-bulk.mjs";
import { queryTwinkleRows, rowVal } from "./twinkle-query.mjs";

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
const WRA_RIVER_LEVEL_URL = "https://opendata.wra.gov.tw/api/v2/73c4c3de-4045-4765-abeb-89f9f9cd5ff0?format=JSON&sort=_importdate+asc";
const WRA_RIVER_STATION_URL = "https://opendata.wra.gov.tw/api/v2/c4acc691-7416-40ca-9464-292c0c00da92?format=JSON&sort=_importdate+asc";
const WRA_RIVER_DATASET_ID = "wra-river-levels";
const MOENV_AIR_DATASET_ID = "28178";
const MOENV_AIR_STATION_URL = "https://geoser.moenv.gov.tw/stdserver/rest/services/31_Air/%E7%A9%BA%E6%B0%A3%E5%93%81%E8%B3%AA%E7%9B%A3%E6%B8%AC%E7%AB%99%E4%BD%8D%E7%BD%AE%E5%9C%96/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&f=json";
const ECONOMIC_DATASET_ID = "13228";
const AGRICULTURE_DATASET_ID = "70930";
const AGRICULTURE_SOURCE_URL = "https://data.moa.gov.tw/Service/OpenData/TransService.aspx?UnitId=WVOiWSdDjWxx&IsTransData=1";
const HEALTHCARE_DATASET_ID = "39331";
const HEALTHCARE_SOURCE_URL = "https://info.nhi.gov.tw/api/iode0000s01/Dataset?rId=A21030000I-D2000H-001";
const FIRE_DATASET_ID = "134922";
const FIRE_SOURCE_URL = "https://data.taipei/api/dataset/9adc3f7b-ef37-4e4e-b538-deb1e567d5db/resource/74ca9115-8c85-41d8-8b2e-73d4a422382c/download";
const LEGISLATURE_DATASET_ID = "ly-bills";
const LEGISLATURE_SOURCE_URL = "https://ppg.ly.gov.tw/ppg/bills";
const TOURISM_DATASET_ID = "tad-index-inbound-lastmonth";
const TOURISM_SOURCE_URL = "https://stat.taiwan.net.tw/";
const SOCIAL_POPULATION_DATASET_ID = "84049";
const SOCIAL_POPULATION_SOURCE_URL = "https://data.gov.tw/dataset/84049";
const EDUCATION_DATASET_ID = "124173";
const EDUCATION_SOURCE_URL = "https://data.gov.tw/dataset/124173";
const FINANCE_DATASET_ID = "11598";
const FINANCE_SOURCE_URL = "https://www.taifex.com.tw/data_gov/taifex_open_data.asp?data_name=MarketDataOfMajorInstitutionalTradersDetailsOfOptionsContractsBytheDate";
const LABOR_DATASET_ID = "123349";
const LABOR_SOURCE_URL = "https://data.ntpc.gov.tw/api/datasets/20eb76dd-d307-44e9-9b24-c8903ed67a27/csv/file";
const AIR_STATION_COUNTY_FALLBACK = { 林森: "臺北市", 臺灣大道: "臺中市", 員林: "彰化縣" };

export const PARKING_SOURCE_PROFILES = {
  hsinchu: {
    name: "新竹市即時停車場剩餘車位",
    datasetId: "129136",
    region: "新竹市",
    query: "twinkle-hub query_rows dataset 129136（FREEQUANTITY/TOTALQUANTITY）",
    license: "政府資料開放授權條款-第1版 — 新竹市政府",
    cadence: "daily",
    maxAgeHours: 96,
    url: "https://data.gov.tw/dataset/129136",
    free: "FREEQUANTITY",
    total: "TOTALQUANTITY",
    updated: "UPDATETIME",
    nameField: "PARKINGNAME",
  },
  taoyuan: {
    name: "桃園市路外停車資訊",
    datasetId: "25940",
    region: "桃園市",
    query: "twinkle-hub query_rows dataset 25940（surplusSpace/totalSpace）",
    license: "政府資料開放授權條款-第1版 — 桃園市政府",
    cadence: "daily",
    maxAgeHours: 72,
    url: "https://data.gov.tw/dataset/25940",
    free: "surplusSpace",
    total: "totalSpace",
    updated: "",
    nameField: "parkName",
  },
};

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
    maxAgeHours: 6,
  },
  wra: {
    name: "經濟部水利署 水庫水情一覽表",
    type: "gov-open-data",
    datasetId: "wra-reservoir-levels",
    scope: "domestic",
    category: "水情",
    query: "水利署水庫水情一覽表：全部非計畫性空庫水庫",
    license: "政府網站資料開放宣告 — 經濟部水利署",
    cadence: "hourly",
    maxAgeHours: 6,
  },
  wraRiver: {
    name: "經濟部水利署 即時河川水位",
    type: "gov-open-data",
    datasetId: WRA_RIVER_DATASET_ID,
    scope: "domestic",
    category: "水情",
    query: "水利署即時水位資料（25768）＋河川水位測站站況（22227）",
    license: "政府資料開放授權條款-第1版 — 經濟部水利署",
    cadence: "10min",
    maxAgeHours: 2,
  },
  moenvAir: {
    name: "環境部 空氣品質監測小時值",
    type: "gov-open-data",
    datasetId: MOENV_AIR_DATASET_ID,
    scope: "domestic",
    category: "環境",
    query: "環境部開放資料 28178 空氣品質監測小時值（PM2.5／O3／NO2／SO2／PM10／CO）",
    license: "政府資料開放授權條款-第1版 — 環境部",
    cadence: "daily",
    maxAgeHours: 96,
  },
  parkingHsinchu: {
    ...PARKING_SOURCE_PROFILES.hsinchu,
    type: "gov-open-data",
    scope: "domestic",
    category: "交通",
  },
  parkingTaoyuan: {
    ...PARKING_SOURCE_PROFILES.taoyuan,
    type: "gov-open-data",
    scope: "domestic",
    category: "交通",
  },
  economy: {
    name: "主計總處 重要經濟指標月資料",
    type: "gov-open-data",
    datasetId: ECONOMIC_DATASET_ID,
    scope: "domestic",
    category: "經濟",
    query: "主計總處開放資料 13228 重要經濟指標月資料（最新月份）",
    license: "政府資料開放授權條款-第1版 — 行政院主計總處",
    cadence: "monthly",
    maxAgeHours: 2160,
  },
  agriPrices: {
    name: "農業部 農產品產地價格",
    type: "gov-open-data",
    datasetId: AGRICULTURE_DATASET_ID,
    scope: "domestic",
    category: "農業",
    query: "農業部開放資料 70930 最新產地價格（依品項與日期彙整）",
    license: "政府資料開放授權條款-第1版 — 農業部",
    cadence: "daily",
    maxAgeHours: 96,
  },
  healthFacilities: {
    name: "健保署 居家醫療整合計畫參與院所",
    type: "gov-open-data",
    datasetId: HEALTHCARE_DATASET_ID,
    scope: "domestic",
    category: "衛生",
    query: "健保署開放資料 39331 居家醫療整合計畫參與院所總數",
    license: "政府資料開放授權條款-第1版 — 衛生福利部中央健康保險署",
    cadence: "daily",
    maxAgeHours: 72,
  },
  fireStats: {
    name: "臺北市消防局 119 受理案件統計",
    type: "gov-open-data",
    datasetId: FIRE_DATASET_ID,
    scope: "domestic",
    category: "消防",
    query: "臺北市資料集 134922 最新統計期間之消防、救護與救援受理案件",
    license: "政府資料開放授權條款-第1版 — 臺北市政府消防局",
    cadence: "monthly",
    maxAgeHours: 2160,
  },
  legislature: {
    name: "立法院 議案進度",
    type: "gov-open-data",
    datasetId: LEGISLATURE_DATASET_ID,
    scope: "domestic",
    category: "國會",
    query: "立法院議案開放資料最新進度參考快照",
    license: "政府資料開放授權條款 — 立法院議政資料",
    cadence: "daily",
    maxAgeHours: 96,
  },
  tourismStat: {
    name: "交通部觀光署 來臺旅客上月概況",
    type: "gov-open-data",
    datasetId: TOURISM_DATASET_ID,
    scope: "domestic",
    category: "觀光",
    query: "交通部觀光署觀光統計五大客源群上月入境概況",
    license: "觀光署公開資料鏡像（非 data.gov.tw OGDL；研究用途）",
    cadence: "monthly",
    maxAgeHours: 2160,
  },
  socialPopulation: {
    name: "臺中市民政局 各區人口結構",
    type: "gov-open-data",
    datasetId: SOCIAL_POPULATION_DATASET_ID,
    scope: "domestic",
    category: "社福",
    query: "臺中市各區人口結構（年齡與性別）參考快照",
    license: "政府資料開放授權條款-第1版 — 臺中市政府民政局",
    cadence: "monthly",
    maxAgeHours: 2160,
  },
  education: {
    name: "新北市政府 境內高級中等學校教育概況",
    type: "gov-open-data",
    datasetId: EDUCATION_DATASET_ID,
    scope: "domestic",
    category: "教育",
    query: "新北市高級中等學校教育概況年度統計參考快照",
    license: "政府資料開放授權條款-第1版 — 新北市政府主計處",
    cadence: "yearly",
    maxAgeHours: 8760,
  },
  financeDerivatives: {
    name: "臺灣期貨交易所 三大法人選擇權",
    type: "gov-open-data",
    datasetId: FINANCE_DATASET_ID,
    scope: "domestic",
    category: "金融",
    query: "臺灣期貨交易所每日三大法人選擇權契約統計參考快照",
    license: "政府資料開放授權條款-第1版 — 臺灣期貨交易所",
    cadence: "daily",
    maxAgeHours: 2160,
  },
  laborStats: {
    name: "新北市政府 失業率婚姻狀況統計",
    type: "gov-open-data",
    datasetId: LABOR_DATASET_ID,
    scope: "domestic",
    category: "勞動",
    query: "新北市失業率按婚姻狀況與性別年度統計參考快照",
    license: "政府資料開放授權條款-第1版 — 新北市政府主計處",
    cadence: "yearly",
    maxAgeHours: 8760,
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
    .filter((row) => !row?.plannedEmpty && Number.isFinite(row?.storageRate))
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

function riverLevelRisk(waterLevel, station) {
  const threshold = (value) => String(value ?? "").trim() ? Number(value) : NaN;
  if (Number.isFinite(threshold(station?.alertlevel1)) && waterLevel >= threshold(station.alertlevel1)) return "high";
  if (Number.isFinite(threshold(station?.alertlevel2)) && waterLevel >= threshold(station.alertlevel2)) return "medium";
  if (Number.isFinite(threshold(station?.alertlevel3)) && waterLevel >= threshold(station.alertlevel3)) return "medium";
  return "low";
}

export function mapWraRiverLevelEvents(observations, stations, { fetchedAt = new Date().toISOString() } = {}) {
  const stationById = new Map(
    (Array.isArray(stations) ? stations : [])
      .filter((station) => station?.basinidentifier)
      .map((station) => [String(station.basinidentifier), station]),
  );
  const groups = new Map();
  const riskRank = { low: 0, medium: 1, high: 2 };

  for (const observation of Array.isArray(observations) ? observations : []) {
    if (String(observation?.checkresult).toLowerCase() !== "true") continue;
    const waterLevel = Number(observation?.waterlevel);
    const station = stationById.get(String(observation?.stationid || ""));
    const coord = countyCoordFromAddr(station?.locationaddress);
    if (!station || !coord || !Number.isFinite(waterLevel)) continue;
    const timestamp = taiwanDateIso(observation.datetime, fetchedAt);
    const riskLevel = riverLevelRisk(waterLevel, station);
    const group = groups.get(coord.region) || {
      region: coord.region,
      lat: coord.lat,
      lng: coord.lng,
      count: 0,
      alertCount: 0,
      alertStations: [],
      riskLevel: "low",
      timestamp,
    };
    group.count++;
    if (riskLevel !== "low") {
      group.alertCount++;
      if (group.alertStations.length < 3) group.alertStations.push(station.observatoryname || observation.stationid);
    }
    if (riskRank[riskLevel] > riskRank[group.riskLevel]) group.riskLevel = riskLevel;
    if (timestamp > group.timestamp) group.timestamp = timestamp;
    groups.set(coord.region, group);
  }

  return [...groups.values()]
    .sort((a, b) => a.region.localeCompare(b.region, "zh-Hant"))
    .map((group) => ({
      id: stableId("wra-river", `${group.region}|${group.timestamp}`),
      title: `${group.region}即時河川水位（${group.count}站）`,
      region: group.region,
      timestamp: group.timestamp,
      category: "水情",
      scope: "domestic",
      riskLevel: group.riskLevel,
      riskBasis: "依水利署測站警戒水位門檻彙整；一級警戒為高、二至三級為中，未達為低",
      summary: compact(
        `有效觀測 ${group.count} 站；${group.alertCount} 站達警戒值${group.alertStations.length ? `（${group.alertStations.join("、")}）` : ""}；最新資料 ${group.timestamp}。`,
        500,
      ),
      lat: group.lat,
      lng: group.lng,
      locationPrecision: "county-center",
      source: {
        ...OFFICIAL_SOURCE_META.wraRiver,
        url: WRA_RIVER_LEVEL_URL,
        fetchedAt,
        recordRef: `${group.region}|${group.timestamp}`,
        retentionPolicy: "stateful",
      },
    }));
}

export async function fetchWraReservoirLevels({ fetchImpl = fetch, limit = 20 } = {}) {
  const fetchedAt = new Date().toISOString();
  const html = await fetchChecked(WRA_URL, { fetchImpl, timeoutMs: 60000, headers: OFFICIAL_USER_AGENT, attempts: 2 });
  const rows = parseWraReservoirRows(html);
  if (!rows.length) throw new Error("水利署水庫水情解析為 0 筆");
  return mapWraReservoirEvents(rows, { fetchedAt, limit });
}

export async function fetchWraRiverLevels({ fetchImpl = fetch } = {}) {
  const fetchedAt = new Date().toISOString();
  const [observations, stations] = await Promise.all([
    fetchChecked(WRA_RIVER_LEVEL_URL, { fetchImpl, timeoutMs: 60000, json: true, attempts: 2 }),
    fetchChecked(WRA_RIVER_STATION_URL, { fetchImpl, timeoutMs: 60000, json: true, attempts: 2 }),
  ]);
  if (!Array.isArray(observations) || !Array.isArray(stations)) throw new Error("水利署即時水位回應不是有效資料列陣列");
  const events = mapWraRiverLevelEvents(observations, stations, { fetchedAt });
  if (!events.length) throw new Error("水利署即時水位可定位縣市解析為 0 筆");
  return events;
}

function numericValue(value) {
  const text = String(value ?? "").replace(/[rp]/gi, "").replace(/,/g, "").trim();
  if (!text || ["x", "…", "-", "—"].includes(text)) return NaN;
  const number = Number(text);
  return Number.isFinite(number) ? number : NaN;
}

function rowsAsObjects(payload) {
  const columns = Array.isArray(payload?.columns) ? payload.columns : [];
  return (Array.isArray(payload?.rows) ? payload.rows : []).map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row?.[index]])),
  );
}

function taiwanTimestamp(value, fallback) {
  const parsed = taiwanDateIso(value, fallback);
  return Number.isFinite(Date.parse(parsed)) ? parsed : fallback;
}

function airRisk(metrics) {
  const pm25 = metrics["PM2.5"];
  const ozone = metrics.O3;
  if ((Number.isFinite(pm25) && pm25 >= 54) || (Number.isFinite(ozone) && ozone >= 125)) return "high";
  if ((Number.isFinite(pm25) && pm25 >= 35) || (Number.isFinite(ozone) && ozone >= 100)) return "medium";
  return "low";
}

function stationAttributes(station) {
  return station?.attributes || station || {};
}

export function mapMoenvAirQualityEvents(payload, stations = [], { fetchedAt = new Date().toISOString() } = {}) {
  const columns = Array.isArray(payload?.columns) ? payload.columns : [];
  const grouped = new Map();
  for (const row of Array.isArray(payload?.rows) ? payload.rows : []) {
    const siteid = String(rowVal(row, columns, "siteid") ?? "").trim();
    const item = String(rowVal(row, columns, "itemengname") ?? "").trim();
    if (!siteid || !["PM2.5", "PM10", "O3", "NO2", "SO2", "CO"].includes(item)) continue;
    const date = String(rowVal(row, columns, "monitordate") ?? "").trim();
    let latest = null;
    for (let hour = 23; hour >= 0; hour--) {
      const value = numericValue(rowVal(row, columns, `monitorvalue${String(hour).padStart(2, "0")}`));
      if (!Number.isFinite(value)) continue;
      latest = {
        value,
        timestamp: taiwanTimestamp(`${date} ${String(hour).padStart(2, "0")}:00:00`, fetchedAt),
      };
      break;
    }
    if (!latest) continue;
    const key = siteid;
    const current = grouped.get(key) || {
      siteid,
      sitename: String(rowVal(row, columns, "sitename") ?? siteid).trim(),
      metrics: {},
      timestamps: [],
      latestDataDate: date,
    };
    current.metrics[item] = latest.value;
    current.timestamps.push(latest.timestamp);
    if (date > current.latestDataDate) current.latestDataDate = date;
    grouped.set(key, current);
  }

  const stationById = new Map(
    (Array.isArray(stations) ? stations : [])
      .map(stationAttributes)
      .filter((station) => station.Stcode != null)
      .map((station) => [String(station.Stcode), station]),
  );

  return [...grouped.values()].map((group) => {
    const station = stationById.get(group.siteid) || {};
    const county = String(station.County || AIR_STATION_COUNTY_FALLBACK[group.sitename] || "").trim();
    const coord = Number.isFinite(Number(station.TWD97_Lat)) && Number.isFinite(Number(station.TWD97_Lon))
      ? { region: county || "全國", lat: Number(station.TWD97_Lat), lng: Number(station.TWD97_Lon) }
      : countyCoordFromAddr(county);
    const timestamp = [...group.timestamps].sort().at(-1) || fetchedAt;
    const metricText = Object.entries(group.metrics)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => `${name} ${value}`)
      .join("、");
    return {
      id: stableId("moenv-air", `${group.siteid}|${timestamp}`),
      title: `環境部空品監測：${group.sitename}`,
      region: coord?.region || "全國",
      timestamp,
      category: "環境",
      scope: "domestic",
      riskLevel: airRisk(group.metrics),
      riskBasis: "依 PM2.5／O3 保守門檻分級；非環境部 AQI 官方燈號",
      summary: `最新小時觀測：${metricText || "無有效污染物數值"}；測站資料日 ${group.latestDataDate || "未提供"}。`,
      ...(coord?.lat != null && coord?.lng != null
        ? { lat: coord.lat, lng: coord.lng, locationPrecision: "station" }
        : { locationPrecision: "country" }),
      source: {
        ...OFFICIAL_SOURCE_META.moenvAir,
        url: MOENV_AIR_STATION_URL,
        fetchedAt,
        latestDataDate: group.latestDataDate || undefined,
        recordRef: `${group.siteid}|${group.latestDataDate || timestamp}`,
        retentionPolicy: "reference",
      },
    };
  });
}

export function mapParkingSummaryEvent(rows, profile, { fetchedAt = new Date().toISOString() } = {}) {
  let free = 0;
  let total = 0;
  let latestUpdate = "";
  let validRows = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const rowTotal = numericValue(row?.[profile.total]);
    const rowFree = numericValue(row?.[profile.free]);
    if (!Number.isFinite(rowTotal) || rowTotal <= 0 || !Number.isFinite(rowFree)) continue;
    total += rowTotal;
    free += Math.max(0, rowFree);
    validRows++;
    const updated = String(row?.[profile.updated] || "").trim();
    if (updated > latestUpdate) latestUpdate = updated;
  }
  if (!validRows || total <= 0) return [];
  const ratio = free / total;
  const coord = countyCoordFromAddr(profile.region);
  const timestamp = latestUpdate ? taiwanTimestamp(latestUpdate, fetchedAt) : fetchedAt;
  return [{
    id: stableId("parking", `${profile.datasetId}|${latestUpdate || fetchedAt}`),
    title: `${profile.region}停車供給：可用 ${free}／${total}`,
    region: coord?.region || profile.region,
    timestamp,
    category: "交通",
    scope: "domestic",
    riskLevel: ratio <= 0.05 ? "high" : ratio <= 0.1 ? "medium" : "low",
    riskBasis: "依公開停車場回報可用比例分級；不代表全市道路壅塞程度",
    summary: `${profile.region}納入 ${validRows} 座停車場，可用車位 ${free}／${total}（${Math.round(ratio * 1000) / 10}%）；${latestUpdate ? `最新回報 ${latestUpdate}` : "資料未提供回報時間"}。`,
    ...(coord ? { lat: coord.lat, lng: coord.lng, locationPrecision: "county-center" } : { locationPrecision: "country" }),
    source: {
      type: "gov-open-data",
      scope: "domestic",
      category: "交通",
      ...profile,
      fetchedAt,
      ...(latestUpdate ? { latestDataDate: latestUpdate } : {}),
      recordRef: `${profile.region}|${latestUpdate || fetchedAt}`,
      retentionPolicy: "reference",
    },
  }];
}

function monthEndIso(value, fallback) {
  const match = String(value || "").match(/^(\d{4})(\d{2})$/);
  if (!match) return fallback;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return fallback;
  return new Date(Date.UTC(year, month, 0, 15, 59, 59)).toISOString();
}

export function mapEconomicIndicatorEvent(payload, { fetchedAt = new Date().toISOString() } = {}) {
  const rows = rowsAsObjects(payload)
    .filter((row) => /^\d{6}$/.test(String(row["日期（月別）"] || "")))
    .sort((a, b) => String(b["日期（月別）"]).localeCompare(String(a["日期（月別）"])));
  const row = rows[0];
  if (!row) throw new Error("主計總處經濟指標沒有有效資料月份");
  const period = String(row["日期（月別）"] || "");
  const value = (name) => {
    const number = numericValue(row[name]);
    return Number.isFinite(number) ? number : null;
  };
  const indicators = [
    ["經濟成長率", value("經濟成長率"), "%"],
    ["失業率", value("失業率（百分比）"), "%"],
    ["消費者物價年增率", value("消費者物價-年增率"), "%"],
    ["工業及服務業平均月薪資", value("工業及服務業平均月薪資（元）"), " 元"],
  ].filter(([, current]) => current != null);
  const summary = indicators.length
    ? indicators.map(([name, current, unit]) => `${name} ${current}${unit}`).join("；")
    : "最新月份沒有可用數值";
  return {
    id: stableId("economy", period),
    title: `主計總處重要經濟指標：${period.slice(0, 4)} 年 ${Number(period.slice(4))} 月`,
    region: "全國",
    timestamp: monthEndIso(period, fetchedAt),
    category: "經濟",
    scope: "domestic",
    riskLevel: "low",
    riskBasis: "官方統計快照；不由單月指標推導經濟風險結論",
    summary: `${summary}。資料月份 ${period.slice(0, 4)}-${period.slice(4)}。`,
    locationPrecision: "country",
    source: {
      ...OFFICIAL_SOURCE_META.economy,
      fetchedAt,
      latestDataDate: `${period.slice(0, 4)}-${period.slice(4)}`,
      recordRef: period,
      retentionPolicy: "reference",
    },
  };
}

function agriculturePeriodDay(value) {
  const text = String(value ?? "").trim();
  const numeric = Number(text);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 31) return numeric;
  if (text.includes("上旬")) return 10;
  if (text.includes("中旬")) return 20;
  if (text.includes("下旬")) return 30;
  return 15;
}

function agricultureDate(row) {
  const year = Number(row?.YEAR);
  const month = Number(row?.MONTH);
  if (!Number.isInteger(year) || year < 1900 || !Number.isInteger(month) || month < 1 || month > 12) return null;
  const day = agriculturePeriodDay(row?.PERIOD);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const safeDay = Math.min(day, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

export function mapAgriculturePriceEvent(payload, { fetchedAt = new Date().toISOString() } = {}) {
  const rows = rowsAsObjects(payload)
    .map((row) => ({ row, date: agricultureDate(row), price: numericValue(row?.AVGPRICE) }))
    .filter((item) => item.date && Number.isFinite(item.price) && String(item.row?.PRODUCTNAME || "").trim());
  if (!rows.length) throw new Error("農產品產地價格沒有有效日期與價格資料");
  const latestDataDate = rows.map((item) => item.date).sort().at(-1);
  const latest = rows
    .filter((item) => item.date === latestDataDate)
    .sort((a, b) => String(a.row.PRODUCTNAME).localeCompare(String(b.row.PRODUCTNAME), "zh-Hant"));
  const seen = new Set();
  const samples = latest.filter(({ row }) => {
    const product = String(row.PRODUCTNAME || "").trim();
    if (seen.has(product)) return false;
    seen.add(product);
    return true;
  }).slice(0, 8);
  const sampleText = samples.map(({ row, price }) => `${String(row.PRODUCTNAME).trim()} ${price} 元`).join("；");
  return {
    id: stableId("agri-price", latestDataDate),
    title: `農業部農產品產地價格：${latestDataDate}`,
    region: "全國",
    timestamp: taiwanTimestamp(latestDataDate, fetchedAt),
    category: "農業",
    scope: "domestic",
    riskLevel: "low",
    riskBasis: "官方產地價格參考快照；不由單一品項價格推導市場或投資結論",
    summary: `最新資料日 ${latestDataDate}，可用 ${latest.length} 筆品項價格；${sampleText || "沒有可展示的品項"}。`,
    locationPrecision: "country",
    source: {
      ...OFFICIAL_SOURCE_META.agriPrices,
      url: AGRICULTURE_SOURCE_URL,
      fetchedAt,
      latestDataDate,
      recordRef: latestDataDate,
      retentionPolicy: "reference",
    },
  };
}

export function mapHealthcareFacilityEvent(payload, { fetchedAt = new Date().toISOString() } = {}) {
  const rows = rowsAsObjects(payload);
  const row = rows[0] || {};
  const count = numericValue(row.n ?? row.count ?? row["COUNT(*)"]);
  if (!Number.isFinite(count) || count < 0) throw new Error("健保居家醫療院所總數沒有有效資料");
  return {
    id: stableId("health-facilities", `${HEALTHCARE_DATASET_ID}|${count}`),
    title: "健保署居家醫療整合計畫參與院所",
    region: "全國",
    timestamp: fetchedAt,
    category: "衛生",
    scope: "domestic",
    riskLevel: "low",
    riskBasis: "官方醫療服務量能參考快照；不代表即時可掛號量或醫療品質",
    summary: `健保署資料集目前列有 ${count} 家居家醫療整合計畫參與院所；屬服務量能參考資料。`,
    locationPrecision: "country",
    source: {
      ...OFFICIAL_SOURCE_META.healthFacilities,
      url: HEALTHCARE_SOURCE_URL,
      fetchedAt,
      recordRef: `facility-count|${count}`,
      retentionPolicy: "reference",
    },
  };
}

function firePeriodEnd(value) {
  const match = String(value || "").match(/^(\d{3})年(\d{1,2})(?:-(\d{1,2}))?月/);
  if (!match) return null;
  const [, rocYear, startMonth, endMonth = startMonth] = match;
  const month = Number(endMonth);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  const year = Number(rocYear) + 1911;
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function mapFireStatisticsEvent(payload, { fetchedAt = new Date().toISOString() } = {}) {
  const rows = rowsAsObjects(payload)
    .map((row) => ({ row, period: String(row["統計期間"] || "").trim(), endDate: firePeriodEnd(row["統計期間"]) }))
    .filter((item) => item.period && item.endDate);
  if (!rows.length) throw new Error("臺北市消防統計沒有有效統計期間");
  const latestEndDate = rows.map((item) => item.endDate).sort().at(-1);
  const latest = rows.filter((item) => item.endDate === latestEndDate);
  const sum = (name) => latest.reduce((total, { row }) => {
    const value = numericValue(row[name]);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
  const fire = sum("受理火災統計數值");
  const rescue = sum("受理救護統計數值");
  const total = sum("總計");
  const period = latest[0]?.period || latestEndDate;
  return {
    id: stableId("fire-stats", `${FIRE_DATASET_ID}|${period}`),
    title: `臺北市消防局受理案件統計：${period}`,
    region: "臺北市",
    timestamp: taiwanTimestamp(latestEndDate, fetchedAt),
    category: "消防",
    scope: "domestic",
    riskLevel: "low",
    riskBasis: "官方期間統計參考；不是即時派遣量或全台消防風險推估",
    summary: `臺北市 ${period} 共 ${total} 件受理案件，其中火災 ${fire} 件、救護 ${rescue} 件；涵蓋 ${latest.length} 個行政區。`,
    locationPrecision: "county-center",
    ...countyCoordFromAddr("臺北市"),
    source: {
      ...OFFICIAL_SOURCE_META.fireStats,
      url: FIRE_SOURCE_URL,
      fetchedAt,
      latestDataDate: period,
      recordRef: period,
      retentionPolicy: "reference",
    },
  };
}

function latestIsoDate(rows, fields) {
  const values = rows
    .flatMap((row) => fields.map((field) => String(row?.[field] || "").trim()))
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort();
  return values.at(-1) || "";
}

export function mapLegislatureBillsEvent(payload, { fetchedAt = new Date().toISOString() } = {}) {
  const rows = rowsAsObjects(payload).filter((row) => String(row?.議案名稱 || row?.案由 || row?.議案編號 || "").trim());
  if (!rows.length) throw new Error("立法院議案沒有有效資料列");
  const latestProgress = latestIsoDate(rows, ["最新進度日期", "提案日期", "資料抓取時間"]);
  const statusCounts = new Map();
  for (const row of rows) {
    const rawStatus = String(row?.議案狀態 || row?.狀態 || "").replace(/\s+/g, " ").trim();
    // ponytail: 上游附件欄位偶爾造成欄位位移；寧缺毋濫，不把 URL／HTML 片段當狀態。
    const status = rawStatus && rawStatus.length <= 40 && !/https?:\/\/|HTML結果|網址|\}\]|\}\s*$/.test(rawStatus)
      ? rawStatus
      : "";
    if (!status) continue;
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
  }
  const statusText = [...statusCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hant"))
    .slice(0, 3)
    .map(([status, count]) => `${status} ${count} 件`)
    .join("；");
  return {
    id: stableId("legislature", `${LEGISLATURE_DATASET_ID}|${latestProgress || fetchedAt}|${rows.length}`),
    title: `立法院議案進度參考：${latestProgress || "最新快照"}`,
    region: "全國",
    timestamp: latestProgress ? new Date(latestProgress).toISOString() : fetchedAt,
    category: "國會",
    scope: "domestic",
    riskLevel: "low",
    riskBasis: "立法院公開議案進度參考快照；不對政策或政治風險做自動推論",
    summary: `本次讀取 ${rows.length} 筆議案；最新進度 ${latestProgress || "未提供"}；${statusText || "沒有狀態彙整"}。`,
    locationPrecision: "country",
    source: {
      ...OFFICIAL_SOURCE_META.legislature,
      url: LEGISLATURE_SOURCE_URL,
      fetchedAt,
      ...(latestProgress ? { latestDataDate: latestProgress } : {}),
      recordRef: `${latestProgress || fetchedAt}|${rows.length}`,
      retentionPolicy: "reference",
    },
  };
}

export function mapTourismSnapshotEvent(payload, { fetchedAt = new Date().toISOString() } = {}) {
  const rows = rowsAsObjects(payload)
    .map((row) => ({ name: String(row?.name || row?.名稱 || "").trim(), value: numericValue(row?.value ?? row?.數值) }))
    .filter((row) => row.name && Number.isFinite(row.value));
  if (!rows.length) throw new Error("觀光統計沒有有效客源資料");
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return {
    id: stableId("tourism", `${TOURISM_DATASET_ID}|${rows.map((row) => `${row.name}:${row.value}`).join("|")}`),
    title: "交通部觀光署來臺旅客上月概況",
    region: "全國",
    timestamp: fetchedAt,
    category: "觀光",
    scope: "domestic",
    riskLevel: "low",
    riskBasis: "觀光署統計參考快照；不由旅客量單獨推導經濟或安全結論",
    summary: `五大客源群合計 ${total} 人次；${rows.map((row) => `${row.name} ${row.value}`).join("；")}。`,
    locationPrecision: "country",
    source: {
      ...OFFICIAL_SOURCE_META.tourismStat,
      url: TOURISM_SOURCE_URL,
      fetchedAt,
      recordRef: rows.map((row) => `${row.name}:${row.value}`).join("|") || fetchedAt,
      retentionPolicy: "reference",
    },
  };
}

const POPULATION_AGE_FIELDS = [
  "0-4歲合計數量", "5-9歲合計數量", "10-14歲合計數量", "15-19歲合計數量", "20-24歲合計數量",
  "25-29歲合計數量", "30-34歲合計數量", "35-39歲合計數量", "40-44歲合計數量", "45-49歲合計數量",
  "50-54歲合計數量", "55-59歲合計數量", "60-64歲合計數量", "65-69歲合計數量", "70-74歲合計數量",
  "75-79歲合計數量", "80-84歲合計數量", "85-89歲合計數量", "90-94歲合計數量", "95-99歲合計數量", "100歲以上數量",
];

export function mapSocialPopulationEvent(payload, { fetchedAt = new Date().toISOString() } = {}) {
  const rows = rowsAsObjects(payload).filter((row) => String(row?.區別 || row?.里別 || "").trim());
  if (!rows.length) throw new Error("臺中市人口結構沒有有效資料列");
  const totals = rows.filter((row) => String(row?.性別 || "").trim() === "計");
  const baseRows = totals.length ? totals : rows;
  const population = baseRows.reduce((total, row) => total + POPULATION_AGE_FIELDS.reduce((sum, field) => {
    const value = numericValue(row?.[field]);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0), 0);
  const districts = new Set(rows.map((row) => String(row?.區別 || "").trim()).filter(Boolean));
  const villages = new Set(rows.map((row) => String(row?.里別 || "").trim()).filter(Boolean));
  return {
    id: stableId("social-population", `${SOCIAL_POPULATION_DATASET_ID}|${rows.length}|${population}`),
    title: "臺中市人口結構參考快照",
    region: "臺中市",
    timestamp: fetchedAt,
    category: "社福",
    scope: "domestic",
    riskLevel: "low",
    riskBasis: "地方人口結構參考快照；不代表全國人口或即時社福需求",
    summary: `涵蓋臺中市 ${districts.size} 區、${villages.size} 里；依性別合計列估算 ${population} 人口。`,
    locationPrecision: "county-center",
    ...countyCoordFromAddr("臺中市"),
    source: {
      ...OFFICIAL_SOURCE_META.socialPopulation,
      url: SOCIAL_POPULATION_SOURCE_URL,
      fetchedAt,
      recordRef: `${districts.size}|${villages.size}|${rows.length}`,
      retentionPolicy: "reference",
    },
  };
}

function educationYearEndIso(year, fallback) {
  const number = Number(year);
  if (!Number.isInteger(number) || number < 1900 || number > 2200) return fallback;
  return new Date(Date.UTC(number, 11, 31, 15, 59, 59)).toISOString();
}

export function mapEducationSnapshotEvent(payload, { fetchedAt = new Date().toISOString() } = {}) {
  const rows = rowsAsObjects(payload).filter((row) => /^\d{4}$/.test(String(row?.field1 || "").trim()));
  if (!rows.length) throw new Error("教育概況沒有有效年度資料列");
  const latestYear = Math.max(...rows.map((row) => Number(row.field1)));
  const latest = rows.filter((row) => Number(row.field1) === latestYear);
  const totalRow = latest.find((row) => String(row?.field2 || "").includes("總計")) || latest[0];
  const schoolCount = numericValue(totalRow?.["item value3"]);
  const studentCount = numericValue(totalRow?.["item value16"]);
  const values = [
    Number.isFinite(schoolCount) ? `學校 ${schoolCount}` : "學校數未提供",
    Number.isFinite(studentCount) ? `學生 ${studentCount}` : "學生數未提供",
  ];
  return {
    id: stableId("education", `${EDUCATION_DATASET_ID}|${latestYear}`),
    title: `新北市高級中等學校教育概況：${latestYear} 年`,
    region: "新北市",
    timestamp: educationYearEndIso(latestYear, fetchedAt),
    category: "教育",
    scope: "domestic",
    riskLevel: "low",
    riskBasis: "地方年度教育統計參考快照；不代表全國教育即時狀態",
    summary: `${latestYear} 年資料涵蓋 ${latest.length} 個統計列；${values.join("；")}。`,
    locationPrecision: "county-center",
    ...countyCoordFromAddr("新北市"),
    source: {
      ...OFFICIAL_SOURCE_META.education,
      url: EDUCATION_SOURCE_URL,
      fetchedAt,
      latestDataDate: String(latestYear),
      recordRef: `${latestYear}|${latest.length}`,
      retentionPolicy: "reference",
    },
  };
}

function compactDateIso(value, fallback) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? taiwanTimestamp(`${match[1]}-${match[2]}-${match[3]}`, fallback) : fallback;
}

export function mapFinanceDerivativesEvent(payload, { fetchedAt = new Date().toISOString() } = {}) {
  const rows = rowsAsObjects(payload)
    .map((row) => ({ row, date: String(row?.日期 || "").trim() }))
    .filter((item) => /^(\d{4})(\d{2})(\d{2})$/.test(item.date));
  if (!rows.length) throw new Error("期貨三大法人資料沒有有效日期");
  const latestDataDate = rows.map((item) => item.date).sort().at(-1);
  const latest = rows.filter((item) => item.date === latestDataDate);
  const netOpenInterest = latest.reduce((total, { row }) => {
    const value = numericValue(row?.["多空未平倉契約金額淨額(千元)"]);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
  const products = new Set(latest.map(({ row }) => String(row?.商品名稱 || "").trim()).filter(Boolean));
  return {
    id: stableId("finance-derivatives", `${FINANCE_DATASET_ID}|${latestDataDate}`),
    title: `臺灣期貨交易所三大法人選擇權：${latestDataDate.slice(0, 4)}-${latestDataDate.slice(4, 6)}-${latestDataDate.slice(6)}`,
    region: "全國",
    timestamp: compactDateIso(latestDataDate, fetchedAt),
    category: "金融",
    scope: "domestic",
    riskLevel: "low",
    riskBasis: "官方衍生性金融商品統計參考；不產生買賣訊號或投資建議",
    summary: `資料日 ${latestDataDate.slice(0, 4)}-${latestDataDate.slice(4, 6)}-${latestDataDate.slice(6)}，涵蓋 ${products.size} 類選擇權商品、${latest.length} 筆法人列；多空未平倉契約金額淨額合計 ${netOpenInterest} 千元。`,
    locationPrecision: "country",
    source: {
      ...OFFICIAL_SOURCE_META.financeDerivatives,
      url: FINANCE_SOURCE_URL,
      fetchedAt,
      latestDataDate: `${latestDataDate.slice(0, 4)}-${latestDataDate.slice(4, 6)}-${latestDataDate.slice(6)}`,
      recordRef: `${latestDataDate}|${latest.length}`,
      retentionPolicy: "reference",
    },
  };
}

export function mapLaborStatisticsEvent(payload, { fetchedAt = new Date().toISOString() } = {}) {
  const rows = rowsAsObjects(payload).filter((row) => /^\d{4}$/.test(String(row?.field1 || "").trim()));
  if (!rows.length) throw new Error("失業率年度統計沒有有效資料列");
  const latestYear = Math.max(...rows.map((row) => Number(row.field1)));
  const latest = rows.find((row) => Number(row.field1) === latestYear) || {};
  const fields = [
    ["未婚男", "item value2"], ["未婚女", "item value3"],
    ["有偶同居男", "item value4"], ["有偶同居女", "item value5"],
    ["離婚喪偶及分居男", "item value6"], ["離婚喪偶及分居女", "item value7"],
  ];
  const values = fields
    .map(([label, field]) => [label, numericValue(latest[field])])
    .filter(([, value]) => Number.isFinite(value))
    .map(([label, value]) => `${label} ${value}%`);
  return {
    id: stableId("labor-stats", `${LABOR_DATASET_ID}|${latestYear}`),
    title: `新北市失業率年度統計：${latestYear} 年`,
    region: "新北市",
    timestamp: educationYearEndIso(latestYear, fetchedAt),
    category: "勞動",
    scope: "domestic",
    riskLevel: "low",
    riskBasis: "地方年度勞動統計參考；不代表全國即時就業或職災風險",
    summary: `${latestYear} 年失業率（婚姻狀況／性別）：${values.join("；") || "沒有可用數值"}。`,
    locationPrecision: "county-center",
    ...countyCoordFromAddr("新北市"),
    source: {
      ...OFFICIAL_SOURCE_META.laborStats,
      url: LABOR_SOURCE_URL,
      fetchedAt,
      latestDataDate: String(latestYear),
      recordRef: `${latestYear}|${rows.length}`,
      retentionPolicy: "reference",
    },
  };
}

async function fetchParkingSource(profile, { url, token } = {}) {
  const payload = await queryTwinkleRows({
    url,
    token,
    dataset_id: profile.datasetId,
    limit: 500,
  });
  const events = mapParkingSummaryEvent(rowsAsObjects(payload), profile);
  if (!events.length) throw new Error(`${profile.name} 沒有有效停車容量資料`);
  return events;
}

export async function fetchMoenvAirQuality({ url, token, fetchImpl = fetch } = {}) {
  const fetchedAt = new Date().toISOString();
  const payload = await queryTwinkleRows({
    url,
    token,
    dataset_id: MOENV_AIR_DATASET_ID,
    where: "itemengname IN ('PM2.5','PM10','O3','NO2','SO2','CO')",
    order_by: "monitordate DESC",
    limit: 600,
  });
  let stations = [];
  try {
    const stationPayload = await fetchChecked(MOENV_AIR_STATION_URL, {
      fetchImpl,
      json: true,
      timeoutMs: 60000,
      attempts: 2,
    });
    stations = stationPayload?.features || [];
  } catch (error) {
    console.warn(`環境部空品測站位置圖失敗，改用全國／縣市層級：${error.message}`);
  }
  const events = mapMoenvAirQualityEvents(payload, stations, { fetchedAt });
  if (!events.length) throw new Error("環境部空品監測資料沒有有效測站值");
  return events;
}

export async function fetchParkingHsinchu({ url, token } = {}) {
  return fetchParkingSource(PARKING_SOURCE_PROFILES.hsinchu, { url, token });
}

export async function fetchParkingTaoyuan({ url, token } = {}) {
  return fetchParkingSource(PARKING_SOURCE_PROFILES.taoyuan, { url, token });
}

export async function fetchEconomicIndicators({ url, token } = {}) {
  const fetchedAt = new Date().toISOString();
  const payload = await queryTwinkleRows({
    url,
    token,
    dataset_id: ECONOMIC_DATASET_ID,
    order_by: '"日期（月別）" DESC',
    limit: 24,
  });
  return [mapEconomicIndicatorEvent(payload, { fetchedAt })];
}

export async function fetchAgriculturePrices({ url, token } = {}) {
  const fetchedAt = new Date().toISOString();
  const payload = await queryTwinkleRows({
    url,
    token,
    dataset_id: AGRICULTURE_DATASET_ID,
    order_by: "YEAR DESC, MONTH DESC, PERIOD DESC",
    limit: 500,
  });
  return [mapAgriculturePriceEvent(payload, { fetchedAt })];
}

export async function fetchHealthcareFacilities({ url, token } = {}) {
  const fetchedAt = new Date().toISOString();
  const payload = await queryTwinkleRows({
    url,
    token,
    dataset_id: HEALTHCARE_DATASET_ID,
    columns: ["COUNT(*) AS n"],
    limit: 1,
  });
  return [mapHealthcareFacilityEvent(payload, { fetchedAt })];
}

export async function fetchFireStatistics({ url, token } = {}) {
  const fetchedAt = new Date().toISOString();
  const payload = await queryTwinkleRows({
    url,
    token,
    dataset_id: FIRE_DATASET_ID,
    limit: 100,
  });
  return [mapFireStatisticsEvent(payload, { fetchedAt })];
}

export async function fetchLegislatureBills({ url, token } = {}) {
  const fetchedAt = new Date().toISOString();
  const payload = await queryTwinkleRows({
    url,
    token,
    dataset_id: LEGISLATURE_DATASET_ID,
    limit: 100,
  });
  return [mapLegislatureBillsEvent(payload, { fetchedAt })];
}

export async function fetchTourismSnapshot({ url, token } = {}) {
  const fetchedAt = new Date().toISOString();
  const payload = await queryTwinkleRows({
    url,
    token,
    dataset_id: TOURISM_DATASET_ID,
    limit: 10,
  });
  return [mapTourismSnapshotEvent(payload, { fetchedAt })];
}

export async function fetchSocialPopulation({ url, token } = {}) {
  const fetchedAt = new Date().toISOString();
  const payload = await queryTwinkleRows({
    url,
    token,
    dataset_id: SOCIAL_POPULATION_DATASET_ID,
    limit: 2500,
  });
  return [mapSocialPopulationEvent(payload, { fetchedAt })];
}

export async function fetchEducationSnapshot({ url, token } = {}) {
  const fetchedAt = new Date().toISOString();
  const payload = await queryTwinkleRows({
    url,
    token,
    dataset_id: EDUCATION_DATASET_ID,
    limit: 500,
  });
  return [mapEducationSnapshotEvent(payload, { fetchedAt })];
}

export async function fetchFinanceDerivatives({ url, token } = {}) {
  const fetchedAt = new Date().toISOString();
  const payload = await queryTwinkleRows({
    url,
    token,
    dataset_id: FINANCE_DATASET_ID,
    limit: 100,
  });
  return [mapFinanceDerivativesEvent(payload, { fetchedAt })];
}

export async function fetchLaborStatistics({ url, token } = {}) {
  const fetchedAt = new Date().toISOString();
  const payload = await queryTwinkleRows({
    url,
    token,
    dataset_id: LABOR_DATASET_ID,
    limit: 100,
  });
  return [mapLaborStatisticsEvent(payload, { fetchedAt })];
}
