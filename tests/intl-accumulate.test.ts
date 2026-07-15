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

  it("selectDiverseByCategory: 主題內風險分層比例取樣 — 池超過 cap 時 low 按占比存活", () => {
    // 同主題 100 high + 100 low，cap 100 → 舊邏輯（風險排序取頭）low 全滅；
    // 分層取樣應各留約一半。
    const events = [
      ...Array.from({ length: 100 }, (_, i) => ev(`h${i}`, "資安", "high")),
      ...Array.from({ length: 100 }, (_, i) => ev(`l${i}`, "資安", "low")),
    ];
    const out = selectDiverseByCategory(events, 100);
    expect(out).toHaveLength(100);
    const lows = out.filter((e: { riskLevel: string }) => e.riskLevel === "low").length;
    expect(lows).toBeGreaterThanOrEqual(40); // 比例存活（50±容差），絕不歸零
    expect(lows).toBeLessThanOrEqual(60);
  });

  it("selectDiverseByCategory: 少數 critical 在分層取樣下仍優先進榜", () => {
    const events = [
      ev("c1", "地緣政治", "critical"),
      ...Array.from({ length: 99 }, (_, i) => ev(`m${i}`, "地緣政治", "medium")),
      ...Array.from({ length: 100 }, (_, i) => ev(`l${i}`, "地緣政治", "low")),
    ];
    const out = selectDiverseByCategory(events, 50);
    expect(out.some((e: { id: string }) => e.id === "c1")).toBe(true);
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

  it("accumulateInternational: stateful official warnings survive the rolling-news age window", () => {
    const now = new Date("2026-07-10T00:00:00Z").getTime();
    const warning = {
      ...ev("mofa-old", "地緣政治", "high", "2026-05-01T00:00:00Z"),
      source: { datasetId: "mofa-travel-warning", retentionPolicy: "stateful" },
    };
    const out = accumulateInternational([], [warning], { retentionDays: 5, cap: 2, now });
    expect(out.map((e: { id: string }) => e.id)).toContain("mofa-old");
  });

  it("accumulateInternational: a fresh stateful snapshot replaces prior rows from that dataset", () => {
    const now = new Date("2026-07-10T00:00:00Z").getTime();
    const fresh = [{
      ...ev("mofa-current", "地緣政治", "medium", "2026-01-01T00:00:00Z"),
      source: { datasetId: "mofa-travel-warning", retentionPolicy: "stateful" },
    }];
    const old = [{
      ...ev("mofa-withdrawn", "地緣政治", "high", "2026-01-01T00:00:00Z"),
      source: { datasetId: "mofa-travel-warning", retentionPolicy: "stateful" },
    }];
    const out = accumulateInternational(fresh, old, { retentionDays: 5, cap: 2, now });
    expect(out.map((e: { id: string }) => e.id)).toEqual(["mofa-current"]);
  });

  it("accumulateInternational: stateful warnings do not consume the rolling-news cap", () => {
    const now = new Date("2026-07-10T00:00:00Z").getTime();
    const stateful = {
      ...ev("mofa", "地緣政治", "high", "2026-01-01T00:00:00Z"),
      source: { datasetId: "mofa-travel-warning", retentionPolicy: "stateful" },
    };
    const news = [ev("n1", "資安", "medium", "2026-07-09T00:00:00Z"), ev("n2", "金融", "low", "2026-07-09T00:00:00Z")];
    const out = accumulateInternational([stateful, ...news], [], { retentionDays: 5, cap: 2, now });
    expect(out).toHaveLength(3);
    expect(out.map((e: { id: string }) => e.id).sort()).toEqual(["mofa", "n1", "n2"]);
  });
});
