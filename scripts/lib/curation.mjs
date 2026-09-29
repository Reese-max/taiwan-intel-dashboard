// 人工更正 ledger（issue #44）：維護者對關聯／地點／後續關係的明示更正，
// 以版本化 JSONL 保存，pipeline rebuild 時重播，避免自動關聯重複犯同一個錯。
//
// 管線順序：source data → normalize → automatic candidate relations → correction ledger → final network。
// 本模組只輸出「解析結果」（forbidden/forced pairs、location patch、followUps、report），
// 由 correlateEvents 的 opts.corrections 套用；不改寫原始事件資料。
//
// 記錄格式（curation/correlation-overrides.jsonl，每行一筆）：
// {
//   "v": 1,
//   "decision": "not_same_event" | "same_event" | "location_correction" | "follow_up",
//   "ids": ["<event.id>", ...],           // pair 決策恰 2 個；location_correction 恰 1 個；follow_up 前者為後續報導
//   "fingerprints": {"<id>": "sha256:..."}, // curationFingerprint(event) — 內容變了即 needs_review
//   "reason": "...", "evidence": "...",   // 可追溯引用（勿存整篇新聞）
//   "reviewedAt": "ISO-8601"
// }
// location_correction 另帶 "location": {"region"?, "lat"?, "lng"?, "locationPrecision"?}

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const CURATION_SCHEMA_VERSION = 1;
export const CURATION_LEDGER_RELATIVE = "curation/correlation-overrides.jsonl";
export const DEFAULT_LEDGER_PATH = join(REPO_ROOT, CURATION_LEDGER_RELATIVE);
export const CURATION_DECISIONS = new Set(["not_same_event", "same_event", "location_correction", "follow_up"]);
const PAIR_DECISIONS = new Set(["not_same_event", "same_event", "follow_up"]);
// 與 geo-policy.mjs 的 EXACT_PRECISIONS / LOW_PRECISIONS / INCIDENT_ROLES / NON_INCIDENT_ROLES 對齊
const LOCATION_KEYS = new Set(["region", "lat", "lng", "locationPrecision", "locationRole"]);
const LOCATION_PRECISIONS = new Set(["exact", "address", "district", "city", "county-center", "country", "global", "unknown"]);
const LOCATION_ROLES = new Set(["incident", "arrest", "agency", "mention", "impact_zone", "unknown"]);

const pairKey = (a, b) => [a, b].sort().join("|");

// 來源內容指紋：標題 + 摘要 + recordRef 任一變動 → 視為 evidence 改變，override 轉 needs_review。
// location_correction 記錄須用 withLocation（連 region/座標/精度/角色一起綁）——否則上游把地點修對後，
// 舊更正仍會被當 fresh 把正確值蓋回錯值。
export function curationFingerprint(event, { withLocation = false } = {}) {
  const basis = [
    event?.title || "",
    event?.summary || "",
    event?.source?.recordRef || event?.source?.url || "",
  ];
  if (withLocation) {
    basis.push(
      event?.region || "",
      event?.lat ?? "",
      event?.lng ?? "",
      event?.locationPrecision || "",
      event?.locationRole || "",
    );
  }
  return `sha256:${createHash("sha256").update(basis.join("\n"), "utf8").digest("hex")}`;
}

function validateRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return "not-an-object";
  if (record.v !== CURATION_SCHEMA_VERSION) return "unsupported-version";
  if (!CURATION_DECISIONS.has(record.decision)) return "unknown-decision";
  const ids = record.ids;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !id)) return "invalid-ids";
  if (ids.some((id) => id.includes("|"))) return "invalid-ids"; // pairKey 分隔符
  if (new Set(ids).size !== ids.length) return "invalid-ids"; // 自環 / 重複 id
  const expected = record.decision === "location_correction" ? 1 : 2;
  if (ids.length !== expected) return "invalid-ids-count";
  if (!record.fingerprints || typeof record.fingerprints !== "object" || Array.isArray(record.fingerprints)) {
    return "missing-fingerprints";
  }
  if (!ids.every((id) => typeof record.fingerprints[id] === "string" && record.fingerprints[id].startsWith("sha256:"))) {
    return "missing-fingerprints";
  }
  if (typeof record.reason !== "string" || !record.reason.trim()) return "missing-reason";
  if (typeof record.evidence !== "string" || !record.evidence.trim()) return "missing-evidence";
  if (typeof record.reviewedAt !== "string" || !Number.isFinite(Date.parse(record.reviewedAt))) return "invalid-reviewedAt";
  if (record.decision === "location_correction") {
    const loc = record.location;
    if (!loc || typeof loc !== "object" || Array.isArray(loc)) return "missing-location";
    const keys = Object.keys(loc);
    if (keys.length === 0 || keys.some((k) => !LOCATION_KEYS.has(k))) return "invalid-location";
    if (loc.region != null && (typeof loc.region !== "string" || !loc.region.trim())) return "invalid-location";
    if (loc.locationPrecision != null && !LOCATION_PRECISIONS.has(loc.locationPrecision)) return "invalid-location";
    if (loc.locationRole != null && !LOCATION_ROLES.has(loc.locationRole)) return "invalid-location";
    // lat/lng 必須成對且為有限合法範圍（單獨給一個會跟舊值拼成錯點）
    if ((loc.lat == null) !== (loc.lng == null)) return "invalid-location";
    if (loc.lat != null && !(Number.isFinite(loc.lat) && loc.lat >= -90 && loc.lat <= 90)) return "invalid-location";
    if (loc.lng != null && !(Number.isFinite(loc.lng) && loc.lng >= -180 && loc.lng <= 180)) return "invalid-location";
  }
  return null;
}

// 讀取 jsonl ledger；檔案不存在視為無更正（clean checkout 可用）。
// 壞行／不合法記錄收進 errors（附行號）——在 network.json 的 overrides.errors 可稽核，不靜默。
export function loadCurationLedger(path) {
  if (!existsSync(path)) return { records: [], errors: [] };
  const records = [];
  const errors = [];
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { records: [], errors: [{ line: 0, error: "unreadable-ledger" }] };
  }
  text.split(/\r?\n/).forEach((line, index) => {
    const raw = line.trim();
    if (!raw) return;
    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      errors.push({ line: index + 1, error: "invalid-json" });
      return;
    }
    const error = validateRecord(record);
    if (error) errors.push({ line: index + 1, error });
    else {
      record._line = index + 1; // 行號隨記錄進 report，稽核可溯源
      records.push(record);
    }
  });
  return { records, errors };
}

// 把 ledger 記錄對當前事件集解析成可重播的更正集合。
// 回傳 { patchedById, forbidden, forced, followUps, report }：
// - patchedById: Map<id, 淺拷貝且帶 location 更正的事件>
// - forbidden/forced: Set<pairKey>，correlateEvents 據此抑制／強制合併
// - report.applied/skipped/conflicts/errors 供 network.overrides 三層追溯
export function resolveCuration(records, events, errors = []) {
  const byId = new Map((events || []).filter((e) => e && e.id).map((e) => [e.id, e]));
  const forbidden = new Set();
  const forced = new Set();
  const followUps = [];
  const patchedById = new Map();
  const applied = [];
  const skipped = [];
  const conflicts = [];

  // 同 pair 出現不同 decision → conflict（fail closed：都不套用）；follow_up 兩個方向互斥也屬衝突。
  // 同 id 的 location_correction 內容不一致 → conflict。同 decision 同方向重複 → 去重。
  const pairGroups = new Map();
  const locationGroups = new Map();
  for (const record of records) {
    if (PAIR_DECISIONS.has(record.decision)) {
      const key = pairKey(record.ids[0], record.ids[1]);
      if (!pairGroups.has(key)) pairGroups.set(key, []);
      pairGroups.get(key).push(record);
    } else {
      const key = record.ids[0];
      if (!locationGroups.has(key)) locationGroups.set(key, []);
      locationGroups.get(key).push(record);
    }
  }

  const fresh = (record) => {
    const withLocation = record.decision === "location_correction";
    for (const id of record.ids) {
      const event = byId.get(id);
      if (!event) return { ok: false, reason: "event-not-found", detail: id };
      if (record.fingerprints?.[id] !== curationFingerprint(event, { withLocation })) {
        return { ok: false, reason: "evidence-changed", detail: id };
      }
    }
    return { ok: true };
  };

  const meta = (record) => ({ line: record._line, reviewedAt: record.reviewedAt });
  // 同 decision 群組：逐筆驗 fresh——採用第一筆新鮮記錄；stale 逐筆進 needs_review，
  // 其餘新鮮重複記為 superseded（不是問題但留痕）。
  const pickFresh = (group) => {
    let winner = null;
    for (const record of group) {
      const state = fresh(record);
      if (!state.ok) {
        skipped.push({ decision: record.decision, ids: record.ids, status: "needs_review", reason: state.reason, detail: state.detail, ...meta(record) });
      } else if (winner) {
        skipped.push({ decision: record.decision, ids: record.ids, status: "superseded", reason: "duplicate", ...meta(record) });
      } else {
        winner = record;
      }
    }
    return winner;
  };

  for (const [key, group] of pairGroups) {
    // 衝突判定：decision 不同；或同為 follow_up 但方向不同（[a→b] 與 [b→a] 互斥）
    const signatures = new Set(group.map((r) => (r.decision === "follow_up" ? `follow_up:${r.ids.join(">")}` : r.decision)));
    if (signatures.size > 1) {
      conflicts.push({ pair: key.split("|"), decisions: [...new Set(group.map((r) => r.decision))].sort(), lines: group.map((r) => r._line) });
      continue;
    }
    const record = pickFresh(group);
    if (!record) continue;
    if (record.decision === "not_same_event") forbidden.add(key);
    else if (record.decision === "same_event") forced.add(key);
    else {
      // follow_up 斷言「兩個不同事件」——同時抑制自動合併，並輸出方向性關係
      forbidden.add(key);
      followUps.push({ from: record.ids[0], to: record.ids[1], reason: record.reason, evidence: record.evidence, reviewedAt: record.reviewedAt });
    }
    applied.push({ decision: record.decision, ids: record.ids, ...meta(record) });
  }

  const normLocation = (loc) => JSON.stringify([loc.region, loc.lat, loc.lng, loc.locationPrecision, loc.locationRole]);
  for (const [id, group] of locationGroups) {
    const payloads = new Set(group.map((r) => normLocation(r.location)));
    if (payloads.size > 1) {
      conflicts.push({ pair: [id], decisions: ["location_correction"], lines: group.map((r) => r._line) });
      continue;
    }
    const record = pickFresh(group);
    if (!record) continue;
    const event = byId.get(id);
    const patch = record.location;
    patchedById.set(id, {
      ...event,
      ...(patch.region != null ? { region: patch.region } : {}),
      ...(patch.lat != null ? { lat: patch.lat, lng: patch.lng } : {}),
      ...(patch.locationPrecision != null ? { locationPrecision: patch.locationPrecision } : {}),
      ...(patch.locationRole != null ? { locationRole: patch.locationRole } : {}),
    });
    applied.push({ decision: record.decision, ids: record.ids, ...meta(record) });
  }

  return {
    patchedById,
    forbidden,
    forced,
    followUps,
    report: { applied, skipped, conflicts, errors },
  };
}

// 共享入口：build-network.mjs 與 fetch-live.mjs 都走這裡，避免兩條路徑各自實作而分歧。
// 輸入為已過濾的新聞事件（即實際送進 correlateEvents 的集合）；依事件歸屬把 ledger
// 記錄分桶到 domestic / international，跨 scope 的 pair 明確標 needs_review。
// 回傳：
// - domestic/international：套用 location_correction 後的事件陣列（原始物件不改寫）
// - corrections：{ domestic, international } —— 各自餵給 correlateEvents 的 opts.corrections
// - collectOverrides()：在 correlateEvents 跑完**之後**呼叫，回傳掛到 network.json 頂層的
//   稽核區段（correlate 會把被 not_same_event 間接擋下的 same_event 從 applied 移到 skipped）
export function curateNewsEvents(
  { domestic = [], international = [] } = {},
  { ledgerPath = process.env.CURATION_LEDGER_PATH || DEFAULT_LEDGER_PATH } = {},
) {
  const { records, errors } = loadCurationLedger(ledgerPath);
  const domesticIds = new Set(domestic.filter((e) => e && e.id).map((e) => e.id));
  const intlIds = new Set(international.filter((e) => e && e.id).map((e) => e.id));
  const allIds = new Set([...domesticIds, ...intlIds]);

  const domRecords = [];
  const intlRecords = [];
  const crossScopeSkipped = [];
  for (const record of records) {
    const everyIn = (set) => record.ids.every((id) => set.has(id));
    if (everyIn(domesticIds)) domRecords.push(record);
    else if (everyIn(intlIds)) intlRecords.push(record);
    else if (record.ids.every((id) => allIds.has(id))) {
      // 全部 id 都存在但橫跨兩個 scope —— correlateEvents 分 scope 跑，無法表達此 pair
      crossScopeSkipped.push({
        decision: record.decision,
        ids: record.ids,
        status: "needs_review",
        reason: "cross-scope",
      });
    } else if (record.ids.some((id) => domesticIds.has(id))) domRecords.push(record);
    else if (record.ids.some((id) => intlIds.has(id))) intlRecords.push(record);
    else domRecords.push(record); // 全部找不到 → 由 domestic 解析產生 event-not-found（只報一處）
  }

  const domesticResolution = resolveCuration(domRecords, domestic);
  const intlResolution = resolveCuration(intlRecords, international);
  const patch = (events, resolution) => events.map((e) => resolution.patchedById.get(e?.id) ?? e);
  const tag = (scope) => (list) => list.map((item) => ({ scope, ...item }));

  return {
    domestic: patch(domestic, domesticResolution),
    international: patch(international, intlResolution),
    corrections: { domestic: domesticResolution, international: intlResolution },
    // 延遲收集：correlateEvents 可能把被阻擋的 same_event 移出 applied（見 correlate.mjs）
    collectOverrides() {
      return {
        schemaVersion: CURATION_SCHEMA_VERSION,
        followUps: {
          domestic: domesticResolution.followUps,
          international: intlResolution.followUps,
        },
        report: {
          applied: [...tag("domestic")(domesticResolution.report.applied), ...tag("international")(intlResolution.report.applied)],
          skipped: [
            ...tag("domestic")(domesticResolution.report.skipped),
            ...tag("international")(intlResolution.report.skipped),
            ...crossScopeSkipped.map((item) => ({ scope: "cross", ...item })),
          ],
          conflicts: [...tag("domestic")(domesticResolution.report.conflicts), ...tag("international")(intlResolution.report.conflicts)],
          errors,
        },
      };
    },
  };
}

// 兩條 pipeline 路徑共用的可觀測出口：overrides 摘要進 console，有 needs_review/conflict/error 時 warn。
export function logCurationSummary(overrides) {
  const r = overrides?.report || {};
  const counts = `applied ${r.applied?.length || 0} / needs_review ${r.skipped?.filter((s) => s.status === "needs_review").length || 0} / conflicts ${r.conflicts?.length || 0} / errors ${r.errors?.length || 0}`;
  if ((r.skipped || []).some((s) => s.status === "needs_review") || r.conflicts?.length || r.errors?.length) {
    console.warn(`人工更正 ledger 注意：${counts}（詳見 network.json overrides.report）`);
  } else {
    console.log(`人工更正 ledger：${counts}`);
  }
}
