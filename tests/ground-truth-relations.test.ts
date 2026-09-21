import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import {
  RELATION_LABELS,
  LOCATION_ROLES,
  LOCATION_PRECISIONS,
  validatePairRow,
  validateLocationRow,
  assignSplit,
  enumerateCandidatePairs,
  computeRelationMetrics,
  computeLocationMetrics,
  diffBenchmarkReports,
} from "../scripts/lib/ground-truth-relations.mjs";
// @ts-expect-error — JS ESM module without types
import { correlateEvents } from "../scripts/lib/correlate.mjs";

function ev(over: Record<string, unknown> = {}): any {
  return {
    id: "x",
    title: "標題",
    region: "臺北市",
    timestamp: "2026-06-20T10:00:00+08:00",
    category: "治安",
    scope: "domestic",
    riskLevel: "medium",
    summary: "",
    source: { name: "中央社 社會", type: "news-rss", recordRef: "https://example.com/n1", fetchedAt: "2026-06-20T10:00:00+08:00" },
    ...over,
  };
}

// 會自動併群的一對（共享「鳳山分局」實體）
function mergeablePair(): [any, any] {
  return [
    ev({ id: "a", region: "高雄市", title: "鳳山分局破詐騙水房", source: { name: "來源A", type: "news-rss", recordRef: "https://example.com/a", fetchedAt: "" } }),
    ev({ id: "b", region: "臺南市", title: "鳳山分局協助查緝車手", timestamp: "2026-06-21T10:00:00+08:00", source: { name: "來源B", type: "news-rss", recordRef: "https://example.com/b", fetchedAt: "" } }),
  ];
}

function pairRow(over: Record<string, unknown> = {}) {
  return {
    schema: "relation-pairs/1",
    a: "a",
    b: "b",
    family: "fam-1",
    label: "same_event",
    evidence: "https://example.com/proof",
    labeledAt: "2026-09-17T00:00:00Z",
    labeledBy: "human",
    ...over,
  };
}

describe("validatePairRow / validateLocationRow", () => {
  it("合法 row 通過；缺欄位、未知 label、非 human 標註者被拒或標註", () => {
    expect(validatePairRow(pairRow())).toBeNull();
    expect(validatePairRow(pairRow({ label: "same_thing" }))).toBe("unknown-label");
    expect(validatePairRow(pairRow({ a: "" }))).toBe("invalid-pair");
    expect(validatePairRow(pairRow({ a: "b", b: "b" }))).toBe("invalid-pair"); // 自環
    expect(validatePairRow(pairRow({ family: "" }))).toBe("missing-family");
    expect(validatePairRow(pairRow({ evidence: "" }))).toBe("missing-evidence");
    expect(validatePairRow(pairRow({ labeledBy: "agent-draft" }))).toBeNull(); // 允許但下游可分開計
    expect(validatePairRow(pairRow({ labeledAt: "not-a-date" }))).toBe("invalid-labeledAt");
    expect(validatePairRow({ ...pairRow(), schema: "relation-pairs/0" })).toBe("unsupported-schema");
  });

  it("location row：role/precision 走 geo-policy 列舉，缺 evidence 被拒", () => {
    const row = {
      schema: "location-labels/1",
      event: "a",
      locationRole: "incident",
      locationPrecision: "exact",
      region: "高雄市",
      evidence: "https://example.com/p",
      labeledAt: "2026-09-17T00:00:00Z",
      labeledBy: "human",
    };
    expect(validateLocationRow(row)).toBeNull();
    expect(validateLocationRow({ ...row, locationRole: "somewhere" })).toBe("invalid-locationRole");
    expect(validateLocationRow({ ...row, locationPrecision: "approx" })).toBe("invalid-locationPrecision");
    expect(validateLocationRow({ ...row, evidence: "" })).toBe("missing-evidence");
    expect(LOCATION_ROLES.has("agency")).toBe(true);
    expect(LOCATION_PRECISIONS.has("county-center")).toBe(true);
  });
});

describe("assignSplit — family 隔離防洩漏", () => {
  it("同 family 的 pair 永遠落在同一 split", () => {
    const s1 = assignSplit("fam-x");
    const s2 = assignSplit("fam-x");
    expect(s1).toBe(s2);
    expect(["tuning", "holdout"]).toContain(s1);
  });
  it("不同 family 可能分到不同 split；分派 deterministic", () => {
    const splits = new Set(["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"].map(assignSplit));
    expect(assignSplit("f1")).toBe(assignSplit("f1"));
    expect(splits.size).toBe(2); // 足夠多的 family 會兩邊都有
  });
});

describe("enumerateCandidatePairs — 抽樣涵蓋未連線候選", () => {
  it("輸出含已連線邊與同區未連線 pair（false negative 來源）", () => {
    const [a, b] = mergeablePair();
    const c = ev({ id: "c", region: "高雄市", category: "交通", title: "國道一號事故", timestamp: "2026-06-20T11:00:00+08:00", source: { name: "來源C", type: "news-rss", recordRef: "https://example.com/c", fetchedAt: "" } });
    const pairs = enumerateCandidatePairs([a, b, c], correlateEvents([a, b, c]), { maxPairs: 50, seed: 7 });
    const key = (x: string, y: string) => [x, y].sort().join("|");
    const found = new Set(pairs.map((p: any) => key(p.a, p.b)));
    expect(found.has("a|b")).toBe(true); // 已連線 pair
    // a-c 同縣市但未連線 → 漏連候選應被枚舉
    expect(found.has("a|c")).toBe(true);
    // 每筆帶 family 與 autoRelation 標記
    const ab = pairs.find((p: any) => key(p.a, p.b) === "a|b");
    expect(ab.autoRelation).toBeTruthy();
    expect(typeof ab.family).toBe("string");
  });
});

describe("computeRelationMetrics", () => {
  it("same_event 命中 + different_event 被誤併 → P/R、falseMerge 各就各位", () => {
    // a,b,c 三事件兩兩共享「鳳山分局」→ 全併一群；d 無關
    const a = ev({ id: "a", region: "高雄市", title: "鳳山分局破詐騙水房", source: { name: "來源A", type: "news-rss", recordRef: "https://example.com/a", fetchedAt: "" } });
    const b = ev({ id: "b", region: "臺南市", title: "鳳山分局協助查緝車手", timestamp: "2026-06-21T10:00:00+08:00", source: { name: "來源B", type: "news-rss", recordRef: "https://example.com/b", fetchedAt: "" } });
    const c = ev({ id: "c", region: "嘉義縣", title: "鳳山分局事故後續追蹤", timestamp: "2026-06-21T11:00:00+08:00", source: { name: "來源C", type: "news-rss", recordRef: "https://example.com/c", fetchedAt: "" } });
    const d = ev({ id: "d", region: "花蓮縣", category: "交通", title: "國道追撞", timestamp: "2026-06-22T10:00:00+08:00", source: { name: "D", type: "news-rss", recordRef: "https://example.com/d", fetchedAt: "" } });
    const net = correlateEvents([a, b, c, d]);
    const rows = [
      pairRow({ a: "a", b: "b", label: "same_event" }),          // TP：真併群
      pairRow({ a: "a", b: "c", label: "different_event" }),     // FP：a-c 被併同群 → false merge
      pairRow({ a: "c", b: "d", label: "different_event" }),     // TN
      pairRow({ a: "c", b: "d", family: "fam-9", label: "uncertain" }), // 不計入分母
    ];
    const metrics = computeRelationMetrics(rows, net);
    expect(metrics.sameEvent.tp).toBe(1);
    expect(metrics.sameEvent.precision).toBeCloseTo(0.5); // a-b 對 + a-c 誤併 → 1/2
    expect(metrics.sameEvent.recall).toBe(1);
    expect(metrics.falseMerge.count).toBe(1);
    expect(metrics.uncertain).toBe(1);
    expect(metrics.evaluated).toBe(3); // uncertain 不計
  });

  it("follow_up label：有邊但未同群 = 命中；同群 = false merge；無邊 = missed relation", () => {
    const [a, b] = mergeablePair();
    const net = correlateEvents([a, b]);
    const same = computeRelationMetrics([pairRow({ label: "follow_up" })], net);
    expect(same.falseMerge.count).toBe(1); // follow_up 被併群 → false merge
    const c = ev({ id: "c", region: "屏東縣", title: "無關", source: { name: "C", type: "news-rss", recordRef: "https://x/c", fetchedAt: "" } });
    const net2 = correlateEvents([a, c]); // 無邊
    const missed = computeRelationMetrics([pairRow({ b: "c", label: "follow_up" })], net2);
    expect(missed.missedRelation.count).toBe(1);
  });
});

describe("computeLocationMetrics", () => {
  it("role/precision 準確率；unknown 標籤不計成錯誤也不計成成功", () => {
    const events = [
      ev({ id: "e1", locationRole: "incident", locationPrecision: "city", region: "高雄市" }),
      ev({ id: "e2", locationRole: "agency", locationPrecision: "exact", region: "臺北市" }),
    ];
    const labels = [
      { schema: "location-labels/1", event: "e1", locationRole: "incident", locationPrecision: "exact", region: "高雄市", evidence: "x", labeledAt: "2026-09-17T00:00:00Z", labeledBy: "human" },
      { schema: "location-labels/1", event: "e2", locationRole: "unknown", locationPrecision: "exact", region: "臺北市", evidence: "x", labeledAt: "2026-09-17T00:00:00Z", labeledBy: "human" },
    ];
    const m = computeLocationMetrics(labels, events);
    expect(m.role.correct).toBe(1); // e1 對、e2 unknown 不計
    expect(m.role.total).toBe(1);
    expect(m.precision.correct).toBe(1); // e2 precision 對、e1 city≠exact 錯
    expect(m.precision.total).toBe(2);
    expect(m.unknownRate).toBeCloseTo(0.5); // e2 role 是 unknown → 1/2
  });
});

describe("diffBenchmarkReports — before/after 可比較", () => {
  it("指出改善與退化方向", () => {
    const before = { relation: { sameEvent: { precision: 0.5, recall: 0.8 } } };
    const after = { relation: { sameEvent: { precision: 0.9, recall: 0.7 } } };
    const diff = diffBenchmarkReports(before, after);
    expect(diff.find((d: any) => d.metric === "relation.sameEvent.precision").direction).toBe("improved");
    expect(diff.find((d: any) => d.metric === "relation.sameEvent.recall").direction).toBe("regressed");
  });
});
