import { describe, expect, it } from "vitest";
import { sampleGroundTruthRows } from "../scripts/ground-truth-sample.mjs";
import { scoreGroundTruthRows } from "../scripts/ground-truth-score.mjs";

const events = [
  { id: "a1", title: "A1", summary: "sa1", category: "治安", riskLevel: "low" },
  { id: "a2", title: "A2", summary: "sa2", category: "治安", riskLevel: "low" },
  { id: "a3", title: "A3", summary: "sa3", category: "治安", riskLevel: "low" },
  { id: "b1", title: "B1", summary: "sb1", category: "治安", riskLevel: "high" },
  { id: "c1", title: "C1", summary: "sc1", category: "反詐", riskLevel: "medium" },
  { id: "c2", title: "C2", summary: "sc2", category: "反詐", riskLevel: "medium" },
];

describe("sampleGroundTruthRows", () => {
  it("is deterministic for the same seed and input", () => {
    const first = sampleGroundTruthRows(events, { perCell: 2, seed: 123 });
    const second = sampleGroundTruthRows(events, { perCell: 2, seed: 123 });

    expect(second.rows).toEqual(first.rows);
    expect(second.stats).toEqual(first.stats);
  });

  it("caps each category x riskLevel cell at per-cell", () => {
    const result = sampleGroundTruthRows(events, { perCell: 2, seed: 42 });
    const counts = result.rows.reduce<Record<string, number>>((acc, row) => {
      const key = `${row.category}|${row.riskLevel}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    expect(counts["治安|low"]).toBeLessThanOrEqual(2);
    expect(counts["反詐|medium"]).toBeLessThanOrEqual(2);
  });

  it("takes all rows when a cell has fewer rows than per-cell", () => {
    const result = sampleGroundTruthRows(events, { perCell: 5, seed: 7 });

    expect(result.rows.map((row) => row.id).sort()).toEqual(events.map((row) => row.id).sort());
    expect(result.stats).toContainEqual({ category: "治安", riskLevel: "high", available: 1, sampled: 1 });
  });
});

describe("scoreGroundTruthRows", () => {
  it("computes category and risk agreement while skipping blank human annotations", () => {
    const result = scoreGroundTruthRows([
      { id: "1", category: "治安", riskLevel: "low", human_category: "治安", human_risk: "low" },
      { id: "2", category: "反詐", riskLevel: "medium", human_category: "治安", human_risk: "high" },
      { id: "3", category: "交通", riskLevel: "high", human_category: "", human_risk: "critical" },
      { id: "4", category: "食安", riskLevel: "critical", human_category: "食安", human_risk: "" },
    ]);

    expect(result.category.total).toBe(3);
    expect(result.category.matches).toBe(2);
    expect(result.category.rate).toBeCloseTo(2 / 3);
    expect(result.risk.total).toBe(3);
    expect(result.risk.matches).toBe(1);
    expect(result.risk.rate).toBeCloseTo(1 / 3);
  });

  it("counts severe underestimation when human risk is at least two levels above pipeline risk", () => {
    const result = scoreGroundTruthRows([
      { id: "1", category: "治安", riskLevel: "low", human_category: "治安", human_risk: "critical" },
      { id: "2", category: "治安", riskLevel: "medium", human_category: "治安", human_risk: "critical" },
      { id: "3", category: "治安", riskLevel: "high", human_category: "治安", human_risk: "critical" },
    ]);

    expect(result.severeUnderestimation.count).toBe(2);
    expect(result.severeUnderestimation.total).toBe(3);
    expect(result.severeUnderestimation.rate).toBeCloseTo(2 / 3);
  });

  it("sorts confusion pairs by descending count then stable key", () => {
    const result = scoreGroundTruthRows([
      { id: "1", category: "治安", riskLevel: "low", human_category: "反詐", human_risk: "medium" },
      { id: "2", category: "治安", riskLevel: "low", human_category: "反詐", human_risk: "medium" },
      { id: "3", category: "交通", riskLevel: "high", human_category: "災防", human_risk: "critical" },
      { id: "4", category: "交通", riskLevel: "high", human_category: "治安", human_risk: "critical" },
    ]);

    expect(result.confusions.slice(0, 4)).toEqual([
      { type: "category", pair: "治安→反詐", count: 2 },
      { type: "risk", pair: "high→critical", count: 2 },
      { type: "risk", pair: "low→medium", count: 2 },
      { type: "category", pair: "交通→治安", count: 1 },
    ]);
  });
});
