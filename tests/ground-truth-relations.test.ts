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
  validateLocationRow,
  validatePairRow,
} from "../scripts/lib/ground-truth-relations.mjs";

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
});
