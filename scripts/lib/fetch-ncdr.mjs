// NCDR 災防示警 CAP：Atom 聚合端點 + CAP 1.2 明細 → IntelEvent[]。
// 類別白名單只收突發、具地理影響且目前沒有既有管線完整覆蓋者：
// - 地震已有 CWA quake 管線
// - 高溫/降雨/雷雨/強風已有 cwaWarnings
// - 停水/水庫放流多為例行維運公告
// 因此保留：淹水、淹水感測、火災、道路封閉、鐵路事故、海洋污染。
import { detectCountyLoose } from "./news-bulk.mjs";
import { nearestCounty } from "./coords.mjs";

export const NCDR_ATOM_URL = "https://alerts.ncdr.nat.gov.tw/JSONAtomFeed.ashx";
export const NCDR_DATASET_ID = "ncdr-cap-alert";

const WHITELIST = new Set(["淹水", "淹水感測", "火災", "道路封閉", "鐵路事故", "海洋污染"]);
const CATEGORY_MAP = {
  淹水: "災防",
  淹水感測: "災防",
  火災: "災防",
  道路封閉: "交通",
  鐵路事故: "交通",
  海洋污染: "環境",
};
const RISK_MAP = {
  Extreme: "critical",
  Severe: "high",
  Moderate: "medium",
};

function arr(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value) {
  return String(value ?? "").trim();
}

function compactText(value, max = 200) {
  const out = text(value).replace(/\s+/g, " ");
  return out.length > max ? out.slice(0, max) : out;
}

function decodeXml(value) {
  return text(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function tagValue(xml, tag) {
  const m = String(xml || "").match(new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}>`, "i"));
  return m ? decodeXml(m[1]) : "";
}

function allBlocks(xml, tag) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}>`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(String(xml || ""))) !== null) out.push(m[1]);
  return out;
}

// CAP 幾何：polygon 為「緯度,經度」空白分隔頂點（取平均），circle 為「緯度,經度 半徑km」（取圓心）。
// 頂點在「正常」或「經緯顛倒」其中一種取向合法即保留（顛倒於平均後再判定交換）。
const plausibleVertex = (a, b) =>
  (a >= -90 && a <= 90 && b >= -180 && b <= 180) || (a >= -180 && a <= 180 && b >= -90 && b <= 90);
const inTaiwan = (lat, lng) => lat >= 21 && lat <= 27 && lng >= 117 && lng <= 123;
// 點位正規化（polygon 平均與 circle 圓心共用）：已在台灣框內直接採用；
// 顛倒（經緯序反）且交換後在框內 → 交換；兩個取向都在框外 → 丟棄（呼叫端退回文字定位）。
const normalizeTaiwanPoint = (lat, lng) => {
  if (inTaiwan(lat, lng)) return { lat, lng };
  if (inTaiwan(lng, lat)) return { lat: lng, lng: lat };
  return null;
};

function capAreaGeometry(areaXml) {
  const polygon = tagValue(areaXml, "polygon");
  if (polygon) {
    // 先以空白切出每個頂點、逐一驗證「恰好兩個數字」；缺值頂點（"23.5,"、"bad"）丟棄，
    // 不可借用下一個頂點的數字（跨頂點配對會把下個頂點的緯度錯當本頂點經度）。
    const pts = polygon
      .trim()
      .split(/\s+/)
      .map((token) => {
        const m = token.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
        return m ? [Number(m[1]), Number(m[2])] : null;
      })
      .filter((p) => p && plausibleVertex(p[0], p[1]));
    // 閉合環首尾同點 → 去尾點再平均。
    if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
    if (pts.length) {
      const lat = pts.reduce((sum, p) => sum + p[0], 0) / pts.length;
      const lng = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;
      const point = normalizeTaiwanPoint(lat, lng);
      if (point) return point;
    }
  }
  const circle = tagValue(areaXml, "circle");
  if (circle) {
    const m = circle.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (m) {
      const point = normalizeTaiwanPoint(Number(m[1]), Number(m[2]));
      if (point) return point;
    }
  }
  return null;
}

export function parseCapAlert(xml) {
  const body = String(xml || "");
  const infos = allBlocks(body, "info");
  const info = infos.find((block) => allBlocks(block, "area").some((area) => capAreaGeometry(area))) || infos[0] || "";
  const areas = allBlocks(info, "area");
  const areaDescs = areas.map((a) => tagValue(a, "areaDesc")).filter(Boolean);
  const areaDesc = areaDescs.join("、") || tagValue(info, "areaDesc");
  // 幾何與區域描述必須同源：記錄產生幾何的那個 <area> 的 areaDesc，供 region 判定用。
  const geomArea =
    areas.map((a) => ({ geometry: capAreaGeometry(a), areaDesc: tagValue(a, "areaDesc") })).find((g) => g.geometry) ||
    null;
  const area = areas[0] || "";
  return {
    identifier: tagValue(body, "identifier"),
    sent: tagValue(body, "sent"),
    status: tagValue(body, "status"),
    msgType: tagValue(body, "msgType"),
    event: tagValue(info, "event"),
    urgency: tagValue(info, "urgency"),
    severity: tagValue(info, "severity"),
    certainty: tagValue(info, "certainty"),
    effective: tagValue(info, "effective"),
    expires: tagValue(info, "expires"),
    senderName: tagValue(info, "senderName"),
    headline: tagValue(info, "headline"),
    description: tagValue(info, "description"),
    instruction: tagValue(info, "instruction"),
    web: tagValue(info, "web"),
    areaDesc,
    areaDescs,
    geocode: tagValue(area || info, "value"),
    geometryAreaDesc: geomArea ? text(geomArea.areaDesc) : "",
    lat: geomArea?.geometry.lat ?? null,
    lng: geomArea?.geometry.lng ?? null,
  };
}

function atomCategories(entry) {
  return arr(entry?.category || entry?.title).flat()
    .map((category) => text(category?.["@term"] || category?.term || (typeof category === "string" ? category : "")))
    .filter(Boolean);
}

function atomHref(entry) {
  return text(entry?.link?.["@href"] || entry?.link?.href || entry?.link?.url || entry?.link);
}

function atomUpdatedMs(entry) {
  const t = Date.parse(entry?.updated || "");
  return Number.isFinite(t) ? t : 0;
}

function parseChineseTaipeiDate(value) {
  const s = text(value);
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(上午|下午)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : NaN;
  }
  let hour = Number(m[5]);
  if (m[4] === "上午" && hour === 12) hour = 0;
  if (m[4] === "下午" && hour < 12) hour += 12;
  const iso =
    `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` +
    `T${String(hour).padStart(2, "0")}:${m[6]}:${(m[7] || "00").padStart(2, "0")}+08:00`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

function isExpired(entry, nowMs) {
  const t = parseChineseTaipeiDate(entry?.expires);
  return Number.isFinite(t) && t <= nowMs;
}

function capXmlFor(capByHref, href) {
  if (!capByHref || !href) return "";
  if (capByHref instanceof Map) return capByHref.get(href) || "";
  return capByHref[href] || "";
}

function selectEntries(atomJson, { now, maxDetail = 60 } = {}) {
  const nowMs = typeof now === "number" ? now : Date.parse(now || "");
  const entries = arr(atomJson?.entry);
  const status = {
    raw: entries.length,
    whitelisted: 0,
    kept: 0,
    skippedCancel: 0,
    skippedExpired: 0,
    failedDetail: 0,
    byCategory: {},
    excludedCategory: {},
  };
  const candidates = [];

  for (const entry of entries) {
    const categories = atomCategories(entry);
    const category = categories.find((value) => WHITELIST.has(value));
    if (!category) {
      for (const value of categories) status.excludedCategory[value] = (status.excludedCategory[value] || 0) + 1;
      continue;
    }
    status.whitelisted++;
    const msgType = text(entry?.msgType);
    if (msgType === "Cancel") {
      status.skippedCancel++;
      continue;
    }
    if (Number.isFinite(nowMs) && isExpired(entry, nowMs)) {
      status.skippedExpired++;
      continue;
    }
    candidates.push({ entry, category, href: atomHref(entry) });
  }

  candidates.sort((a, b) => atomUpdatedMs(b.entry) - atomUpdatedMs(a.entry));
  if (status.raw > 0 && status.whitelisted === 0) status.warning = "沒有任何白名單類別，回傳正常空結果";
  return { entries: candidates.slice(0, Number(maxDetail) || 60), status };
}

function mapCapToEvent(entry, category, href, cap, { fetchedAt }) {
  const areaDesc = text(cap.areaDesc);
  const hasGeometry = Number.isFinite(cap?.lat) && Number.isFinite(cap?.lng);
  // 座標與 region 必須同源：有幾何時用該 area 的 areaDesc 決定 region（找不到再取最近縣市），
  // 不可拿別的 area 的文字偵測結果配這個 area 的座標。
  let detected = { region: "全國", lat: null, lng: null };
  let region;
  if (hasGeometry) {
    const geoArea = detectCountyLoose(text(cap.geometryAreaDesc));
    region = geoArea.lat != null ? geoArea.region : nearestCounty(cap.lat, cap.lng) || "全國";
  } else {
    // 縣市偵測依序看各 areaDesc→headline→description（第一個 area 為主；
    // NCDR 常把鄉鎮縣市寫在描述而非 areaDesc）。
    const detectTexts = [
      ...(Array.isArray(cap?.areaDescs) && cap.areaDescs.length ? cap.areaDescs : [areaDesc]),
      cap.headline,
      cap.description,
    ].map(text).filter(Boolean);
    for (const t of detectTexts) {
      detected = detectCountyLoose(t);
      if (detected.lat != null) break;
    }
    region = detected.region;
  }
  const coord = {
    region,
    lat: hasGeometry ? cap.lat : detected.lat,
    lng: hasGeometry ? cap.lng : detected.lng,
    locationPrecision: hasGeometry ? "district" : detected.lat != null ? "county-center" : "country",
  };
  const identifier = text(cap.identifier || entry?.id);
  const title = text(cap.headline) || `${category}｜${areaDesc || coord.region || "全國"}`;
  const summary = compactText(cap.description || entry?.summary?.["#text"] || title);
  return {
    id: `ncdr-${identifier}`,
    title,
    region: coord.region,
    lat: coord.lat,
    lng: coord.lng,
    locationPrecision: coord.locationPrecision,
    timestamp: text(cap.sent) || text(entry?.updated) || fetchedAt,
    category: CATEGORY_MAP[category] || "災防",
    scope: "domestic",
    riskLevel: RISK_MAP[text(cap.severity)] || "low",
    summary: summary || title,
    source: {
      name: `NCDR示警·${text(cap.senderName || entry?.author?.name) || "NCDR"}`,
      type: "gov-open-data",
      url: text(cap.web) || href || NCDR_ATOM_URL,
      fetchedAt,
      datasetId: NCDR_DATASET_ID,
      recordRef: identifier || href || title,
      query: "NCDR 災防示警 CAP",
    },
  };
}

export function buildNcdrEvents(atomJson, capByHref, { now, fetchedAt, maxDetail = 60 } = {}) {
  const effectiveFetchedAt = fetchedAt || (typeof now === "number" ? new Date(now).toISOString() : text(now));
  const { entries, status } = selectEntries(atomJson, { now, maxDetail });
  const events = [];

  for (const { entry, category, href } of entries) {
    const xml = capXmlFor(capByHref, href);
    if (!xml) {
      status.failedDetail++;
      continue;
    }
    let cap;
    try {
      cap = parseCapAlert(xml);
    } catch {
      status.failedDetail++;
      continue;
    }
    if (!cap.identifier && !entry?.id) {
      status.failedDetail++;
      continue;
    }
    if (cap.msgType === "Cancel") {
      status.skippedCancel++;
      continue;
    }
    const capExpires = Date.parse(cap.expires || "");
    const nowMs = typeof now === "number" ? now : Date.parse(now || "");
    if (Number.isFinite(capExpires) && Number.isFinite(nowMs) && capExpires <= nowMs) {
      status.skippedExpired++;
      continue;
    }
    const event = mapCapToEvent(entry, category, href, cap, { fetchedAt: effectiveFetchedAt });
    events.push(event);
    status.kept++;
    status.byCategory[category] = (status.byCategory[category] || 0) + 1;
  }

  // 全部過期／撤銷是正常的平靜期（回空陣列）；只有 feed 為空或明細全部抓不到才算來源失敗。
  if (status.raw === 0 || (status.failedDetail > 0 && status.kept === 0)) {
    throw new Error(`NCDR 沒有可用示警（raw=${status.raw}, whitelisted=${status.whitelisted}, kept=${status.kept}, failedDetail=${status.failedDetail}）`);
  }
  return { events, status };
}

async function fetchText(url, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "*/*" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function fetchNcdrAlerts({ timeoutMs = 15000, maxDetail = Number(process.env.NCDR_MAX_DETAIL) || 60, now = Date.now() } = {}) {
  const fetchedAt = new Date().toISOString();
  const atomText = await fetchText(NCDR_ATOM_URL, { timeoutMs });
  const atomJson = JSON.parse(atomText);
  const selected = selectEntries(atomJson, { now, maxDetail });
  const capByHref = {};

  await mapLimit(selected.entries, 3, async ({ href }) => {
    if (!href) return;
    try {
      capByHref[href] = await fetchText(href, { timeoutMs });
    } catch {
      // 單筆 CAP 明細 fail-soft；buildNcdrEvents 會以 failedDetail 計數並跳過。
    }
  });

  return buildNcdrEvents(atomJson, capByHref, { now, fetchedAt, maxDetail });
}
