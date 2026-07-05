import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { buildTwNewsEvents } from "../scripts/fetch-live.mjs";

const news = (id: string, timestamp: string) => ({
  id,
  title: id,
  timestamp,
  source: { datasetId: "tw-news", recordRef: `https://example.com/${id}` },
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
});
