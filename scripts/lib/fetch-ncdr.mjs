// NCDR 災防示警 CAP：Atom 聚合端點 + CAP 1.2 明細 → IntelEvent[]。
// 類別白名單只收突發、具地理影響且目前沒有既有管線完整覆蓋者：
// - 地震已有 CWA quake 管線
// - 高溫/降雨/雷雨/強風已有 cwaWarnings
// - 停水/水庫放流多為例行維運公告
// 因此保留：淹水、淹水感測、火災、道路封閉、鐵路事故、海洋污染。
import { countyCoordFromAddr } from "./coords.mjs";

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

function firstBlock(xml, tag) {
  const m = String(xml || "").match(new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}>`, "i"));
  return m ? m[1] : "";
}

export function parseCapAlert(xml) {
  const body = String(xml || "");
  const info = firstBlock(body, "info");
  const area = firstBlock(info, "area");
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
    areaDesc: tagValue(area || info, "areaDesc"),
    geocode: tagValue(area || info, "value"),
  };
}

function atomCategory(entry) {
  return text(entry?.category?.["@term"] || entry?.category?.term || entry?.category || entry?.title);
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
    const category = atomCategory(entry);
    if (!WHITELIST.has(category)) {
      if (category) status.excludedCategory[category] = (status.excludedCategory[category] || 0) + 1;
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
  return { entries: candidates.slice(0, Number(maxDetail) || 60), status };
}

function mapCapToEvent(entry, category, href, cap, { fetchedAt }) {
  const areaDesc = text(cap.areaDesc);
  const coord = countyCoordFromAddr(areaDesc) || { region: "全國", lat: null, lng: null };
  const identifier = text(cap.identifier || entry?.id);
  const title = text(cap.headline) || `${category}｜${areaDesc || coord.region || "全國"}`;
  const summary = compactText(cap.description || entry?.summary?.["#text"] || title);
  return {
    id: `ncdr-${identifier}`,
    title,
    region: coord.region || "全國",
    lat: coord.lat ?? null,
    lng: coord.lng ?? null,
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
