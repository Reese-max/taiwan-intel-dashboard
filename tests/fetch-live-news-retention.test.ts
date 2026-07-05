import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { buildTwNewsEvents } from "../scripts/fetch-live.mjs";

const news = (id: string, timestamp: string, source: Record<string, unknown> = {}) => ({
  id,
  title: id,
  timestamp,
  source: { datasetId: "tw-news", recordRef: `https://example.com/${id}`, ...source },
});

describe("twnews carry-over retention", () => {
  it("twnews 失敗沿用 oldNews 時也會套 NEWS_RETENTION_DAYS 保留窗", () => {
    const now = Date.parse("2026-07-10T00:00:00.000Z");
    const oldNews = [
      news("keep", "2026-07-09T00:00:00.000Z"),
      news("expired", "2026-06-30T00:00:00.000Z"),
    ];

    const result = buildTwNewsEvents({
      twnews: [],
      oldNews,
      twnewsStatus: { ok: false },
      dropStaleNews: false,
      retentionDays: 5,
      now,
    });

    expect(result.map((e: { id: string }) => e.id)).toEqual(["keep"]);
  });

  it("依事件來源套 advisory 長保留窗，但一般新聞維持短窗", () => {
    const now = Date.parse("2026-07-31T00:00:00.000Z");
    const twnews = [
      news("advisory-20d", "2026-07-11T00:00:00.000Z", { advisory: true }),
      news("general-6d", "2026-07-25T00:00:00.000Z"),
    ];

    const result = buildTwNewsEvents({
      twnews,
      oldNews: [],
      twnewsStatus: { ok: true },
      retentionDays: 5,
      advisoryRetentionDays: 30,
      now,
    });

    expect(result.map((e: { id: string }) => e.id)).toEqual(["advisory-20d"]);
  });

  it("advisory 仍受時間窗限制，不做無界保留", () => {
    const now = Date.parse("2026-07-31T00:00:00.000Z");
    const twnews = [news("advisory-40d", "2026-06-21T00:00:00.000Z", { advisory: true })];

    const result = buildTwNewsEvents({
      twnews,
      oldNews: [],
      twnewsStatus: { ok: true },
      retentionDays: 5,
      advisoryRetentionDays: 30,
      now,
    });

    expect(result.map((e: { id: string }) => e.id)).toEqual([]);
  });

  it("未傳 advisoryRetentionDays 時維持舊單一 retentionDays 行為", () => {
    const now = Date.parse("2026-07-31T00:00:00.000Z");
    const twnews = [news("advisory-20d", "2026-07-11T00:00:00.000Z", { advisory: true })];

    const result = buildTwNewsEvents({
      twnews,
      oldNews: [],
      twnewsStatus: { ok: true },
      retentionDays: 5,
      now,
    });

    expect(result.map((e: { id: string }) => e.id)).toEqual([]);
  });
});
