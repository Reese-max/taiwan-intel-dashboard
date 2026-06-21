import { describe, it, expect, vi } from "vitest";
import { filterEvents } from "../src/data/loader";
import type { IntelEvent } from "../src/types/event";

const base: IntelEvent = {
  id: "1",
  title: "t",
  region: "臺北市",
  timestamp: "2026-06-14T00:00:00+08:00",
  category: "治安",
  scope: "domestic",
  riskLevel: "low",
  summary: "s",
  source: { name: "x", type: "manual", fetchedAt: "2026-06-15T00:00:00+08:00" },
};

const evs: IntelEvent[] = [
  base,
  { ...base, id: "2", category: "災防", riskLevel: "high" },
  { ...base, id: "3", scope: "international", category: "資安", riskLevel: "critical" },
];

describe("filterEvents", () => {
  it("filters by scope", () => {
    expect(filterEvents(evs, { scope: "domestic" }).map((e) => e.id)).toEqual(["1", "2"]);
  });
  it("filters by category", () => {
    expect(filterEvents(evs, { scope: "domestic", category: "災防" }).map((e) => e.id)).toEqual(["2"]);
  });
  it("filters by minimum risk", () => {
    expect(filterEvents(evs, { minRisk: "high" }).map((e) => e.id)).toEqual(["2", "3"]);
  });
  it("排除超過明日的離譜未來時間資料", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-06-21T00:00:00+08:00"));
      const events = [
        { ...base, id: "now", timestamp: "2026-06-20T10:00:00+08:00" },
        { ...base, id: "future", timestamp: "2066-02-22T12:00:00+08:00" },
      ];
      expect(filterEvents(events, { sinceDays: 3 }).map((e) => e.id)).toEqual(["now"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
