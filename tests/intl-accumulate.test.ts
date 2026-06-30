import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { selectDiverseByCategory, accumulateInternational, byRiskThenTime } from "../scripts/lib/intl-accumulate.mjs";

const ev = (id: string, category: string, riskLevel: string, timestamp = "2026-07-01T00:00:00Z") => ({
  id,
  category,
  riskLevel,
  timestamp,
  scope: "international",
});

describe("intl accumulate", () => {
  it("byRiskThenTime: higher risk first, then newer", () => {
    const a = ev("a", "x", "high", "2026-07-01T00:00:00Z");
    const b = ev("b", "x", "critical", "2026-06-01T00:00:00Z");
    const c = ev("c", "x", "high", "2026-07-02T00:00:00Z");
    expect([a, b, c].sort(byRiskThenTime).map((e) => e.id)).toEqual(["b", "c", "a"]);
  });

  it("selectDiverseByCategory: round-robins categories so one topic can't dominate", () => {
    // 8 geopolitics (all high) + 2 cyber (low). cap 4 → must include both cyber despite lower risk.
    const events = [
      ...Array.from({ length: 8 }, (_, i) => ev(`g${i}`, "地緣政治", "high")),
      ev("c1", "資安", "low"),
      ev("c2", "資安", "low"),
    ];
    const out = selectDiverseByCategory(events, 4);
    expect(out).toHaveLength(4);
    const cats = out.map((e: { category: string }) => e.category);
    expect(cats.filter((c: string) => c === "資安").length).toBe(2); // diversity kept both cyber
    expect(cats.filter((c: string) => c === "地緣政治").length).toBe(2);
  });

  it("selectDiverseByCategory: returns all (risk-sorted) when under cap", () => {
    const events = [ev("a", "x", "medium"), ev("b", "y", "critical")];
    expect(selectDiverseByCategory(events, 10).map((e: { id: string }) => e.id)).toEqual(["b", "a"]);
  });

  it("accumulateInternational: merges fresh+old, dedupes by id (fresh wins), drops stale, caps", () => {
    const now = new Date("2026-07-10T00:00:00Z").getTime();
    const fresh = [ev("dup", "x", "high", "2026-07-09T00:00:00Z"), ev("new", "y", "medium", "2026-07-09T00:00:00Z")];
    const old = [
      { ...ev("dup", "x", "low", "2026-07-08T00:00:00Z"), stale: true }, // same id as fresh → fresh wins
      ev("keep", "z", "high", "2026-07-08T00:00:00Z"), // recent → kept
      ev("expired", "z", "critical", "2026-06-01T00:00:00Z"), // > 5 days old → dropped
    ];
    const out = accumulateInternational(fresh, old, { retentionDays: 5, cap: 50, now });
    const ids = out.map((e: { id: string }) => e.id).sort();
    expect(ids).toEqual(["dup", "keep", "new"]); // expired dropped
    const dup = out.find((e: { id: string }) => e.id === "dup");
    expect(dup.riskLevel).toBe("high"); // fresh version won (not old "low")
  });

  it("accumulateInternational: caps the accumulated window", () => {
    const now = new Date("2026-07-10T00:00:00Z").getTime();
    const old = Array.from({ length: 300 }, (_, i) => ev(`o${i}`, i % 2 ? "資安" : "地緣政治", "medium", "2026-07-09T00:00:00Z"));
    const out = accumulateInternational([], old, { retentionDays: 5, cap: 250, now });
    expect(out).toHaveLength(250);
  });
});
