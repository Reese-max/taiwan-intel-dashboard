import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without declaration files
import { computeRelationMetrics } from "../scripts/lib/ground-truth-relations.mjs";

describe("ground-truth relation evidence", () => {
  it("keeps same-event false negatives even when a direct edge exists", () => {
    const result = computeRelationMetrics([{
      a: "a", b: "b", family: "story-a", label: "same_event", labeledBy: "human",
      evidence: "https://example.invalid/not-clustered", candidateSource: "auto-edge",
    }], { edges: [{ a: "a", b: "b", type: "same-incident" }], clusters: [] });
    expect(result.sameEvent.fn).toBe(1);
    expect(result.missedRelation.count).toBe(0);
    expect(result.examples.sameEventFalseNegatives).toEqual(["a|b"]);
    expect(result.examples.sameEventFalseNegativeSources).toEqual([{
      pair: "a|b", evidence: "https://example.invalid/not-clustered", candidateSource: "auto-edge",
    }]);
  });

  it("keeps source evidence for both false merges and missed relations", () => {
    const result = computeRelationMetrics(
      [
        {
          schema: "relation-pairs/1",
          a: "a",
          b: "b",
          family: "story-a",
          label: "different_event",
          evidence: "https://example.test/false-merge",
          candidateSource: "shared-place-unlinked",
          labeledAt: "2026-09-17T00:00:00Z",
          labeledBy: "human",
        },
        {
          schema: "relation-pairs/1",
          a: "c",
          b: "d",
          family: "story-c",
          label: "same_event",
          evidence: "https://example.test/missed-relation",
          candidateSource: "same-region-unlinked",
          labeledAt: "2026-09-17T00:00:00Z",
          labeledBy: "human",
        },
      ],
      {
        edges: [{ a: "a", b: "b", type: "same-entity" }],
        clusters: [{ id: "cluster-a", members: ["a", "b"] }],
      },
    );

    expect(result.examples.falseMergeSources).toEqual([
      {
        pair: "a|b",
        evidence: "https://example.test/false-merge",
        candidateSource: "shared-place-unlinked",
      },
    ]);
    expect(result.examples.missedRelationSources).toEqual([
      {
        pair: "c|d",
        evidence: "https://example.test/missed-relation",
        candidateSource: "same-region-unlinked",
      },
    ]);
  });
});
