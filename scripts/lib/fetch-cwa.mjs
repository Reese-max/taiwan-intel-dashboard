// 地震 live fetcher：中央氣象署 opendata E-A0015-001（顯著有感地震報告）→ IntelEvent[]
// 座標為真實震央；風險為依規模衍生之指標。
import { countyCoordFromAddr } from "./coords.mjs";

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

async function fetchCwaJson(url, {
  fetchImpl = fetch,
  attempts = 3,
  retryDelayMs = 1000,
  timeoutMs = 30000,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetriableFetchError(error)) break;
      if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }
  }
  throw new Error(`${new URL(url).hostname} ${fetchErrorDetail(lastError) || "fetch failed"}`, { cause: lastError });
}

function riskByMagnitude(m) {
  const n = Number(m);
  if (!Number.isFinite(n)) return "low";
  if (n >= 6.0) return "critical";
  if (n >= 5.0) return "high";
  if (n >= 4.0) return "medium";
  return "low";
}

// 從震央描述抽縣市名（如「臺東縣政府北北東方 63.9 公里」→「臺東縣」）
function regionFromLocation(loc) {
  if (!loc) return "臺灣近海";
  const m = loc.match(/^(.+?[縣市])/);
  return m ? m[1] : "臺灣近海";
}

// 由 Web URL（.../earthquake/details/2026047）取報告編號，與既有 id 慣例一致
function refFromWeb(web, fallback) {
  const m = (web || "").match(/details\/(\w+)/);
  return m ? m[1] : String(fallback);
}

export async function fetchCwa({ apiKey, limit = 10, fetchImpl = fetch, retryDelayMs = 1000 }) {
  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/E-A0015-001?Authorization=${apiKey}&limit=${limit}`;
  const json = await fetchCwaJson(url, { fetchImpl, retryDelayMs });
  const quakes = json?.records?.Earthquake || [];
  const fetchedAt = new Date().toISOString();

  return quakes.map((q) => {
    const info = q.EarthquakeInfo || {};
    const epi = info.Epicenter || {};
    const mag = info.EarthquakeMagnitude?.MagnitudeValue;
    const ref = refFromWeb(q.Web, q.EarthquakeNo);
    return {
      id: `eq-${ref}`,
      title: `${regionFromLocation(epi.Location)}規模 ${mag} 地震`,
      region: regionFromLocation(epi.Location),
      lat: epi.EpicenterLatitude,
      lng: epi.EpicenterLongitude,
      timestamp: info.OriginTime,
      category: "災防",
      scope: "domestic",
      riskLevel: riskByMagnitude(mag),
      summary: q.ReportContent || `${epi.Location},芮氏規模 ${mag},深度 ${info.FocalDepth} 公里。`,
      source: {
        name: "中央氣象署 顯著有感地震報告",
        type: "cwa",
        datasetId: "E-A0015-001",
        recordRef: ref,
        url: q.Web || `https://scweb.cwa.gov.tw/zh-tw/earthquake/details/${ref}`,
        fetchedAt,
        query: "CWA opendata API E-A0015-001 (顯著有感地震報告)",
      },
    };
  });
}

// ----------------------------------------------------------------------------
// 天氣警特報 live fetcher：中央氣象署 opendata W-C0033-001
// （各縣市目前之天氣警特報情形）→ IntelEvent[]
// 當天即時、縣市級告警，警政第一線可據以判斷警力部署/災防應變。
// 座標為縣市中心「推估」（衍生值，非原始資料欄位）；純 mapper 抽離供測試。
// ----------------------------------------------------------------------------

// 由現象名稱衍生風險指標（誠實標註：非氣象署官方分級，為本儀表板之操作性指標）。
// 比對順序需由重至輕，避免「豪雨」誤吃「大雨」之類的子字串問題。
function riskByWarning(phenomena) {
  const p = phenomena || "";
  if (p.includes("超大豪雨") || p.includes("海嘯")) return "critical";
  if (p.includes("大豪雨") || p.includes("豪雨") || p.includes("颱風")) return "high";
  if (p.includes("大雨") || p.includes("強風") || p.includes("低溫") || p.includes("高溫")) return "medium";
  return "low";
}

// CWA 本地時間字串（"2026-06-19 11:00:00"）→ ISO+08:00。
function cwaTimeToIso(t) {
  const s = (t || "").trim();
  if (!s) return null;
  return `${s.replace(" ", "T")}+08:00`;
}

export function mapCwaWarningEvents({ locations, fetchedAt }) {
  const events = [];
  for (const loc of locations || []) {
    const name = loc.locationName || loc.LocationName || "";
    const geocode = loc.geocode ?? loc.Geocode ?? name;
    const hazards = loc.hazardConditions?.hazards || [];
    if (!hazards.length) continue;
    const coord = countyCoordFromAddr(name) || {};
    const region = coord.region || name;
    for (const h of hazards) {
      const info = h.info || {};
      const phenomena = (info.phenomena || "").trim();
      if (!phenomena) continue;
      const significance = (info.significance || "").trim();
      const vt = h.validTime || {};
      const start = (vt.startTime || "").trim();
      const end = (vt.endTime || "").trim();
      const startKey = start.replace(/\D/g, "") || "na";
      events.push({
        id: `cwa-warn-${geocode}-${phenomena}-${startKey}`,
        title: `${region}${phenomena}${significance}`,
        region,
        lat: coord.lat,
        lng: coord.lng,
        timestamp: cwaTimeToIso(start) || fetchedAt,
        category: "災防",
        scope: "domestic",
        riskLevel: riskByWarning(phenomena),
        summary: `${region}發布${phenomena}${significance}${
          start && end ? `，生效時間 ${start} 至 ${end}` : ""
        }。資料來源：中央氣象署天氣警特報。`,
        source: {
          name: "中央氣象署 天氣警特報",
          type: "cwa",
          datasetId: "W-C0033-001",
          recordRef: `${geocode}-${startKey}`,
          url: "https://www.cwa.gov.tw/V8/C/W/warning_real.html",
          fetchedAt,
          query: "CWA opendata API W-C0033-001 (天氣特報-各縣市目前天氣警特報情形)",
        },
      });
    }
  }
  return events;
}

export async function fetchCwaWarnings({ apiKey, fetchImpl = fetch, retryDelayMs = 1000 }) {
  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/W-C0033-001?Authorization=${apiKey}`;
  const json = await fetchCwaJson(url, { fetchImpl, retryDelayMs });
  const locations = json?.records?.location || [];
  return mapCwaWarningEvents({ locations, fetchedAt: new Date().toISOString() });
}
