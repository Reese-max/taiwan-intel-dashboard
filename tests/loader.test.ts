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

  it("filters by source name", () => {
    const events: IntelEvent[] = [
      { ...base, id: "a", source: { name: "中央社", type: "manual", fetchedAt: "2026-06-15T00:00:00+08:00" } },
      { ...base, id: "b", source: { name: "警政署", type: "manual", fetchedAt: "2026-06-15T00:00:00+08:00" } },
      { ...base, id: "c", source: { name: "自建", type: "manual", fetchedAt: "2026-06-15T00:00:00+08:00" } },
    ];
    expect(filterEvents(events, { source: "警政署" }).map((e) => e.id)).toEqual(["b"]);
  });

  it("依官方／媒體警政新聞定義篩選", () => {
    const events: IntelEvent[] = [
      { ...base, id: "official-api", source: { ...base.source, datasetId: "7505" } },
      { ...base, id: "official-rss", source: { ...base.source, datasetId: "tw-news", authority: "official" } },
      { ...base, id: "media-rss", source: { ...base.source, datasetId: "tw-news" } },
      { ...base, id: "other-official", source: { ...base.source, datasetId: "E-A0015-001" } },
    ];

    expect(filterEvents(events, { newsAuthority: "official" }).map((e) => e.id)).toEqual([
      "official-api",
      "official-rss",
    ]);
    expect(filterEvents(events, { newsAuthority: "media" }).map((e) => e.id)).toEqual(["media-rss"]);
  });

  it("用 sinceDays 下界時，會排除低於 cutoff 的事件", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-06-20T00:00:00+08:00"));
      const events: IntelEvent[] = [
        { ...base, id: "old", timestamp: "2026-06-12T10:00:00+08:00" },
        { ...base, id: "in-range", timestamp: "2026-06-18T10:00:00+08:00" },
      ];
      expect(filterEvents(events, { sinceDays: 3 }).map((e) => e.id)).toEqual(["in-range"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("非法 timestamp 不會被時間過濾而保留", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-06-20T00:00:00+08:00"));
      const events: IntelEvent[] = [
        { ...base, id: "invalid-time", timestamp: "not-a-number" },
        { ...base, id: "old", timestamp: "2026-06-12T10:00:00+08:00" },
      ];
      expect(filterEvents(events, { sinceDays: 3 }).map((e) => e.id)).toEqual(["invalid-time"]);
    } finally {
      vi.useRealTimers();
    }
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
