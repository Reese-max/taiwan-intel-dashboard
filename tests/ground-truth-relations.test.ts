import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without declaration files
import {
  LOCATION_PRECISIONS,
  LOCATION_ROLES,
  PAIR_SCHEMA,
  assignSplit,
  computeLocationMetrics,
  computeRelationMetrics,
  diffBenchmarkReports,
  enumerateCandidatePairs,
  loadLabeledJsonl,
  pairKeyOf,
  validateLocationRow,
  validatePairRow,
} from "../scripts/lib/ground-truth-relations.mjs";
// @ts-expect-error — JS ESM module without declaration files
import { SNAPSHOT_FIELDS } from "../scripts/ground-truth-relations-sample.mjs";

const pair = (over: Record<string, unknown> = {}) => ({
  schema: PAIR_SCHEMA,
  a: "a",
  b: "b",
  family: "family-a",
  label: "same_event",
  evidence: "https://example.test/story",
  labeledAt: "2026-09-17T00:00:00Z",
  labeledBy: "human",
  ...over,
});

const location = (over: Record<string, unknown> = {}) => ({
  schema: "location-labels/1",
  event: "a",
  locationRole: "incident",
  locationPrecision: "exact",
  region: "高雄市",
  evidence: "https://example.test/story#location",
  labeledAt: "2026-09-17T00:00:00Z",
  labeledBy: "human",
  ...over,
});

describe("ground-truth schema", () => {
  it("validates relation and location labels with evidence", () => {
    expect(validatePairRow(pair())).toBeNull();
    expect(validatePairRow(pair({ label: "uncertain" }))).toBeNull();
    expect(validatePairRow(pair({ labeledBy: "agent-draft" }))).toBeNull();
    expect(validatePairRow(pair({ labeledBy: "model" }))).toBe("invalid-labeledBy");
    expect(validatePairRow(pair({ evidence: "" }))).toBe("missing-evidence");
    expect(validatePairRow(pair({ label: "not-a-label" }))).toBe("unknown-label");
    expect(validateLocationRow(location())).toBeNull();
    expect(validateLocationRow(location({ locationRole: "office" }))).toBe("invalid-locationRole");
    expect(validateLocationRow(location({ locationPrecision: "approx" }))).toBe("invalid-locationPrecision");
    expect(LOCATION_ROLES.has("agency")).toBe(true);
    expect(LOCATION_PRECISIONS.has("county-center")).toBe(true);
  });
});

describe("ground-truth splits", () => {
  it("keeps every pair from one story family on one deterministic split", () => {
    expect(assignSplit("story-1")).toBe(assignSplit("story-1"));
    expect(["tuning", "holdout"]).toContain(assignSplit("story-1"));
    const splits = new Set(["story-1", "story-2", "story-3", "story-4", "story-5", "story-6"].map(assignSplit));
    expect(splits.size).toBe(2);
  });
});

describe("ground-truth relation metrics", () => {
  it("reports precision, recall, false merges, missed relations, and uncertain rows", () => {
    const net = {
      edges: [{ a: "a", b: "b", type: "same-incident" }],
      clusters: [{ id: "cluster-1", members: ["a", "b", "c"] }],
    };
    const result = computeRelationMetrics([
      pair({ a: "a", b: "b", label: "same_event" }),
      pair({ a: "a", b: "c", label: "different_event" }),
      pair({ a: "c", b: "d", label: "follow_up" }),
      pair({ a: "c", b: "d", label: "uncertain" }),
      pair({ a: "a", b: "d", label: "same_event", labeledBy: "agent-draft" }),
    ], net);

    expect(result.sameEvent.precision).toBe(0.5);
    expect(result.sameEvent.recall).toBe(1);
    expect(result.falseMerge.count).toBe(1);
    expect(result.falseMerge.total).toBe(2);
    expect(result.falseMerge.rate).toBe(0.5);
    expect(result.missedRelation.count).toBe(1);
    expect(result.uncertain).toBe(1);
    expect(result.examples.falseMerges).toContain("a|c");
    expect(result.examples.missedRelations).toContain("c|d");
    expect(result.splits.tuning.evaluated + result.splits.holdout.evaluated).toBe(3);
    expect(result.excludedNonHuman).toBe(1);
  });
});

describe("ground-truth location metrics", () => {
  it("does not count unknown labels as correct or incorrect", () => {
    const result = computeLocationMetrics(
      [
        location({ event: "a" }),
        location({ event: "b", locationRole: "unknown", locationPrecision: "unknown" }),
        location({ event: "a", labeledBy: "agent-draft" }),
      ],
      [
        { id: "a", locationRole: "incident", locationPrecision: "city", region: "高雄市" },
        { id: "b", locationRole: "agency", locationPrecision: "exact", region: "臺北市" },
      ],
    );

    expect(result.role).toEqual({ correct: 1, total: 1, accuracy: 1 });
    expect(result.precision).toEqual({ correct: 0, total: 1, accuracy: 0 });
    expect(result.unknownRate).toBe(0.5);
    expect(result.excludedNonHuman).toBe(1);
  });
});

describe("ground-truth report comparison", () => {
  it("labels before/after improvements and regressions", () => {
    const diff = diffBenchmarkReports(
      { relation: { sameEvent: { precision: 0.5, recall: 0.8 } } },
      { relation: { sameEvent: { precision: 0.9, recall: 0.7 } } },
    );
    expect(diff.find((item: any) => item.metric === "relation.sameEvent.precision")?.direction).toBe("improved");
    expect(diff.find((item: any) => item.metric === "relation.sameEvent.recall")?.direction).toBe("regressed");
  });

  it("marks coverage growth as changed, not regressed", () => {
    const diff = diffBenchmarkReports(
      { relation: { evaluated: 10, uncertain: 1, missedRelation: { count: 2, rate: 0.4 } } },
      { relation: { evaluated: 40, uncertain: 5, missedRelation: { count: 1, rate: 0.1 } } },
    );
    expect(diff.find((item: any) => item.metric === "relation.evaluated")?.direction).toBe("changed");
    expect(diff.find((item: any) => item.metric === "relation.uncertain")?.direction).toBe("changed");
    expect(diff.find((item: any) => item.metric === "relation.missedRelation.rate")?.direction).toBe("improved");
  });
});

describe("ground-truth candidate sampling", () => {
  it("includes linked and unlinked same-region candidates", () => {
    const events = [
      { id: "a", region: "高雄市", timestamp: "2026-09-17T00:00:00Z" },
      { id: "b", region: "高雄市", timestamp: "2026-09-17T01:00:00Z" },
      { id: "c", region: "高雄市", timestamp: "2026-09-17T02:00:00Z" },
    ];
    const rows = enumerateCandidatePairs(events, {
      edges: [{ a: "a", b: "b", type: "same-incident" }],
      clusters: [{ id: "cluster-1", members: ["a", "b"] }],
    }, { maxPairs: 20, seed: 43 });

    const keys = new Set(rows.map((row: any) => [row.a, row.b].sort().join("|")));
    expect(keys.has("a|b")).toBe(true);
    expect(keys.has("a|c")).toBe(true);
    expect(rows.every((row: any) => row.label === "")).toBe(true);
  });

  it("includes same-name places in different regions as hard negatives", () => {
    const rows = enumerateCandidatePairs([
      { id: "north", region: "臺北市", title: "中山路火警", timestamp: "2026-09-17T00:00:00Z" },
      { id: "south", region: "高雄市", title: "中山路車禍", timestamp: "2026-09-17T01:00:00Z" },
    ], { edges: [], clusters: [] }, { maxPairs: 20, seed: 43 });

    expect(rows).toContainEqual(expect.objectContaining({
      a: "north",
      b: "south",
      candidateSource: "shared-place-unlinked",
    }));
  });

  it("assigns one story family to candidate pairs that share an event", () => {
    const events = [
      { id: "a", region: "高雄市", timestamp: "2026-09-17T00:00:00Z" },
      { id: "b", region: "高雄市", timestamp: "2026-09-17T01:00:00Z" },
      { id: "c", region: "高雄市", timestamp: "2026-09-17T02:00:00Z" },
    ];
    const rows = enumerateCandidatePairs(events, { edges: [], clusters: [] }, { maxPairs: 20, seed: 43 });
    const familyOf = (x: string, y: string) =>
      rows.find((row: any) => pairKeyOf(row.a, row.b) === pairKeyOf(x, y))?.family;

    // (a,b) 與 (a,c) 共享事件 a——若各給不同 family，標註後可能分進
    // tuning/holdout 兩側造成同案洩漏；必須同 family 才保證同側。
    expect(familyOf("a", "b")).toBeTruthy();
    expect(familyOf("a", "b")).toBe(familyOf("a", "c"));
    expect(familyOf("a", "b")).toBe(familyOf("b", "c"));
    expect(rows.every((row: any) => assignSplit(row.family) === assignSplit(familyOf("a", "b")!))).toBe(true);
  });
});

describe("ground-truth labeled loader", () => {
  it("rejects duplicate labeled pairs instead of double-counting them", () => {
    const text = [pair(), pair({ b: "c" }), pair()].map((row) => JSON.stringify(row)).join("\n");
    const { rows, errors } = loadLabeledJsonl(text, validatePairRow, (row: any) => pairKeyOf(row.a, row.b));

    expect(rows).toHaveLength(2);
    expect(errors).toEqual([{ line: 3, error: "duplicate-key" }]);
  });
});

describe("ground-truth event snapshot", () => {
  it("keeps every field correlateEvents reads so replays match the live policy", () => {
    for (const field of [
      "title", "summary", "region", "category", "scope", "timestamp",
      "entities", "aiEntities", "aiTopic", "locationNote",
      "locationRole", "locationPrecision", "lat", "lng",
    ]) {
      expect(SNAPSHOT_FIELDS).toContain(field);
    }
  });
});
