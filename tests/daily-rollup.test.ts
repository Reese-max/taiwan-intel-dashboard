import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { applyDailyRollup, taiwanLocalDay } from "../scripts/lib/daily-rollup.mjs";

const event = ({
  id = "evt",
  timestamp = "2026-07-07T00:00:00+08:00",
  scope = "domestic",
  riskLevel = "low",
  category = "治安",
} = {}) => ({
  id,
  title: id,
  region: "台北市",
  timestamp,
  category,
  summary: "測試事件",
  scope,
  riskLevel,
  source: { name: "測試來源", fetchedAt: timestamp },
});

describe("daily event rollup", () => {
  it("converts ISO-like timestamps into Taiwan local days", () => {
    expect(taiwanLocalDay("2026-07-06T17:00:00Z")).toBe("2026-07-07");
    expect(taiwanLocalDay("not-a-date")).toBeNull();
  });

  it("builds daily buckets from empty previous rollup", () => {
    const out = applyDailyRollup(
      { days: {} },
      [
        event({ id: "d-low", timestamp: "2026-07-06T16:30:00Z", scope: "domestic", riskLevel: "low", category: "治安" }),
        event({ id: "i-critical", timestamp: "2026-07-07T01:00:00+08:00", scope: "international", riskLevel: "critical", category: "地緣政治" }),
        event({ id: "d-high", timestamp: "2026-07-07T23:59:00+08:00", scope: "domestic", riskLevel: "high", category: "治安" }),
      ],
    );

    expect(out.days["2026-07-07"]).toEqual({
      total: 3,
      byScope: { domestic: 2, international: 1 },
      byRisk: { low: 1, medium: 0, high: 1, critical: 1 },
      byCategory: { "治安": 2, "地緣政治": 1 },
    });
  });

  it("merges cells by max so disappeared events do not lower historical counts", () => {
    const previous = {
      days: {
        "2026-07-07": {
          total: 10,
          byScope: { domestic: 8, international: 2 },
          byRisk: { low: 1, medium: 2, high: 3, critical: 4 },
          byCategory: { "治安": 10 },
        },
      },
    };

    const lower = applyDailyRollup(
      previous,
      Array.from({ length: 6 }, (_, n) => event({ id: `low-${n}`, timestamp: "2026-07-07T10:00:00+08:00", category: "治安" })),
    );
    expect(lower.days["2026-07-07"].total).toBe(10);
    expect(lower.days["2026-07-07"].byCategory["治安"]).toBe(10);

    const higher = applyDailyRollup(
      previous,
      Array.from({ length: 12 }, (_, n) => event({ id: `high-${n}`, timestamp: "2026-07-07T10:00:00+08:00", category: "治安" })),
    );
    expect(higher.days["2026-07-07"].total).toBe(12);
    expect(higher.days["2026-07-07"].byScope.domestic).toBe(12);
  });

  it("is idempotent for the same run", () => {
    const events = [
      event({ id: "a", timestamp: "2026-07-07T10:00:00+08:00", scope: "domestic", riskLevel: "medium", category: "治安" }),
      event({ id: "b", timestamp: "2026-07-07T11:00:00+08:00", scope: "international", riskLevel: "critical", category: "資安" }),
    ];

    const first = applyDailyRollup({ days: {} }, events);
    const second = applyDailyRollup(first, events);

    expect(second).toEqual(first);
  });

  it("trims days outside the retention window", () => {
    const previous = {
      days: {
        "2026-07-06": { total: 1, byScope: { domestic: 1, international: 0 }, byRisk: { low: 1, medium: 0, high: 0, critical: 0 }, byCategory: { "舊類": 1 } },
        "2026-07-09": { total: 2, byScope: { domestic: 2, international: 0 }, byRisk: { low: 2, medium: 0, high: 0, critical: 0 }, byCategory: { "近類": 2 } },
      },
    };

    const out = applyDailyRollup(previous, [event({ id: "anchor", timestamp: "2026-07-10T12:00:00+08:00" })], {
      retentionDays: 2,
    });

    expect(Object.keys(out.days).sort()).toEqual(["2026-07-09", "2026-07-10"]);
  });

  it("skips invalid timestamps and does not mutate previous", () => {
    const previous = {
      days: {
        "2026-07-07": { total: 1, byScope: { domestic: 1, international: 0 }, byRisk: { low: 1, medium: 0, high: 0, critical: 0 }, byCategory: { "治安": 1 } },
      },
    };
    const snapshot = structuredClone(previous);

    const out = applyDailyRollup(previous, [event({ id: "bad", timestamp: "not-a-date", riskLevel: "critical" })]);

    expect(out).toEqual(previous);
    expect(previous).toEqual(snapshot);
  });
});
