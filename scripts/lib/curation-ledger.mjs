// 人工更正 Ledger（curation ledger）：純解析／驗證函式 + JSONL 讀取。
// Pipeline：source data → normalize → 自動候選（correlate passes）→ correction ledger → final network。
// 設計原則：
//  - 版本化純文字（JSONL）走一般 code/data review，留下 git history；不引入資料庫或後台。
//  - 以穩定 report identity（event id，twnews-<hash(link)>／intl-<hash>）為鍵，不接受自由文字標題。
//  - 每筆帶 reviewedAt／rulesVersion／expect 指紋；identity 或關鍵欄位變動 → needs_review，fail closed。
//  - 相互矛盾的 override 全部標記 conflict 且不套用，絕不靜默 last-write-wins。
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { RULES_VERSION } from "./manifest.mjs";
import { EXACT_PRECISIONS, LOW_PRECISIONS, INCIDENT_ROLES, NON_INCIDENT_ROLES } from "./geo-policy.mjs";

export const LEDGER_SCHEMA_VERSION = 1;
// Ledger 屬於「隨程式碼版本審核」的資料，放 docs/（public/data 是 gitignore 的快照，不進 main）。
export const CURATED_LEDGER_REL_PATH = "docs/curation/correlation-overrides.jsonl";
export const FOLLOW_UP_EDGE_TYPE = "follow-up";

export const DECISIONS = new Set(["not_same_event", "same_event", "location_correction", "follow_up"]);
const PAIR_DECISIONS = new Set(["not_same_event", "same_event", "follow_up"]);
const BENCHMARK_TAGS = new Set(["none", "tuning", "holdout"]);
const LOCATION_PATCH_FIELDS = new Set(["region", "locationRole", "locationPrecision", "lat", "lng"]);
const LOCATION_ROLES = new Set([...INCIDENT_ROLES, ...NON_INCIDENT_ROLES]);
const LOCATION_PRECISIONS = new Set([...EXACT_PRECISIONS, ...LOW_PRECISIONS]);
const SUBJECT_RE = /^\S{1,200}$/;

// 來源版本指紋：對決策當下看到的關鍵欄位取 sha256。
// 涵蓋關聯與定位使用的證據；排除每次擷取都會變的 fetchedAt。
export function fingerprintEvent(event) {
  const canonical = JSON.stringify([
    event?.id || "",
    event?.scope || "",
    event?.source?.name || "",
    event?.source?.type || "",
    event?.source?.datasetId || "",
    event?.source?.recordRef || "",
    event?.source?.url || "",
    event?.source?.publisherName || "",
    event?.source?.publisherUrl || "",
    event?.title || "",
    event?.summary || "",
    event?.region || "",
    event?.timestamp || "",
    event?.category || "",
    event?.lat ?? null,
    event?.lng ?? null,
    event?.locationRole || "",
    event?.locationPrecision || "",
    event?.locationNote || "",
    event?.locationMethod || "",
    event?.locationSourceBasis || "",
    event?.aiTopic || "",
    Array.isArray(event?.aiEntities) ? [...new Set(event.aiEntities)].sort() : [],
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

// 事件 id 前綴 → 情報網 scope；無已知前綴回 null（交由各 scope 用實際存在性判定）。
function scopeOfId(id) {
  if (typeof id !== "string") return null;
  if (id.startsWith("twnews-")) return "domestic";
  if (id.startsWith("intl-")) return "international";
  return null;
}

// JSONL 文字 → entries（保留行號供審計）。空行與 # 註解略過；壞行記為 error entry。
export function parseLedgerText(text) {
  const entries = [];
  const errors = [];
  String(text || "")
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = i + 1;
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      try {
        entries.push({ line, record: JSON.parse(trimmed) });
      } catch (e) {
        entries.push({ line, error: `json_parse_error: ${e.message}` });
      }
    });
  return { entries, errors };
}

// 讀取 ledger 檔；檔案不存在 = 空 ledger（可選檔），不 throw。
export function loadCurationLedger(filePath) {
  if (!existsSync(filePath)) return { exists: false, entries: [], errors: [], path: filePath };
  try {
    const { entries, errors } = parseLedgerText(readFileSync(filePath, "utf8"));
    return { exists: true, entries, errors, path: filePath };
  } catch (e) {
    return { exists: true, entries: [{ line: 0, error: `read_error: ${e.message}` }], errors: [e.message], path: filePath };
  }
}

// 接受 records[]、entries[] 或 loadCurationLedger 回傳物件，正規化為 entries[]。
function normalizeEntries(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((item) =>
      item && typeof item === "object" && ("record" in item || "error" in item) ? item : { line: null, record: item },
    );
  }
  if (Array.isArray(input.entries)) return input.entries;
  if (Array.isArray(input.records)) return input.records.map((record) => ({ line: null, record }));
  return [];
}

function invalid(note) {
  return { ok: false, status: "invalid", note };
}

// 單筆記錄的靜態驗證（不看事件資料）。回傳 { ok, status, note } 或 { ok:true, record }。
function validateRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return invalid("not_an_object");
  if (record.schemaVersion !== LEDGER_SCHEMA_VERSION) return invalid("schema_version");
  if (typeof record.id !== "string" || !record.id.trim()) return invalid("id");
  if (!DECISIONS.has(record.decision)) return invalid("decision");
  const subjects = record.subjects;
  if (!Array.isArray(subjects)) return invalid("subjects");
  const want = record.decision === "location_correction" ? 1 : 2;
  if (subjects.length !== want || new Set(subjects).size !== subjects.length) return invalid("subjects");
  // 治理：自由文字標題不得作為永久唯一鍵——subject 必須是單一無空白 id token。
  if (subjects.some((s) => typeof s !== "string" || !SUBJECT_RE.test(s))) return invalid("subject_identity");
  const expect = record.expect;
  if (!expect || typeof expect !== "object" || Array.isArray(expect)) return invalid("expect");
  const expectKeys = Object.keys(expect);
  if (expectKeys.length !== subjects.length || subjects.some((s) => !(s in expect))) return invalid("expect");
  if (expectKeys.some((k) => typeof expect[k] !== "string" || !expect[k])) return invalid("expect");
  if (typeof record.reason !== "string" || !record.reason.trim()) return invalid("reason");
  if (typeof record.evidence !== "string" || !record.evidence.trim()) return invalid("evidence");
  if (!Number.isFinite(Date.parse(record.reviewedAt))) return invalid("reviewed_at");
  if (typeof record.rulesVersion !== "string" || !record.rulesVersion.trim()) return invalid("rules_version");
  if (record.benchmark !== undefined && !BENCHMARK_TAGS.has(record.benchmark)) return invalid("benchmark");
  if (record.decision === "location_correction") {
    const patch = record.patch;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return invalid("patch");
    const keys = Object.keys(patch);
    if (!keys.length || keys.some((k) => !LOCATION_PATCH_FIELDS.has(k))) return invalid("patch");
    if ("region" in patch && (typeof patch.region !== "string" || !patch.region.trim())) return invalid("patch");
    if ("locationRole" in patch && !LOCATION_ROLES.has(patch.locationRole)) return invalid("patch");
    if ("locationPrecision" in patch && !LOCATION_PRECISIONS.has(patch.locationPrecision)) return invalid("patch");
    if ("lat" in patch !== "lng" in patch) return invalid("patch");
    if ("lat" in patch) {
      const { lat, lng } = patch;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return invalid("patch");
      }
    }
  } else if (record.patch !== undefined) {
    return invalid("patch");
  }
  return { ok: true, record };
}

// 解析 ledger → 對目前 scope 的有效 overrides 與逐筆審計。
// scope：「domestic」或「international」；全數 subject 帶他域前綴的記錄不評估（out_of_scope）。
// 回傳：
//   blockedPairs   — not_same_event 需切除邊＋union cannot-link 的 pair 集合
//   sameEventPairs — same_event 需強制同案的 pair
//   followUps      — follow_up 有向邊（from = 較早報導 → to = 後續）
//   locationPatches— Map<eventId, {patch, recordId}>，只作用於衍生層（不改原始資料）
//   decisions      — 逐筆 {id, line, decision, subjects, status, note}（檔案順序，deterministic）
//   stats          — 計數摘要
export function resolveCurationLedger(input, events, { rulesVersion = RULES_VERSION, scope } = {}) {
  const entries = normalizeEntries(input);
  const eventsById = new Map((events || []).filter((e) => e && e.id).map((e) => [e.id, e]));
  const effectiveScope = scope || (events || []).find((e) => e && e.scope)?.scope || "domestic";

  const decisions = [];
  const stats = { entries: 0, applied: 0, needsReview: 0, conflicts: 0, invalid: 0, outOfScope: 0 };
  const candidates = [];

  for (const entry of entries) {
    stats.entries++;
    const audit = {
      id: typeof entry?.record?.id === "string" ? entry.record.id : null,
      line: entry?.line ?? null,
      decision: typeof entry?.record?.decision === "string" ? entry.record.decision : null,
      subjects: Array.isArray(entry?.record?.subjects) ? [...entry.record.subjects] : null,
      status: "invalid",
      note: null,
    };
    if (entry.error) {
      audit.note = "json_parse_error";
      decisions.push(audit);
      stats.invalid++;
      continue;
    }
    const record = entry.record;
    const subjectScopes = (Array.isArray(record?.subjects) ? record.subjects : []).map(scopeOfId);
    // 全數 subject 帶「另一個 scope」前綴 → 不屬於本 scope 的評估範圍（由對方 scope 記錄）。
    if (subjectScopes.length && subjectScopes.every((s) => s !== null && s !== effectiveScope)) {
      stats.outOfScope++;
      continue;
    }
    const v = validateRecord(record);
    if (!v.ok) {
      audit.status = "invalid";
      audit.note = v.note;
      decisions.push(audit);
      stats.invalid++;
      continue;
    }
    audit.id = record.id;
    audit.decision = record.decision;
    audit.subjects = [...record.subjects];
    if (record.rulesVersion !== rulesVersion) {
      audit.status = "needs_review";
      audit.note = "rules_version_mismatch";
      decisions.push(audit);
      stats.needsReview++;
      continue;
    }
    if (record.subjects.some((s) => !eventsById.has(s))) {
      audit.status = "needs_review";
      audit.note = "subject_not_found";
      decisions.push(audit);
      stats.needsReview++;
      continue;
    }
    if (record.subjects.some((s) => fingerprintEvent(eventsById.get(s)) !== record.expect[s])) {
      audit.status = "needs_review";
      audit.note = "fingerprint_mismatch";
      decisions.push(audit);
      stats.needsReview++;
      continue;
    }
    audit.status = "applied";
    audit.note = null;
    decisions.push(audit);
    stats.applied++;
    candidates.push({ audit, record });
  }

  // ── 衝突偵測（fail closed：同 pair／同主體矛盾記錄全部標 conflict，一律不套用）──
  const pairGroups = new Map(); // unordered pair key → candidate list
  const locationGroups = new Map(); // subject → candidate list
  for (const cand of candidates) {
    const { record } = cand;
    if (PAIR_DECISIONS.has(record.decision)) {
      const [a, b] = [...record.subjects].sort();
      const key = `${a}|${b}`;
      if (!pairGroups.has(key)) pairGroups.set(key, []);
      pairGroups.get(key).push(cand);
    } else {
      const key = record.subjects[0];
      if (!locationGroups.has(key)) locationGroups.set(key, []);
      locationGroups.get(key).push(cand);
    }
  }

  const conflicting = new Set();
  for (const group of pairGroups.values()) {
    if (group.length < 2) continue;
    const kinds = new Set(group.map((c) => c.record.decision));
    const followUpDirs = new Set(
      group.filter((c) => c.record.decision === "follow_up").map((c) => c.record.subjects.join("→")),
    );
    // same_event 與任何其他決策互斥；follow_up 方向相反互斥；其餘組合相容。
    const isConflict = (kinds.has("same_event") && kinds.size > 1) || followUpDirs.size > 1;
    if (isConflict) for (const c of group) conflicting.add(c);
  }
  for (const group of locationGroups.values()) {
    if (group.length < 2) continue;
    const first = group[0].record.patch;
    if (group.some((c) => !isDeepStrictEqual(c.record.patch, first))) {
      for (const c of group) conflicting.add(c);
    }
  }
  // 同案具傳遞性：A=B、B=C 若碰到 A≠C（或 A→C 續報），整個人工同案分量拒絕套用。
  const sameParent = new Map([...eventsById.keys()].map((id) => [id, id]));
  const sameRoot = (id) => {
    while (sameParent.get(id) !== id) {
      sameParent.set(id, sameParent.get(sameParent.get(id)));
      id = sameParent.get(id);
    }
    return id;
  };
  const sameCandidates = candidates.filter((c) => c.record.decision === "same_event");
  for (const { record } of sameCandidates) {
    const [a, b] = record.subjects.map(sameRoot);
    if (a !== b) sameParent.set(a, b);
  }
  const conflictRoots = new Set();
  for (const c of candidates) {
    if (!["not_same_event", "follow_up"].includes(c.record.decision)) continue;
    const [a, b] = c.record.subjects.map(sameRoot);
    if (a === b) {
      conflicting.add(c);
      conflictRoots.add(a);
    }
  }
  for (const c of sameCandidates) {
    if (conflictRoots.has(sameRoot(c.record.subjects[0]))) conflicting.add(c);
  }
  for (const c of conflicting) {
    if (c.audit.status === "applied") {
      c.audit.status = "conflict";
      c.audit.note = "conflicting_overrides";
      stats.applied--;
      stats.conflicts++;
    }
  }

  // ── 有效 overrides（每個同義鍵取第一筆；順序 = 檔案順序，deterministic）──
  const blockedPairs = [];
  const sameEventPairs = [];
  const followUps = [];
  const locationPatches = new Map();
  const seenPair = new Set();
  const seenFollowUp = new Set();
  for (const cand of candidates) {
    if (conflicting.has(cand)) continue;
    const { audit, record } = cand;
    if (audit.status !== "applied") continue;
    if (record.decision === "not_same_event") {
      const [a, b] = [...record.subjects].sort();
      const key = `${a}|${b}`;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      blockedPairs.push({ a, b, ids: [record.id] });
    } else if (record.decision === "same_event") {
      const [a, b] = [...record.subjects].sort();
      const key = `${a}|${b}`;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      sameEventPairs.push({ a, b, recordId: record.id, reason: record.reason });
    } else if (record.decision === "follow_up") {
      const [from, to] = record.subjects;
      const key = `${from}→${to}`;
      if (seenFollowUp.has(key)) continue;
      seenFollowUp.add(key);
      followUps.push({ from, to, recordId: record.id, reason: record.reason });
    } else if (record.decision === "location_correction") {
      const id = record.subjects[0];
      if (locationPatches.has(id)) continue;
      locationPatches.set(id, { patch: { ...record.patch }, recordId: record.id });
    }
  }

  return { blockedPairs, sameEventPairs, followUps, locationPatches, decisions, stats };
}

// #43 benchmark 介面：回傳明確標記 benchmark=tuning/holdout 的 pair 決策；
// 預設 benchmark=none → 不自動當 holdout（人工更正 ≠ 免費 holdout，需逐筆核准）。
export function ledgerBenchmarkEvidence(input) {
  return normalizeEntries(input)
    .filter(
      (e) =>
        e.record &&
        Array.isArray(e.record.subjects) &&
        BENCHMARK_TAGS.has(e.record.benchmark) &&
        e.record.benchmark !== "none",
    )
    .map((e) => ({
      id: e.record.id,
      decision: e.record.decision,
      subjects: [...e.record.subjects],
      benchmark: e.record.benchmark,
    }));
}
