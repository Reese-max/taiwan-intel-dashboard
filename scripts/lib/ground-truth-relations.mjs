// Ground-truth 關聯／地點 benchmark（issue #43）：schema 驗證、候選 pair 枚舉、
// tuning/holdout 切分、metrics 計算——全部純函式，供 CLI（ground-truth-relations-sample /
// ground-truth-benchmark）與測試共用。
//
// 資料檔（committed，固定 SHA 可重播）：
//   docs/ground-truth/relations/pairs-v1.jsonl     — pair 級關係標註
//   docs/ground-truth/relations/locations-v1.jsonl — 地點標註
//   docs/ground-truth/relations/events-v1.json     — 被引用事件的快照（僅 metadata，不存全文）
//
// 與 #44 的銜接：ledger 的 curated pair 可作標註來源之一，但 sampler 對其打
// `ledgerDecision` 標記並照常按 family 切分——不會全部沉到 holdout（report 分開計數）。

import { createHash } from "node:crypto";

export const PAIR_SCHEMA = "relation-pairs/1";
export const LOCATION_SCHEMA = "location-labels/1";
export const RELATION_LABELS = new Set(["same_event", "different_event", "follow_up", "same_original_report", "uncertain"]);
// 與 geo-policy.mjs 列舉對齊
export const LOCATION_ROLES = new Set(["incident", "arrest", "agency", "mention", "impact_zone", "unknown"]);
export const LOCATION_PRECISIONS = new Set(["exact", "address", "district", "city", "county-center", "country", "global", "unknown"]);
export const SPLITS = ["tuning", "holdout"];

const SAME_LABELS = new Set(["same_event", "same_original_report"]);
const NOT_SAME_LABELS = new Set(["different_event", "follow_up"]);
const RELATED_LABELS = new Set(["same_event", "same_original_report", "follow_up"]);

const pairKeyOf = (a, b) => [a, b].sort().join("|");

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// ── schema 驗證 ──────────────────────────────────────────────────────────────

export function validatePairRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return "not-an-object";
  if (row.schema !== PAIR_SCHEMA) return "unsupported-schema";
  if (typeof row.a !== "string" || !row.a || typeof row.b !== "string" || !row.b || row.a === row.b) return "invalid-pair";
  if (!RELATION_LABELS.has(row.label)) return "unknown-label";
  if (typeof row.family !== "string" || !row.family.trim()) return "missing-family";
  if (typeof row.evidence !== "string" || !row.evidence.trim()) return "missing-evidence";
  if (typeof row.labeledAt !== "string" || !Number.isFinite(Date.parse(row.labeledAt))) return "invalid-labeledAt";
  return null;
}

export function validateLocationRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return "not-an-object";
  if (row.schema !== LOCATION_SCHEMA) return "unsupported-schema";
  if (typeof row.event !== "string" || !row.event) return "invalid-event";
  if (!LOCATION_ROLES.has(row.locationRole)) return "invalid-locationRole";
  if (!LOCATION_PRECISIONS.has(row.locationPrecision)) return "invalid-locationPrecision";
  if (row.region != null && (typeof row.region !== "string" || !row.region.trim())) return "invalid-region";
  if (typeof row.evidence !== "string" || !row.evidence.trim()) return "missing-evidence";
  if (typeof row.labeledAt !== "string" || !Number.isFinite(Date.parse(row.labeledAt))) return "invalid-labeledAt";
  return null;
}

// 解析 jsonl 標註檔：合法進 rows；`label===""` 的候選進 unlabeled（待人工填，不算錯）；
// 不合法進 errors（附行號，不靜默）。
export function loadLabeledJsonl(text, validate) {
  const rows = [];
  const unlabeled = [];
  const errors = [];
  String(text || "")
    .split(/\r?\n/)
    .forEach((line, index) => {
      const raw = line.trim();
      if (!raw) return;
      let row;
      try {
        row = JSON.parse(raw);
      } catch {
        errors.push({ line: index + 1, error: "invalid-json" });
        return;
      }
      if (row && row.label === "") {
        // 未標註候選：只驗結構（schema/a/b/family），其餘欄位待人填
        const structural =
          !row || typeof row !== "object" || row.schema !== PAIR_SCHEMA
            ? "unsupported-schema"
            : typeof row.a !== "string" || !row.a || typeof row.b !== "string" || !row.b || row.a === row.b
              ? "invalid-pair"
              : typeof row.family !== "string" || !row.family.trim()
                ? "missing-family"
                : null;
        if (structural) errors.push({ line: index + 1, error: structural });
        else {
          row._line = index + 1;
          unlabeled.push(row);
        }
        return;
      }
      const error = validate(row);
      if (error) errors.push({ line: index + 1, error });
      else {
        row._line = index + 1;
        rows.push(row);
      }
    });
  return { rows, unlabeled, errors };
}

// ── tuning / holdout 切分 ────────────────────────────────────────────────────
// 依 family（故事族群）切分——同一案件的轉載／後續共享 family，不會分散到兩邊造成洩漏。
export function assignSplit(family) {
  return hashString(`gt-split-v1|${family}`) % 2 === 0 ? "tuning" : "holdout";
}

// ── 候選 pair 枚舉（sampler 核心）────────────────────────────────────────────
// 不能只抽系統已連的關聯：已連邊（含 false merge 候選）＋ 同縣市未連線 pair
// （missed relation 候選）＋ 跨縣市共享實體 pair（hard negative 候選）。
// deterministic：同一 events+net+seed 產同一組。
export function enumerateCandidatePairs(events, net, { maxPairs = 200, seed = 43, windowHours = 72 } = {}) {
  const byId = new Map((events || []).filter((e) => e && e.id).map((e) => [e.id, e]));
  const clusterOf = new Map();
  for (const cluster of net?.clusters || []) {
    for (const id of cluster.members || []) clusterOf.set(id, cluster.id);
  }
  const familyOf = (id) => clusterOf.get(id) || `single:${id}`;

  const seen = new Set();
  const out = [];
  const push = (a, b, autoRelation, source) => {
    if (a === b || !byId.has(a) || !byId.has(b)) return;
    const key = pairKeyOf(a, b);
    if (seen.has(key)) return;
    seen.add(key);
    const [fa, fb] = [familyOf(a), familyOf(b)].sort();
    out.push({
      schema: PAIR_SCHEMA,
      a,
      b,
      family: fa === fb ? fa : `${fa}+${fb}`,
      autoRelation,
      candidateSource: source,
      label: "",
      evidence: "",
      labeledAt: "",
      labeledBy: "",
      notes: "",
    });
  };

  // (a) 系統已連的邊
  for (const edge of net?.edges || []) push(edge.a, edge.b, edge.type, "auto-edge");
  // 同群但無直接邊（transitive merge 成員）——false merge 高風險區
  for (const cluster of net?.clusters || []) {
    const members = cluster.members || [];
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) push(members[i], members[j], "same-cluster", "auto-cluster");
    }
  }
  // (b) 同縣市未連線 pair（missed relation 候選）——漏連本來就該時間相近，
  // 限制 ±windowHours（預設 72h）避免 O(n²) 百萬級枚舉
  const windowMs = windowHours * 3600 * 1000;
  const tsOf = (e) => {
    const t = Date.parse(e?.timestamp || "");
    return Number.isFinite(t) ? t : null;
  };
  const byRegion = new Map();
  for (const e of byId.values()) {
    if (!e.region) continue;
    if (!byRegion.has(e.region)) byRegion.set(e.region, []);
    byRegion.get(e.region).push(e);
  }
  for (const group of byRegion.values()) {
    const sorted = [...group].sort((a, b) => (tsOf(a) ?? 0) - (tsOf(b) ?? 0));
    for (let i = 0; i < sorted.length; i += 1) {
      const ta = tsOf(sorted[i]);
      for (let j = i + 1; j < sorted.length; j += 1) {
        const tb = tsOf(sorted[j]);
        if (ta != null && tb != null && tb - ta > windowMs) break; // 已排序，超窗即停
        if (j - i > 400) break; // 無時間戳等極端情況的保底上限
        push(sorted[i].id, sorted[j].id, null, "same-region-unlinked");
      }
    }
  }

  // deterministic 抽樣：seed+pair key 打分散值後排序截斷；auto-edge/cluster 候選優先保留一半額度
  const scored = out.map((row) => ({
    row,
    score: hashString(`${seed}|${pairKeyOf(row.a, row.b)}`),
  }));
  scored.sort((x, y) => x.score - y.score || (pairKeyOf(x.row.a, x.row.b) < pairKeyOf(y.row.a, y.row.b) ? -1 : 1));
  const auto = scored.filter((s) => s.row.candidateSource !== "same-region-unlinked");
  const unlinked = scored.filter((s) => s.row.candidateSource === "same-region-unlinked");
  const autoQuota = Math.ceil(maxPairs / 2);
  return [...auto.slice(0, autoQuota), ...unlinked.slice(0, maxPairs - Math.min(auto.length, autoQuota))].map((s) => s.row);
}

// ── metrics ──────────────────────────────────────────────────────────────────
// 預測映射：same cluster = 系統判同案；有任何邊或同群 = 系統判有關係。
//   same_event / same_original_report：正確 = 同群；未同群 → FN
//   different_event：正確 = 不同群；同群 → false merge（FP）
//   follow_up：正確 = 有邊但未同群；同群 → false merge；無邊 → missed relation
//   uncertain：不計入分母，只計數
function relationMetricsFor(rows, net) {
  const clusterOf = new Map();
  for (const cluster of net?.clusters || []) {
    for (const id of cluster.members || []) clusterOf.set(id, cluster.id);
  }
  const edgeKeys = new Set((net?.edges || []).map((e) => pairKeyOf(e.a, e.b)));
  const clustered = (a, b) => clusterOf.has(a) && clusterOf.get(a) === clusterOf.get(b);
  const linked = (a, b) => clustered(a, b) || edgeKeys.has(pairKeyOf(a, b));

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let missed = 0;
  let relatedTotal = 0;
  let uncertain = 0;
  let evaluated = 0;
  const examples = { falseMerges: [], missedRelations: [] };

  for (const row of rows) {
    if (row.label === "uncertain") {
      uncertain += 1;
      continue;
    }
    evaluated += 1;
    const same = clustered(row.a, row.b);
    const hasLink = linked(row.a, row.b);
    if (SAME_LABELS.has(row.label)) {
      relatedTotal += 1;
      if (same) tp += 1;
      else {
        fn += 1;
        if (!hasLink) {
          missed += 1;
          examples.missedRelations.push(pairKeyOf(row.a, row.b));
        }
      }
    } else if (NOT_SAME_LABELS.has(row.label)) {
      if (row.label === "follow_up") relatedTotal += 1;
      if (same) {
        fp += 1;
        examples.falseMerges.push(pairKeyOf(row.a, row.b));
      } else if (row.label === "different_event") {
        tn += 1;
      } else if (hasLink) {
        // follow_up：有邊未同群 = 命中（不計 tp/fp/tn）
      } else {
        missed += 1;
        examples.missedRelations.push(pairKeyOf(row.a, row.b));
      }
    }
  }

  return {
    evaluated,
    uncertain,
    sameEvent: {
      tp,
      fp,
      fn,
      tn,
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
    },
    falseMerge: { count: fp, rate: fp + tn ? fp / (fp + tn) : null },
    missedRelation: { count: missed, rate: relatedTotal ? missed / relatedTotal : null },
    examples,
  };
}

// 每筆 row 需帶 family；split 由 family hash 決定（同 family 永遠同側）。
export function computeRelationMetrics(rows, net) {
  const labeled = (rows || []).filter((r) => r && r.label);
  const tuning = labeled.filter((r) => assignSplit(r.family) === "tuning");
  const holdout = labeled.filter((r) => assignSplit(r.family) === "holdout");
  return {
    ...relationMetricsFor(labeled, net),
    splits: { tuning: relationMetricsFor(tuning, net), holdout: relationMetricsFor(holdout, net) },
  };
}

export function computeLocationMetrics(rows, events) {
  const byId = new Map((events || []).filter((e) => e && e.id).map((e) => [e.id, e]));
  const acc = () => ({ correct: 0, total: 0 });
  const role = acc();
  const precision = acc();
  const region = acc();
  let unknown = 0;
  let missing = 0;
  for (const row of rows || []) {
    const event = byId.get(row.event);
    if (!event) {
      missing += 1;
      continue;
    }
    const isUnknown = row.locationRole === "unknown" || row.locationPrecision === "unknown";
    if (isUnknown) unknown += 1;
    // unknown 標籤表示「人工無法判定」——不計成錯誤也不計成成功
    if (row.locationRole !== "unknown") {
      role.total += 1;
      if (event.locationRole === row.locationRole) role.correct += 1;
    }
    if (row.locationPrecision !== "unknown") {
      precision.total += 1;
      if (event.locationPrecision === row.locationPrecision) precision.correct += 1;
    }
    if (row.region) {
      region.total += 1;
      if (event.region === row.region) region.correct += 1;
    }
  }
  const rate = (x) => (x.total ? x.correct / x.total : null);
  return {
    labeled: (rows || []).length,
    missingEvent: missing,
    role: { ...role, accuracy: rate(role) },
    precision: { ...precision, accuracy: rate(precision) },
    region: { ...region, accuracy: rate(region) },
    unknownRate: (rows || []).length ? unknown / rows.length : null,
  };
}

// ── before / after 比較 ──────────────────────────────────────────────────────
// 數值葉節點逐一比對；precision/recall/accuracy 愈高愈好，rate/count/錯誤類愈低愈好。
const HIGHER_BETTER = /precision|recall|accuracy|correct/i;
const LOWER_BETTER = /rate|count|fp|fn|missed|unknown|errors|evaluated|uncertain|missing/i;

export function diffBenchmarkReports(before, after) {
  const flatten = (obj, prefix = "", out = {}) => {
    for (const [k, v] of Object.entries(obj || {})) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
      else if (typeof v === "number" || v === null) out[key] = v;
    }
    return out;
  };
  const b = flatten(before);
  const a = flatten(after);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  return keys.map((metric) => {
    const bv = b[metric];
    const av = a[metric];
    let direction = "unchanged";
    if (typeof bv === "number" && typeof av === "number" && bv !== av) {
      const better = av > bv;
      if (HIGHER_BETTER.test(metric)) direction = better ? "improved" : "regressed";
      else if (LOWER_BETTER.test(metric)) direction = better ? "regressed" : "improved";
      else direction = "changed";
    } else if (bv !== av) {
      direction = "changed";
    }
    return { metric, before: bv ?? null, after: av ?? null, direction };
  });
}
