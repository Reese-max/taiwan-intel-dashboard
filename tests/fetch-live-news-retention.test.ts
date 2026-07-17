import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { buildCategoryBasisDistribution, buildTwNewsEvents } from "../scripts/fetch-live.mjs";
// @ts-expect-error — JS ESM module without types
import { isPoliceDomesticEvent } from "../scripts/lib/fetch-police.mjs";

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

  it("twnews 失敗沿用 oldNews 時仍會依 recordRef 去重", () => {
    const now = Date.parse("2026-07-10T00:00:00.000Z");
    const duplicated = news("duplicate", "2026-07-09T00:00:00.000Z");

    const result = buildTwNewsEvents({
      oldNews: [duplicated, { ...duplicated, id: "duplicate-copy" }],
      twnewsStatus: { ok: false },
      retentionDays: 5,
      now,
    });

    expect(result.map((e: { id: string }) => e.id)).toEqual(["duplicate"]);
  });

  it("沿用舊快照時同步清掉新規則判定的移民生活雜訊", () => {
    const now = Date.parse("2026-07-10T00:00:00.000Z");
    const oldNews = [
      news("移民署攜手企業 助新住民子女探索職涯", "2026-07-09T00:00:00.000Z", { name: "移民署 新聞" }),
      news("移民署查獲非法仲介藏匿失聯移工", "2026-07-09T01:00:00.000Z", { name: "移民署 新聞" }),
    ];

    const result = buildTwNewsEvents({
      oldNews,
      twnewsStatus: { ok: false },
      retentionDays: 5,
      now,
    });

    expect(result.map((e: { id: string }) => e.id)).toEqual(["移民署查獲非法仲介藏匿失聯移工"]);
  });

  it("沿用正規化舊新聞時以 summary 清掉反詐宣導與影劇雜訊", () => {
    const now = Date.parse("2026-07-10T00:00:00.000Z");
    const oldNews = [
      {
        ...news("outreach", "2026-07-09T00:00:00.000Z"),
        title: "東勢地政守護長者財產",
        summary: "結合高齡換照講習，宣導不動產防詐。",
      },
      {
        ...news("drama", "2026-07-09T01:00:00.000Z"),
        title: "成毅新劇演警察狂練胸肌 拍攝現場粉絲圍觀",
      },
      {
        ...news("enforcement", "2026-07-09T02:00:00.000Z"),
        title: "警方反詐宣導現場查獲車手並移送",
      },
    ];

    const result = buildTwNewsEvents({ oldNews, twnewsStatus: { ok: false }, retentionDays: 5, now });

    expect(result.map((e: { id: string }) => e.id)).toEqual(["enforcement"]);
  });

  it("媒體 tw-news 不會因反詐分類混入官方警政 carry-over", () => {
    expect(isPoliceDomesticEvent({ category: "反詐", source: { datasetId: "tw-news", query: "警政新聞" } })).toBe(false);
    expect(isPoliceDomesticEvent({ category: "反詐", source: { datasetId: "176455" } })).toBe(true);
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

describe("categoryBasis provenance distribution", () => {
  it("彙總帶 categoryBasis 的 twnews 事件，未標者不計入", () => {
    expect(
      buildCategoryBasisDistribution([
        { id: "a", categoryBasis: "llm" },
        { id: "b", categoryBasis: "default" },
        { id: "c", categoryBasis: "default" },
        { id: "d", categoryBasis: "rule:反詐" },
        { id: "e", categoryBasis: "hint:資安" },
        { id: "structured" },
      ]),
    ).toEqual({
      default: 2,
      "hint:資安": 1,
      llm: 1,
      "rule:反詐": 1,
    });
  });
});
