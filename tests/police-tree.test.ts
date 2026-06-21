import { describe, expect, it } from "vitest";
import { buildPoliceSourceTree } from "../scripts/lib/police-tree.mjs";

describe("police source tree", () => {
  it("groups police events by category and source and marks the hourly quota", () => {
    const events = [
      {
        id: "traffic-1",
        category: "交通",
        source: { name: "警政署 114年傷亡道路交通事故資料", datasetId: "177136" },
      },
      {
        id: "crime-1",
        category: "治安",
        source: { name: "臺北市政府警察局 犯罪點位", datasetId: "130105" },
      },
      {
        id: "crime-2",
        category: "治安",
        source: { name: "臺北市政府警察局 犯罪點位", datasetId: "130105" },
      },
    ];

    const tree = buildPoliceSourceTree({
      generatedAt: "2026-06-17T00:00:00.000Z",
      events,
      minimumPerHour: 2,
      todayMinimum: 2,
    });

    expect(tree.minimumPerHour).toBe(2);
    expect(tree.total).toBe(3);
    expect(tree.meetsHourlyMinimum).toBe(true);
    expect(tree.categories.map((c) => [c.name, c.count])).toEqual([
      ["治安", 2],
      ["交通", 1],
    ]);
  });

  it("expands today's police records and verifies the daily minimum in Taiwan time", () => {
    const events = Array.from({ length: 151 }, (_, n) => ({
      id: `crime-${n}`,
      title: `今日警政資料 ${n}`,
      category: n % 2 ? "治安" : "交通",
      region: "全國",
      timestamp: "2025-01-01T00:00:00+08:00",
      riskLevel: "low",
      source: {
        name: n % 2 ? "臺北市政府警察局 犯罪點位" : "警政署 114年傷亡道路交通事故資料",
        datasetId: n % 2 ? "130105" : "177136",
        recordRef: String(n),
        fetchedAt: "2026-06-16T22:16:57.203Z",
      },
    }));

    const tree = buildPoliceSourceTree({
      generatedAt: "2026-06-16T22:30:00.000Z",
      events,
      minimumPerHour: 200,
      todayMinimum: 150,
    });

    expect(tree.today.localDate).toBe("2026-06-17");
    expect(tree.today.minimum).toBe(150);
    expect(tree.today.total).toBe(151);
    expect(tree.today.meetsMinimum).toBe(true);
    expect(tree.today.categories.reduce((sum, c) => sum + c.count, 0)).toBe(151);
    expect(tree.today.categories.flatMap((c) => c.sources.flatMap((s) => s.records))).toHaveLength(151);
  });
});
