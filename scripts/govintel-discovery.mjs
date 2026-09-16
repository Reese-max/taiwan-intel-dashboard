// GovIntel Discovery Feed producer (issue #25)。
// 從 public/data/domestic.json 投影出有界、可版本化、唯讀的 discovery feed，
// 寫入 public/data/govintel-discovery.json。下游 GovIntel 不應抓 UI 或完整 domestic.json。
//
// 環境變數（皆有安全預設）：
//   DISCOVERY_WINDOW_HOURS  預設 72
//   DISCOVERY_MAX_ITEMS     預設 200
//   DISCOVERY_MAX_BYTES     預設 262144（256KB size gate）
//   DISCOVERY_CATEGORIES    逗號分隔類別白名單，預設 治安,反詐,災防,交通,資安
//   DISCOVERY_DATA_DIR      覆寫 public/data 路徑（測試用）
//   DISCOVERY_STATE_PATH    覆寫 ops/operating-state.json 路徑（測試用）
//   DISCOVERY_NOW           覆寫現在時間（ISO8601，測試用）

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const SCHEMA_VERSION = 1;
export const VALID_OPERATING_STATES = ["PAUSED", "RESTORING", "ACTIVE", "DEGRADED"];
export const DEFAULT_CATEGORIES = ["治安", "反詐", "災防", "交通", "資安"];
export const DEFAULT_WINDOW_HOURS = 72;
export const DEFAULT_MAX_ITEMS = 200;
export const DEFAULT_MAX_BYTES = 256 * 1024;
// 與 audit-coverage.mjs / domain-coverage.mjs 同一個官方來源定義：
// fetcher 不寫 source.authority；官方性由 source.type 判定。
export const OFFICIAL_TYPES = new Set(["gov-open-data", "cwa"]);

// ---------------------------------------------------------------------------
// operating-state：依 #17 契約（ops/operating-state.json）判讀。
// 契約缺失、無效、或自稱 ACTIVE 但缺 restore receipt 時 fail closed ——
// 以 PAUSED + stale 標示，絕不假裝 ACTIVE。
// ---------------------------------------------------------------------------
export function loadOperatingState(statePath) {
  const failClosed = { state: "PAUSED", stale: true, origin: "contract-missing-or-invalid" };
  if (!existsSync(statePath)) return failClosed;
  let doc;
  try {
    doc = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return failClosed;
  }
  if (!doc || typeof doc !== "object") return failClosed;
  if (doc.schemaVersion !== 1 || !VALID_OPERATING_STATES.includes(doc.state)) return failClosed;
  if (!doc.effectiveAt || Number.isNaN(Date.parse(doc.effectiveAt))) return failClosed;
  // #17 契約：ACTIVE 必須附受控復原收據；缺收據的 ACTIVE 宣告是矛盾態，fail closed。
  if (doc.state === "ACTIVE" && !doc.evidence?.restoreReceipt) return failClosed;
  return {
    state: doc.state,
    stale: doc.state !== "ACTIVE",
    origin: "contract",
  };
}

// ---------------------------------------------------------------------------
// provenance / identity
// discovery_id 必須穩定可重播：由 datasetId + recordRef + source.url + title 雜湊，
// 不用陣列 index。original_source_identity 讓 GovIntel 把「direct 官方取得」與
// 「Dashboard 取得」的同一原始來源去重（例如同一筆 CWA/NCDR 紀錄只算一個來源）。
// ---------------------------------------------------------------------------
function sha256Short(text) {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

export function discoveryId(item) {
  const s = item.source || {};
  const basis = `${s.datasetId || ""}|${s.recordRef || ""}|${s.url || ""}|${(item.title || "").trim()}`;
  return `gd-${sha256Short(basis)}`;
}

function looksLikeUrl(v) {
  return typeof v === "string" && /^https?:\/\//i.test(v);
}

export function sourceUrl(item) {
  const s = item.source || {};
  if (looksLikeUrl(s.url)) return s.url;
  if (looksLikeUrl(s.recordRef)) return s.recordRef;
  return null;
}

export function originalSourceIdentity(item) {
  const s = item.source || {};
  const method = s.ingestMethod || "";
  // 聚合器（如 google-news-rss）的 recordRef 是聚合頁而非原始來源；
  // 此時用 publisher + 標題正規化作為可解釋的同源判定依據。
  if (method.includes("google-news") || s.sourceConfidence === "aggregated") {
    const titleKey = (item.title || "").trim().replace(/\s+/g, " ").toLowerCase();
    return `media:${s.publisherName || s.name || "unknown"}:${sha256Short(titleKey)}`;
  }
  if (s.datasetId && s.recordRef) return `${s.datasetId}:${s.recordRef}`;
  if (looksLikeUrl(s.recordRef)) return `url:${s.recordRef}`;
  return null;
}

function isOfficialSource(s) {
  return s.authority === "official" || OFFICIAL_TYPES.has(s.type);
}

// ---------------------------------------------------------------------------
// item 投影：domestic.json item → discovery item
// ---------------------------------------------------------------------------
export function projectItem(item) {
  const s = item.source || {};
  const identity = originalSourceIdentity(item);
  const url = sourceUrl(item);
  const eventTs = item.timestamp && Number.isFinite(Date.parse(item.timestamp))
    ? new Date(item.timestamp).toISOString()
    : null;
  const authority = isOfficialSource(s) ? "official" : "media";
  return {
    discovery_id: discoveryId(item),
    title: item.title || null,
    event_time: eventTs,
    observed_at: s.fetchedAt || null,
    region: item.region || null,
    lat: typeof item.lat === "number" ? item.lat : null,
    lng: typeof item.lng === "number" ? item.lng : null,
    location_precision: item.locationPrecision || null,
    category: item.category || null,
    // Dashboard 語意保留，但僅為 discovery metadata，下游不得當正式公務優先級。
    risk_level: item.riskLevel || null,
    summary: item.summary || null,
    entities: item.aiEntities || item.entities || null,
    topic: item.aiTopic || item.topic || null,
    source_url: url,
    publisher_name: s.publisherName || s.name || null,
    authority,
    source_confidence: s.sourceConfidence || null,
    ingest_method: s.ingestMethod || s.type || null,
    original_dataset_id: s.datasetId || null,
    record_ref: s.recordRef || null,
    original_source_identity: identity,
    // 權利邊界（#19）：政府開放授權/開放宣告 → OPEN_DATA；其餘一律 REVIEW_REQUIRED。
    rights_status: typeof s.license === "string" && /開放/.test(s.license)
      ? "OPEN_DATA"
      : "REVIEW_REQUIRED",
  };
}

// ---------------------------------------------------------------------------
// dedupe winner：同一 original_source_identity 多筆時，優先 official、其次非聚合，
// 再平手取較小 discovery_id —— 與輸入順序無關，重跑可重播。
// ---------------------------------------------------------------------------
function dedupeScore(item) {
  return (item.authority === "official" ? 2 : 0) + (item.ingest_method?.includes("google-news") ? 0 : 1);
}

function preferCandidate(a, b) {
  const sa = dedupeScore(a);
  const sb = dedupeScore(b);
  if (sa !== sb) return sa > sb ? a : b;
  return a.discovery_id <= b.discovery_id ? a : b;
}

// ---------------------------------------------------------------------------
// feed 建構：bounded window + deterministic sort + limit/truncation + size gate
// ---------------------------------------------------------------------------
export function buildDiscoveryFeed({
  domestic,
  operatingState,
  windowHours = DEFAULT_WINDOW_HOURS,
  maxItems = DEFAULT_MAX_ITEMS,
  maxBytes = DEFAULT_MAX_BYTES,
  categories = DEFAULT_CATEGORIES,
  now = new Date(),
  snapshotHash = null,
}) {
  if (!Array.isArray(domestic)) throw new Error("domestic must be an array");
  const nowMs = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(nowMs)) throw new Error("invalid now");
  if (!Number.isFinite(windowHours) || windowHours <= 0) throw new Error("invalid windowHours");
  if (!Number.isFinite(maxItems) || maxItems <= 0) throw new Error("invalid maxItems");
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error("invalid maxBytes");

  const windowMs = windowHours * 3600e3;
  const allow = new Set(categories);
  const excluded = {
    out_of_window: 0,
    category_filtered: 0,
    no_source_identity: 0,
    duplicate_source: 0,
    scope_filtered: 0,
    malformed: 0,
    truncated: 0,
  };

  const byIdentity = new Map();
  for (const raw of domestic) {
    if (!raw || typeof raw !== "object") {
      excluded.malformed += 1;
      continue;
    }
    if (raw.scope !== "domestic") {
      excluded.scope_filtered += 1;
      continue;
    }
    // window 判定以 event_time 為主、observed_at 為輔；兩者皆缺 → 無法界定窗口，排除。
    const eventTs = Date.parse(raw.timestamp);
    const obsTs = Date.parse(raw.source?.fetchedAt);
    const basisTs = Number.isFinite(eventTs) ? eventTs : obsTs;
    if (!Number.isFinite(basisTs) || nowMs - basisTs > windowMs || basisTs - nowMs > 3600e3) {
      excluded.out_of_window += 1;
      continue;
    }
    if (!allow.has(raw.category)) {
      excluded.category_filtered += 1;
      continue;
    }
    const item = projectItem(raw);
    if (!item.original_source_identity && !item.source_url) {
      excluded.no_source_identity += 1;
      continue;
    }
    const dedupeKey = item.original_source_identity || `url:${item.source_url}`;
    const prev = byIdentity.get(dedupeKey);
    if (prev) {
      excluded.duplicate_source += 1;
      byIdentity.set(dedupeKey, preferCandidate(prev, item));
      continue;
    }
    byIdentity.set(dedupeKey, item);
  }
  const projected = [...byIdentity.values()];

  // deterministic sort：event_time 新→舊（null 排最後），同時刻以 discovery_id 字典序。
  projected.sort((a, b) => {
    const ta = a.event_time ? Date.parse(a.event_time) : 0;
    const tb = b.event_time ? Date.parse(b.event_time) : 0;
    if (ta !== tb) return tb - ta;
    if (a.discovery_id === b.discovery_id) return 0;
    return a.discovery_id < b.discovery_id ? -1 : 1;
  });

  let truncated = false;
  let items = projected;
  if (items.length > maxItems) {
    excluded.truncated += items.length - maxItems;
    items = items.slice(0, maxItems);
    truncated = true;
  }

  const envelope = (list) => ({
    schema_version: SCHEMA_VERSION,
    generated_at: now.toISOString(),
    operating_state: operatingState.state,
    stale: operatingState.stale,
    operating_state_source: operatingState.origin,
    source_snapshot_hash: snapshotHash,
    window: { since_hours: windowHours },
    truncated,
    item_count: list.length,
    excluded_counts: excluded,
    items: list,
  });

  // size gate：超過位元組上限就繼續砍尾部，絕不默默養大檔案。
  // +1 補寫入時的結尾換行；單筆即超限 → 清空 items 並 truncated（不出超大檔）。
  let out = envelope(items);
  while (items.length > 0 && Buffer.byteLength(JSON.stringify(out), "utf8") + 1 > maxBytes) {
    const next = items.length === 1 ? [] : items.slice(0, Math.floor(items.length / 2));
    excluded.truncated += items.length - next.length;
    items = next;
    truncated = true;
    out = envelope(items);
  }
  out.truncated = truncated;
  out.item_count = items.length;
  return out;
}

export function hashSnapshot(buf) {
  return `sha256:${createHash("sha256").update(buf).digest("hex")}`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parsePositiveInt(v, fallback) {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function main() {
  const dataDir = process.env.DISCOVERY_DATA_DIR || join(ROOT, "public", "data");
  const statePath = process.env.DISCOVERY_STATE_PATH || join(ROOT, "ops", "operating-state.json");
  const domesticPath = join(dataDir, "domestic.json");
  const outPath = join(dataDir, "govintel-discovery.json");

  if (!existsSync(domesticPath)) {
    console.error(`GOVINTEL_DISCOVERY_ERROR missing input: ${domesticPath}`);
    process.exit(2);
  }
  const buf = readFileSync(domesticPath);
  let domestic;
  try {
    domestic = JSON.parse(buf.toString("utf8"));
  } catch {
    console.error("GOVINTEL_DISCOVERY_ERROR domestic.json is not valid JSON");
    process.exit(2);
  }
  if (!Array.isArray(domestic)) {
    console.error("GOVINTEL_DISCOVERY_ERROR domestic.json must be a JSON array");
    process.exit(2);
  }

  const operatingState = loadOperatingState(statePath);
  const categories = (process.env.DISCOVERY_CATEGORIES || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const now = process.env.DISCOVERY_NOW ? new Date(process.env.DISCOVERY_NOW) : new Date();
  if (Number.isNaN(now.getTime())) {
    console.error("GOVINTEL_DISCOVERY_ERROR DISCOVERY_NOW is not a valid timestamp");
    process.exit(2);
  }

  const feed = buildDiscoveryFeed({
    domestic,
    operatingState,
    windowHours: parsePositiveInt(process.env.DISCOVERY_WINDOW_HOURS, DEFAULT_WINDOW_HOURS),
    maxItems: parsePositiveInt(process.env.DISCOVERY_MAX_ITEMS, DEFAULT_MAX_ITEMS),
    maxBytes: parsePositiveInt(process.env.DISCOVERY_MAX_BYTES, DEFAULT_MAX_BYTES),
    categories: categories.length ? categories : DEFAULT_CATEGORIES,
    now,
    snapshotHash: hashSnapshot(buf),
  });

  mkdirSync(dataDir, { recursive: true });
  // compact 輸出與 public/data 既有檔案一致；size gate 量測的正是寫入格式。
  // 先寫暫存檔再 rename，避免中途崩潰留下截斷的已發布檔。
  const tmpPath = `${outPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(feed) + "\n");
  renameSync(tmpPath, outPath);
  console.log(
    `govintel-discovery: state=${feed.operating_state}(${feed.operating_state_source}) ` +
    `items=${feed.item_count} truncated=${feed.truncated} ` +
    `excluded=${JSON.stringify(feed.excluded_counts)} -> ${outPath}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
