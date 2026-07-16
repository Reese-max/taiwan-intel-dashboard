import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { auditCoverageMatrix, buildCoverageMatrix } from "../scripts/audit-coverage.mjs";

describe("coverage 每日矩陣", () => {
  it("依 scope/category 統計事件、來源、官方與定位涵蓋", () => {
    const matrix = buildCoverageMatrix({
      generatedAt: "2026-07-16T02:00:00.000Z",
      events: [
        { scope: "domestic", category: "國防", region: "臺北市", timestamp: "2026-07-15T04:00:00.000Z", riskLevel: "medium", lat: 25, lng: 121, source: { type: "gov-open-data", datasetId: "mnd-pla-activity" } },
        { scope: "domestic", category: "治安", region: "高雄市", timestamp: "2026-07-16T01:00:00.000Z", riskLevel: "high", source: { name: "測試新聞", type: "news-rss", datasetId: "tw-news" } },
        { scope: "domestic", category: "能源", region: "全國", timestamp: "2026-07-16T01:20:00.000Z", riskLevel: "low", source: { type: "gov-open-data", datasetId: "taipower-supply-demand" } },
      ],
      sources: [
        { scope: "domestic", category: "國防", type: "gov-open-data", datasetId: "mnd-pla-activity", count: 1 },
        { scope: "domestic", category: "治安", name: "台灣新聞：測試新聞", datasetId: "tw-news", type: "news-rss", count: 1, stale: true },
        { scope: "domestic", category: "能源", type: "gov-open-data", datasetId: "taipower-supply-demand", count: 1 },
        { scope: "international", category: "地緣政治", type: "gov-open-data", count: 0 },
      ],
    });

    expect(matrix.day).toBe("2026-07-16");
    expect(matrix.totals).toMatchObject({ events: 3, sourceRows: 4, healthySources: 3, officialEvents: 2 });
    expect(matrix.rows).toContainEqual(expect.objectContaining({
      scope: "domestic",
      category: "國防",
      events: 1,
      sourceRows: 1,
      officialEvents: 1,
      locatedEvents: 1,
    }));
    expect(matrix.matrix7d.days).toHaveLength(7);
    expect(matrix.matrix7d.categories).toContain("環境");
    expect(matrix.matrix7d.rows).toContainEqual(expect.objectContaining({
      region: "臺北市",
      category: "國防",
      sourceKind: "official",
      events: 1,
      freshEvents: 1,
      staleEvents: 0,
    }));
    expect(matrix.matrix7d.rows).toContainEqual(expect.objectContaining({
      region: "高雄市",
      category: "治安",
      sourceKind: "news",
      events: 1,
      freshEvents: 0,
      staleEvents: 1,
    }));
    expect(matrix.matrix7d.blindSpots).toContainEqual({ region: "臺北市", category: "國防", sourceKind: "news" });
    expect(matrix.matrix7d.blindSpots).toContainEqual({ region: "臺北市", category: "環境", sourceKind: "official" });
    expect(matrix.matrix7d.summary).toMatchObject({ windowEvents: 3, events: 2, unmappedEvents: 1 });
    expect(auditCoverageMatrix(matrix).ok).toBe(true);
  });

  it("事件總數與列加總不一致時 gate 失敗", () => {
    expect(auditCoverageMatrix({
      generatedAt: "2026-07-16T02:00:00.000Z",
      day: "2026-07-16",
      totals: { events: 2, sourceRows: 0 },
      rows: [{ scope: "domestic", category: "治安", events: 1, sourceRows: 0 }],
    })).toMatchObject({ ok: false });
  });
});
