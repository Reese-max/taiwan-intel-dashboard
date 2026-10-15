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
import { extractSignals, isLocalPlace } from "./correlate.mjs";

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
  if (row.labeledBy !== "human" && row.labeledBy !== "agent-draft") return "invalid-labeledBy";
  if (row.labeledBy === "human" && row.label !== "uncertain") {
    if (typeof row.familyA !== "string" || !row.familyA.trim() || typeof row.familyB !== "string" || !row.familyB.trim()) return "missing-endpoint-family";
    if (RELATED_LABELS.has(row.label) && row.familyA !== row.familyB) return "related-family-mismatch";
  }
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
  if (row.labeledBy !== "human" && row.labeledBy !== "agent-draft") return "invalid-labeledBy";
  if (row.labeledBy === "human" && (typeof row.region !== "string" || !row.region.trim())) return "missing-region";
  if (row.region != null && (typeof row.region !== "string" || !row.region.trim())) return "invalid-region";
  if (typeof row.evidence !== "string" || !row.evidence.trim()) return "missing-evidence";
  if (typeof row.labeledAt !== "string" || !Number.isFinite(Date.parse(row.labeledAt))) return "invalid-labeledAt";
  return null;
}

// 解析 jsonl 標註檔：合法進 rows；空 relation/location 標籤進 unlabeled（待人工填，不算錯）；
// 不合法進 errors（附行號，不靜默）。
export function loadLabeledJsonl(text, validate) {
  const rows = [];
  const unlabeled = [];
  const errors = [];
  const seen = new Map();
  const accept = (row, line, bucket) => {
    const identity = row.schema === PAIR_SCHEMA
      ? JSON.stringify([PAIR_SCHEMA, ...[row.a, row.b].sort()])
      : JSON.stringify([LOCATION_SCHEMA, row.event]);
    const firstLine = seen.get(identity);
    if (firstLine !== undefined) throw new Error(`Duplicate annotation identity at line ${line} (first line ${firstLine})`);
    seen.set(identity, line);
    row._line = line;
    bucket.push(row);
  };
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
      if (row && (row.label === "" || (row.schema === LOCATION_SCHEMA && row.locationRole === ""))) {
        // 未標註候選只驗 identity；endpoint family 與 location 判斷須由人工核對後填入。
        const structural = row.schema === PAIR_SCHEMA
          ? typeof row.a !== "string" || !row.a || typeof row.b !== "string" || !row.b || row.a === row.b
            ? "invalid-pair"
            : null
          : row.schema === LOCATION_SCHEMA
            ? typeof row.event !== "string" || !row.event
              ? "invalid-event"
              : null
            : "unsupported-schema";
        if (structural) errors.push({ line: index + 1, error: structural });
        else accept(row, index + 1, unlabeled);
        return;
      }
      const error = validate(row);
      if (error) errors.push({ line: index + 1, error });
      else accept(row, index + 1, rows);
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
  const push = (a, b, autoRelation, source, matchedEntity = null) => {
    if (a === b || !byId.has(a) || !byId.has(b)) return;
    const key = pairKeyOf(a, b);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      schema: PAIR_SCHEMA,
      a,
      b,
      familyA: "",
      familyB: "",
      suggestedFamilyA: familyOf(a),
      suggestedFamilyB: familyOf(b),
      autoRelation,
      candidateSource: source,
      ...(matchedEntity ? { matchedEntity } : {}),
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

  // 不同縣市同名道路/車站等，是區域消歧的 hard negative 候選，絕不直接建關聯。
  // 沿用 correlation 的實體抽取，但每個實體最多 24 事件、最多 100 個實體以界定成本。
  const vagueRegions = new Set(["全國", "未知", "", "—", "-", "全球", "國際", "海外", "臺灣", "台灣"]);
  const byLocalEntity = new Map();
  for (const event of byId.values()) {
    const signals = extractSignals(event);
    if (vagueRegions.has(signals.region)) continue;
    for (const entity of signals.entities) {
      if (!isLocalPlace(entity)) continue;
      if (!byLocalEntity.has(entity)) byLocalEntity.set(entity, []);
      byLocalEntity.get(entity).push({ id: event.id, region: signals.region });
    }
  }
  const entityScore = (entity) => hashString(`${seed}|${entity}`);
  const entityNames = [...byLocalEntity.keys()].sort((a, b) => entityScore(a) - entityScore(b) || a.localeCompare(b)).slice(0, 100);
  for (const entity of entityNames) {
    const group = byLocalEntity.get(entity)
      .sort((a, b) => hashString(`${seed}|${entity}|${a.id}`) - hashString(`${seed}|${entity}|${b.id}`) || a.id.localeCompare(b.id))
      .slice(0, 24);
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        if (group[i].region !== group[j].region) push(group[i].id, group[j].id, null, "cross-region-local-entity", entity);
      }
    }
  }

  // deterministic 抽樣：seed+pair key 打分散值後排序截斷；auto-edge/cluster 候選優先保留一半額度
  const scored = out.map((row) => ({
    row,
    score: hashString(`${seed}|${pairKeyOf(row.a, row.b)}`),
  }));
  scored.sort((x, y) => x.score - y.score || (pairKeyOf(x.row.a, x.row.b) < pairKeyOf(y.row.a, y.row.b) ? -1 : 1));
  const auto = scored.filter((s) => s.row.candidateSource === "auto-edge" || s.row.candidateSource === "auto-cluster");
  const sameRegion = scored.filter((s) => s.row.candidateSource === "same-region-unlinked");
  const crossRegion = scored.filter((s) => s.row.candidateSource === "cross-region-local-entity");
  const autoTake = Math.min(auto.length, Math.ceil(maxPairs / 2));
  const crossTake = Math.min(crossRegion.length, Math.ceil((maxPairs - autoTake) / 2));
  const selected = [...auto.slice(0, autoTake), ...crossRegion.slice(0, crossTake)];
  const remaining = [...sameRegion, ...auto.slice(autoTake), ...crossRegion.slice(crossTake)]
    .sort((a, b) => a.score - b.score || pairKeyOf(a.row.a, a.row.b).localeCompare(pairKeyOf(b.row.a, b.row.b)));
  return [...selected, ...remaining.slice(0, Math.max(0, maxPairs - selected.length))].map((s) => s.row);
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
      } else {
        // 每筆正確分開的 different_event/follow_up 都是 false-merge 分母。
        tn += 1;
        if (row.label === "follow_up" && !hasLink) {
          missed += 1;
          examples.missedRelations.push(pairKeyOf(row.a, row.b));
        }
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

// 已確認相關的 pair 若共享事件，必須使用同一人工核對的故事族群。
// sampler 的 suggestedFamily 是系統推測，不能作為 holdout/tuning 分割依據。
function assertHumanFamilies(rows) {
  const familyByEvent = new Map();
  for (const row of rows) {
    const families = [row.familyA, row.familyB];
    if (row.label === "uncertain" && families.some((family) => typeof family !== "string" || !family.trim())) continue;
    if (families.some((family) => typeof family !== "string" || !family.trim())) {
      throw new Error(`Missing human endpoint families for ${pairKeyOf(row.a, row.b)}`);
    }
    if (RELATED_LABELS.has(row.label) && row.familyA !== row.familyB) {
      throw new Error(`Related pair has conflicting story families: ${pairKeyOf(row.a, row.b)}`);
    }
    for (const [id, family] of [[row.a, row.familyA], [row.b, row.familyB]]) {
      const existing = familyByEvent.get(id);
      if (existing && existing !== family) {
        throw new Error(`Conflicting human story families for event ${id}: ${existing} / ${family}`);
      }
      familyByEvent.set(id, family);
    }
  }
}

// split 同時看兩端的人工 family；跨 split 的 negative 只進全體 metrics，不洩漏到任一側。
export function computeRelationMetrics(rows, net) {
  const labeled = (rows || []).filter((r) => r?.labeledBy === "human" && RELATION_LABELS.has(r.label));
  const validIds = new Set((net?.nodes || []).map((node) => node.id));
  for (const row of labeled) {
    for (const id of [row.a, row.b]) {
      if (!validIds.has(id)) throw new Error(`Pair references event ${id} absent from benchmark snapshot`);
    }
  }
  assertHumanFamilies(labeled);
  const splitFor = (row) => {
    if (!row.familyA || !row.familyB) return null;
    const a = assignSplit(row.familyA);
    return a === assignSplit(row.familyB) ? a : null;
  };
  const tuning = labeled.filter((r) => splitFor(r) === "tuning");
  const holdout = labeled.filter((r) => splitFor(r) === "holdout");
  return {
    ...relationMetricsFor(labeled, net),
    draftsExcluded: (rows || []).filter((r) => r?.labeledBy !== "human").length,
    crossSplitExcluded: labeled.filter((r) => r.label !== "uncertain" && splitFor(r) === null).length,
    uncertainUnassigned: labeled.filter((r) => r.label === "uncertain" && splitFor(r) === null).length,
    splits: { tuning: relationMetricsFor(tuning, net), holdout: relationMetricsFor(holdout, net) },
  };
}

export function computeLocationMetrics(rows, events) {
  const humanRows = (rows || []).filter((r) => r?.labeledBy === "human");
  const byId = new Map((events || []).filter((e) => e && e.id).map((e) => [e.id, e]));
  for (const row of humanRows) {
    if (!byId.has(row.event)) throw new Error(`Location references event ${row.event} absent from benchmark snapshot`);
  }
  const acc = () => ({ correct: 0, total: 0 });
  const role = acc();
  const precision = acc();
  const region = acc();
  let unknown = 0;
  for (const row of humanRows) {
    const event = byId.get(row.event);
    const isUnknown = row.locationRole === "unknown" || row.locationPrecision === "unknown" || row.region === "unknown";
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
    if (row.region && row.region !== "unknown") {
      region.total += 1;
      if (event.region === row.region) region.correct += 1;
    }
  }
  const rate = (x) => (x.total ? x.correct / x.total : null);
  return {
    labeled: humanRows.length,
    draftsExcluded: (rows || []).length - humanRows.length,
    missingEvent: 0,
    role: { ...role, accuracy: rate(role) },
    precision: { ...precision, accuracy: rate(precision) },
    region: { ...region, accuracy: rate(region) },
    unknownRate: humanRows.length ? unknown / humanRows.length : null,
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
