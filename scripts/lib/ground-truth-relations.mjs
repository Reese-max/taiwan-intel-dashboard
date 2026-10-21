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

import { EXACT_PRECISIONS, LOW_PRECISIONS, INCIDENT_ROLES, NON_INCIDENT_ROLES } from "./geo-policy.mjs";
import { extractSignals } from "./correlate.mjs";
import { titleKey } from "./title-key.mjs";

export const PAIR_SCHEMA = "relation-pairs/1";
export const LOCATION_SCHEMA = "location-labels/1";
export const RELATION_LABELS = new Set(["same_event", "different_event", "follow_up", "same_original_report", "uncertain"]);
export const LABEL_SOURCES = new Set(["human", "agent-draft"]);
// 與 geo-policy.mjs 列舉對齊
export const LOCATION_ROLES = new Set([...INCIDENT_ROLES, ...NON_INCIDENT_ROLES]);
export const LOCATION_PRECISIONS = new Set([...EXACT_PRECISIONS, ...LOW_PRECISIONS]);
export const SPLITS = ["tuning", "holdout"];

const SAME_LABELS = new Set(["same_event", "same_original_report"]);
const NOT_SAME_LABELS = new Set(["different_event", "follow_up"]);

export const pairKeyOf = (a, b) => [a, b].sort().join("|");

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
  if (!LABEL_SOURCES.has(row.labeledBy)) return "invalid-labeledBy";
  if (row.benchmark !== undefined && !SPLITS.includes(row.benchmark)) return "invalid-split";
  return null;
}

export function validateLocationRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return "not-an-object";
  if (row.schema !== LOCATION_SCHEMA) return "unsupported-schema";
  if (typeof row.event !== "string" || !row.event) return "invalid-event";
  if (typeof row.family !== "string" || !row.family.trim()) return "missing-family";
  if (!LOCATION_ROLES.has(row.locationRole)) return "invalid-locationRole";
  if (!LOCATION_PRECISIONS.has(row.locationPrecision)) return "invalid-locationPrecision";
  if (typeof row.region !== "string" || !row.region.trim()) return "invalid-region";
  if (typeof row.evidence !== "string" || !row.evidence.trim()) return "missing-evidence";
  if (typeof row.labeledAt !== "string" || !Number.isFinite(Date.parse(row.labeledAt))) return "invalid-labeledAt";
  if (!LABEL_SOURCES.has(row.labeledBy)) return "invalid-labeledBy";
  if (row.benchmark !== undefined && !SPLITS.includes(row.benchmark)) return "invalid-split";
  return null;
}

// 解析 jsonl 標註檔：合法進 rows；`label===""` 的 pair 候選進 unlabeled（待人工填，
// 不算錯）；不合法進 errors（附行號，不靜默）。`keyOf` 提供時，重複鍵的標註列
// 記為 duplicate-key 而非靜默重複計入指標。
export function loadLabeledJsonl(text, validate, keyOf) {
  const rows = [];
  const unlabeled = [];
  const errors = [];
  const seenKeys = new Set();
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
      if (validate === validatePairRow && row && row.label === "" && row.schema === PAIR_SCHEMA) {
        // 未標註 pair 候選：只驗結構（a/b/family），其餘欄位待人填
        const structural =
          typeof row.a !== "string" || !row.a || typeof row.b !== "string" || !row.b || row.a === row.b
            ? "invalid-pair"
            : typeof row.family !== "string" || !row.family.trim()
              ? "missing-family"
              : row.benchmark !== undefined && !SPLITS.includes(row.benchmark)
                ? "invalid-split"
                : null;
        if (structural) errors.push({ line: index + 1, error: structural });
        else {
          row._line = index + 1;
          unlabeled.push(row);
        }
        return;
      }
      const error = validate(row);
      if (error) {
        errors.push({ line: index + 1, error });
        return;
      }
      const key = typeof keyOf === "function" ? keyOf(row) : null;
      if (key != null) {
        if (seenKeys.has(key)) {
          errors.push({ line: index + 1, error: "duplicate-key" });
          return;
        }
        seenKeys.add(key);
      }
      row._line = index + 1;
      rows.push(row);
    });
  return { rows, unlabeled, errors };
}

// ── tuning / holdout 切分 ────────────────────────────────────────────────────
// 依 family（故事族群）切分——同一案件的轉載／後續共享 family，不會分散到兩邊造成洩漏。
export function assignSplit(family) {
  return hashString(`gt-split-v1|${family}`) % 2 === 0 ? "tuning" : "holdout";
}

export const splitOf = (row) => row.benchmark ?? assignSplit(row.family);

// Conservative draft families: shared events, original URLs and existing families
// stay together. Humans must also merge separate reports of the same story.
export function groupCandidateFamilies(rows, events = []) {
  const parent = new Map();
  const find = (id) => {
    if (!parent.has(id)) parent.set(id, id);
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)));
    return parent.get(id);
  };
  const union = (a, b) => {
    const [ra, rb] = [find(a), find(b)].sort();
    parent.set(rb, ra);
  };
  const byFamily = new Map();
  for (const row of rows) {
    const ids = row.schema === LOCATION_SCHEMA ? [row.event] : [row.a, row.b];
    for (const id of ids) union(ids[0], id);
    if (row.family) {
      if (byFamily.has(row.family)) union(ids[0], byFamily.get(row.family));
      else byFamily.set(row.family, ids[0]);
    }
  }
  const bySource = new Map();
  for (const event of events) {
    if (!parent.has(event.id) || !event.source?.recordRef) continue;
    const key = event.source.recordRef;
    if (bySource.has(key)) union(event.id, bySource.get(key));
    else bySource.set(key, event.id);
  }
  return rows.map((row) => ({ ...row, family: `fam:${find(row.schema === LOCATION_SCHEMA ? row.event : row.a)}` }));
}

export function splitLeakageErrors(rows, events) {
  const byId = new Map(events.map((event) => [event.id, event]));
  const seen = new Map();
  const errors = [];
  for (const row of rows) {
    const split = splitOf(row);
    const ids = row.schema === LOCATION_SCHEMA ? [row.event] : [row.a, row.b];
    const keys = [`family:${row.family}`, ...ids.map((id) => `event:${id}`),
      ...ids.map((id) => byId.get(id)?.source?.recordRef).filter(Boolean).map((url) => `source:${url}`)];
    for (const key of keys) {
      const previous = seen.get(key);
      if (previous && previous.split !== split) {
        for (const entry of [previous.row, row]) {
          if (!errors.some((error) => error.row === entry)) errors.push({ row: entry, line: entry._line, error: "split-leakage" });
        }
      } else if (!previous) seen.set(key, { split, row });
    }
  }
  return errors;
}

// ── 候選 pair 枚舉（sampler 核心）────────────────────────────────────────────
// 不能只抽系統已連的關聯：已連邊（含 false merge 候選）＋ 同縣市未連線 pair
// （missed relation 候選）＋ 跨縣市共享實體 pair（hard negative 候選）。
// deterministic：同一 events+net+seed 產同一組。
export function enumerateCandidatePairs(events, net, { maxPairs = 200, seed = 43, windowHours = 72 } = {}) {
  const limit = Math.max(0, Math.floor(Number(maxPairs) || 0));
  const windowMs = Math.max(0, Number(windowHours) || 0) * 3600 * 1000;
  const byId = new Map((events || []).filter((e) => e && e.id).map((e) => [e.id, e]));

  const seen = new Set();
  const out = [];
  const push = (a, b, autoRelation, source) => {
    if (a === b || !byId.has(a) || !byId.has(b)) return;
    const key = pairKeyOf(a, b);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      schema: PAIR_SCHEMA,
      a,
      b,
      family: "",
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
  const tsOf = (e) => {
    const t = Date.parse(e?.timestamp || "");
    return Number.isFinite(t) ? t : null;
  };
  const signals = new Map([...byId.values()].map((event) => [event.id, extractSignals(event)]));
  // Probe missed relations outside the engine's recent same-region window.
  const probes = new Map();
  const addProbe = (source, key, event) => {
    if (!key) return;
    const groupKey = `${source}|${event.scope || "domestic"}|${key}`;
    if (!probes.has(groupKey)) probes.set(groupKey, { source, events: [] });
    probes.get(groupKey).events.push(event);
  };
  for (const event of byId.values()) {
    const signal = signals.get(event.id);
    addProbe("shared-report-unlinked", event.source?.recordRef, event);
    addProbe("shared-report-unlinked", titleKey(event.title || ""), event);
    addProbe("same-topic-unlinked", signal.aiTopic, event);
    for (const entity of signal.identityEntities) addProbe("cross-month-unlinked", entity, event);
  }
  for (const { source, events: group } of probes.values()) {
    const sorted = [...group].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (let i = 0; i < sorted.length; i += 1) {
      // ponytail: at most 400 peers per probe; indexed strata if corpora grow.
      for (let j = i + 1; j < Math.min(sorted.length, i + 401); j += 1) {
        const [a, b] = [sorted[i], sorted[j]];
        if (source === "cross-month-unlinked" && (tsOf(a) === null || tsOf(b) === null ||
          new Date(tsOf(a)).toISOString().slice(0, 7) === new Date(tsOf(b)).toISOString().slice(0, 7))) continue;
        push(a.id, b.id, null, source);
      }
    }
  }
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

  // (c) 跨縣市同名道路／處所 pair（hard negative 候選）。這些 pair 不應因
  // 共享地名就被當成同案，但若只抽系統已連邊便永遠量不到 false merge。
  const byPlace = new Map();
  for (const event of byId.values()) {
    const signal = signals.get(event.id);
    for (const place of [...signal.entities].filter((entity) => !signal.identityEntities.has(entity))) {
      if (!byPlace.has(place)) byPlace.set(place, []);
      byPlace.get(place).push(event);
    }
  }
  for (const group of byPlace.values()) {
    const sorted = [...group].sort((a, b) => (tsOf(a) ?? 0) - (tsOf(b) ?? 0) || String(a.id).localeCompare(String(b.id)));
    for (let i = 0; i < sorted.length; i += 1) {
      const ta = tsOf(sorted[i]);
      for (let j = i + 1; j < sorted.length; j += 1) {
        const tb = tsOf(sorted[j]);
        if (ta != null && tb != null && tb - ta > windowMs) break;
        if (sorted[i].region && sorted[j].region && sorted[i].region !== sorted[j].region) {
          push(sorted[i].id, sorted[j].id, null, "shared-place-unlinked");
        }
      }
    }
  }

  // deterministic 抽樣：seed+pair key 打分散值後排序截斷；auto-edge/cluster 候選優先保留一半額度
  const scored = out.map((row) => ({
    row,
    score: hashString(`${seed}|${pairKeyOf(row.a, row.b)}`),
  }));
  scored.sort((x, y) => x.score - y.score || (pairKeyOf(x.row.a, x.row.b) < pairKeyOf(y.row.a, y.row.b) ? -1 : 1));
  const auto = scored.filter((s) => s.row.candidateSource.startsWith("auto-"));
  const unlinked = scored.filter((s) => !s.row.candidateSource.startsWith("auto-"));
  const autoQuota = Math.ceil(limit / 2);
  const unlinkedQuota = limit - Math.min(auto.length, autoQuota);
  const representatives = [...new Set(unlinked.map((entry) => entry.row.candidateSource))]
    .map((source) => unlinked.find((entry) => entry.row.candidateSource === source));
  const selected = [...auto.slice(0, autoQuota), ...[...representatives, ...unlinked.filter((entry) => !representatives.includes(entry))].slice(0, unlinkedQuota)].map((s) => s.row);
  return groupCandidateFamilies(selected, events);
}

// ── metrics ──────────────────────────────────────────────────────────────────
// 預測映射：same cluster = 系統判同案；同群或 same-incident/follow-up 邊 = 有關係。
//   same_event / same_original_report：正確 = 同群；未同群 → FN
//   different_event：正確 = 不同群；同群 → false merge（FP）
//   follow_up：正確 = 有邊但未同群；同群 → false merge；無邊 → missed relation
//   uncertain：不計入分母，只計數
function relationMetricsFor(rows, net) {
  const clusterOf = new Map();
  for (const cluster of net?.clusters || []) {
    for (const id of cluster.members || []) clusterOf.set(id, cluster.id);
  }
  // Entity/topic clues do not prove that a same-event/follow-up relation was found.
  const edgeKeys = new Set((net?.edges || []).filter((edge) => ["same-incident", "follow-up"].includes(edge.type)).map((e) => pairKeyOf(e.a, e.b)));
  const clustered = (a, b) => clusterOf.has(a) && clusterOf.get(a) === clusterOf.get(b);
  const linked = (a, b) => clustered(a, b) || edgeKeys.has(pairKeyOf(a, b));

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let missed = 0;
  let relatedTotal = 0;
  let negativeTotal = 0;
  let uncertain = 0;
  let evaluated = 0;
  const examples = {
    falseMerges: [],
    sameEventFalseNegatives: [],
    missedRelations: [],
    falseMergeSources: [],
    sameEventFalseNegativeSources: [],
    missedRelationSources: [],
  };
  const sourceFor = (row) => ({
    pair: pairKeyOf(row.a, row.b),
    evidence: row.evidence,
    candidateSource: row.candidateSource ?? null,
  });

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
        examples.sameEventFalseNegatives.push(pairKeyOf(row.a, row.b));
        examples.sameEventFalseNegativeSources.push(sourceFor(row));
        if (!hasLink) {
          missed += 1;
          examples.missedRelations.push(pairKeyOf(row.a, row.b));
          examples.missedRelationSources.push(sourceFor(row));
        }
      }
    } else if (NOT_SAME_LABELS.has(row.label)) {
      negativeTotal += 1;
      if (row.label === "follow_up") relatedTotal += 1;
      if (same) {
        fp += 1;
        examples.falseMerges.push(pairKeyOf(row.a, row.b));
        examples.falseMergeSources.push(sourceFor(row));
      } else {
        tn += 1;
        if (row.label === "follow_up" && !hasLink) {
          missed += 1;
          examples.missedRelations.push(pairKeyOf(row.a, row.b));
          examples.missedRelationSources.push(sourceFor(row));
        }
      }
    }
  }

  return {
    evaluated,
    uncertain,
    uncertainRate: rows.length ? uncertain / rows.length : null,
    sameEvent: {
      tp,
      fp,
      fn,
      tn,
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
    },
    falseMerge: { count: fp, total: negativeTotal, rate: negativeTotal ? fp / negativeTotal : null },
    missedRelation: { count: missed, total: relatedTotal, rate: relatedTotal ? missed / relatedTotal : null },
    examples,
  };
}

// 每筆 row 需帶 family；split 由 family hash 決定（同 family 永遠同側）。
export function computeRelationMetrics(rows, net) {
  const candidates = (rows || []).filter((r) => r && r.label);
  const labeled = candidates.filter((r) => r.labeledBy === "human");
  const tuning = labeled.filter((r) => splitOf(r) === "tuning");
  const holdout = labeled.filter((r) => splitOf(r) === "holdout");
  return {
    ...relationMetricsFor(labeled, net),
    excludedNonHuman: candidates.length - labeled.length,
    splits: { tuning: relationMetricsFor(tuning, net), holdout: relationMetricsFor(holdout, net) },
  };
}

function locationMetricsFor(rows, events) {
  const byId = new Map((events || []).filter((e) => e && e.id).map((e) => [e.id, e]));
  const acc = () => ({ correct: 0, total: 0 });
  const role = acc();
  const precision = acc();
  const region = acc();
  let unknown = 0;
  let missing = 0;
  let labeled = 0;
  const examples = { roleErrors: [], precisionErrors: [], regionErrors: [] };
  const humanRows = (rows || []).filter((row) => row && row.labeledBy === "human");
  const excludedNonHuman = (rows || []).filter((row) => row && row.labeledBy && row.labeledBy !== "human").length;
  for (const row of humanRows) {
    const event = byId.get(row.event);
    if (!event) {
      missing += 1;
      continue;
    }
    labeled += 1;
    const known = (value) => typeof value === "string" && value.trim() && !["unknown", "未知"].includes(value);
    const isUnknown = !known(row.locationRole) || !known(row.locationPrecision) || !known(event.locationRole) || !known(event.locationPrecision);
    if (isUnknown) unknown += 1;
    // unknown 標籤表示「人工無法判定」——不計成錯誤也不計成成功
    if (known(row.locationRole) && known(event.locationRole)) {
      role.total += 1;
      if (event.locationRole === row.locationRole) role.correct += 1;
      else examples.roleErrors.push({ event: row.event, expected: row.locationRole, actual: event.locationRole, evidence: row.evidence });
    }
    if (known(row.locationPrecision) && known(event.locationPrecision)) {
      precision.total += 1;
      if (event.locationPrecision === row.locationPrecision) precision.correct += 1;
      else examples.precisionErrors.push({ event: row.event, expected: row.locationPrecision, actual: event.locationPrecision, evidence: row.evidence });
    }
    if (known(row.region) && known(event.region)) {
      region.total += 1;
      if (event.region === row.region) region.correct += 1;
      else examples.regionErrors.push({ event: row.event, expected: row.region, actual: event.region, evidence: row.evidence });
    }
  }
  const rate = (x) => (x.total ? x.correct / x.total : null);
  return {
    labeled,
    excludedNonHuman,
    missingEvent: missing,
    role: { ...role, accuracy: rate(role) },
    precision: { ...precision, accuracy: rate(precision) },
    region: { ...region, accuracy: rate(region) },
    unknownRate: labeled ? unknown / labeled : null,
    examples,
  };
}

export function computeLocationMetrics(rows, events) {
  return { ...locationMetricsFor(rows, events), splits: Object.fromEntries(SPLITS.map((split) =>
    [split, locationMetricsFor(rows.filter((row) => splitOf(row) === split), events)])) };
}

// ── before / after 比較 ──────────────────────────────────────────────────────
// 數值葉節點逐一比對；precision/recall/accuracy 愈高愈好，rate/count/錯誤類愈低愈好。
const HIGHER_BETTER = /\.(precision|recall|accuracy)$/;
// evaluated/uncertain/labeled 等覆蓋量指標不標方向——標更多不叫好也不叫壞。
const LOWER_BETTER = /\.(falseMerge|missedRelation)\.(count|rate)$|\.sameEvent\.(fp|fn)$/;

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
