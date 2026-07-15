import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { auditCoverageMatrix, buildCoverageMatrix } from "../scripts/audit-coverage.mjs";

describe("coverage 每日矩陣", () => {
  it("依 scope/category 統計事件、來源、官方與定位涵蓋", () => {
    const matrix = buildCoverageMatrix({
      generatedAt: "2026-07-16T02:00:00.000Z",
      events: [
        { scope: "domestic", category: "國防", riskLevel: "medium", lat: 25, lng: 121, source: { type: "gov-open-data", datasetId: "mnd-pla-activity" } },
        { scope: "domestic", category: "治安", riskLevel: "high", source: { type: "news-rss", datasetId: "tw-news" } },
      ],
      sources: [
        { scope: "domestic", category: "國防", type: "gov-open-data", count: 1 },
        { scope: "domestic", category: "治安", type: "news-rss", count: 1, stale: true },
        { scope: "international", category: "地緣政治", type: "gov-open-data", count: 0 },
      ],
    });

    expect(matrix.day).toBe("2026-07-16");
    expect(matrix.totals).toMatchObject({ events: 2, sourceRows: 3, healthySources: 2, officialEvents: 1 });
    expect(matrix.rows).toContainEqual(expect.objectContaining({
      scope: "domestic",
      category: "國防",
      events: 1,
      sourceRows: 1,
      officialEvents: 1,
      locatedEvents: 1,
    }));
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
