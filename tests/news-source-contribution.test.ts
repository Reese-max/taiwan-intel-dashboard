import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildNewsSourceContribution,
  eventFeedLabel,
  findLowContributionRows,
} from "../scripts/lib/news-source-contribution.mjs";

const rawItems = [
  {
    title: "新北詐騙集團車手落網 - 自由時報",
    link: "https://example.test/udn-1",
    description: "假檢警詐騙",
    source: "GN UDN 綜合治安",
  },
  {
    title: "新北詐騙集團車手落網 - ETtoday",
    link: "https://example.test/ettoday-1",
    description: "假檢警詐騙",
    source: "GN ETtoday 綜合治安",
  },
  {
    title: "高雄街頭砍人送醫",
    link: "https://example.test/tvbs-1",
    description: "警方到場逮捕",
    source: "GN TVBS 綜合治安",
  },
  {
    title: "健康講座開跑",
    link: "https://example.test/rti-1",
    description: "健康活動",
    source: "中央廣播電臺 RSS",
  },
  {
    title: "社區藝文活動",
    link: "https://example.test/rti-2",
    description: "文化活動",
    source: "中央廣播電臺 RSS",
  },
  {
    title: "觀光抽獎活動",
    link: "https://example.test/rti-3",
    description: "旅遊活動",
    source: "中央廣播電臺 RSS",
  },
];

describe("buildNewsSourceContribution", () => {
  it("counts each feed's raw, title-deduped, police-relevant, and final event contribution", () => {
    const contribution = buildNewsSourceContribution({
      rawItems,
      uniqueItems: [rawItems[0], rawItems[2], rawItems[3], rawItems[4], rawItems[5]],
      policeItems: [rawItems[0], rawItems[2]],
      finalEvents: [
        {
          title: "新北詐騙集團車手落網",
          source: {
            recordRef: "https://example.test/udn-1",
            query: "GN UDN 綜合治安｜RSS https://news.google.com/rss/search?q=site:udn.com",
          },
        },
        {
          title: "高雄街頭砍人送醫",
          source: {
            recordRef: "https://example.test/tvbs-1",
            query: "GN TVBS 綜合治安｜RSS https://news.google.com/rss/search?q=site:tvbs.com.tw",
          },
        },
      ],
    });

    const udn = contribution.rows.find((row) => row.label === "GN UDN 綜合治安");
    expect(udn).toMatchObject({ raw: 1, rawUnique: 1, dedupedAway: 0, policeRelevant: 1, finalEvents: 1 });
    expect(udn?.finalShare).toBe(0.5);

    const ettoday = contribution.rows.find((row) => row.label === "GN ETtoday 綜合治安");
    expect(ettoday).toMatchObject({ raw: 1, rawUnique: 0, dedupedAway: 1, policeRelevant: 0, finalEvents: 0 });

    const rti = contribution.rows.find((row) => row.label === "中央廣播電臺 RSS");
    expect(rti).toMatchObject({ raw: 3, rawUnique: 3, policeRelevant: 0, finalEvents: 0, lowContribution: true });
    expect(contribution.lowContributionFeeds).toContain("中央廣播電臺 RSS");
    expect(contribution.totals).toMatchObject({ raw: 6, rawUnique: 5, policeRelevant: 2, finalEvents: 2 });
  });

  it("counts finalEvents after retention and exposes droppedByRetention", () => {
    const contribution = buildNewsSourceContribution({
      rawItems: [
        { title: "舊資安警示 A", link: "https://example.test/old-a", source: "TWCERT/CC 資安新聞" },
        { title: "舊資安警示 B", link: "https://example.test/old-b", source: "TWCERT/CC 資安新聞" },
        { title: "新資安警示 C", link: "https://example.test/new-c", source: "iThome Security RSS" },
        { title: "新資安警示 D", link: "https://example.test/new-d", source: "iThome Security RSS" },
      ],
      uniqueItems: [
        { title: "舊資安警示 A", link: "https://example.test/old-a", source: "TWCERT/CC 資安新聞" },
        { title: "舊資安警示 B", link: "https://example.test/old-b", source: "TWCERT/CC 資安新聞" },
        { title: "新資安警示 C", link: "https://example.test/new-c", source: "iThome Security RSS" },
        { title: "新資安警示 D", link: "https://example.test/new-d", source: "iThome Security RSS" },
      ],
      policeItems: [
        { title: "舊資安警示 A", link: "https://example.test/old-a", source: "TWCERT/CC 資安新聞" },
        { title: "舊資安警示 B", link: "https://example.test/old-b", source: "TWCERT/CC 資安新聞" },
        { title: "新資安警示 C", link: "https://example.test/new-c", source: "iThome Security RSS" },
        { title: "新資安警示 D", link: "https://example.test/new-d", source: "iThome Security RSS" },
      ],
      preRetentionEvents: [
        { source: { recordRef: "https://example.test/old-a" } },
        { source: { recordRef: "https://example.test/old-b" } },
        { source: { recordRef: "https://example.test/new-c" } },
        { source: { recordRef: "https://example.test/new-d" } },
      ],
      finalEvents: [
        { source: { recordRef: "https://example.test/new-c" } },
        { source: { recordRef: "https://example.test/new-d" } },
      ],
    });

    const twcert = contribution.rows.find((row) => row.label === "TWCERT/CC 資安新聞");
    expect(twcert).toMatchObject({
      policeRelevant: 2,
      finalEvents: 0,
      droppedByRetention: 2,
      lowContribution: true,
      lowContributionReason: "dropped_by_retention",
    });

    const ithome = contribution.rows.find((row) => row.label === "iThome Security RSS");
    expect(ithome).toMatchObject({ policeRelevant: 2, finalEvents: 2, droppedByRetention: 0 });
    expect(contribution.totals).toMatchObject({ finalEvents: 2, droppedByRetention: 2 });
  });

  it("can recover Google News feed labels from event provenance query when raw link is unavailable", () => {
    expect(
      eventFeedLabel({
        source: {
          name: "Google News 聚合",
          query: "GN 上報綜合治安｜RSS https://news.google.com/rss/search?q=site:upmedia.mg",
        },
      }),
    ).toBe("GN 上報綜合治安");
  });

  it("exposes a package script for printing the latest source contribution report", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.scripts["report:news-sources"]).toBe("node scripts/report-news-source-contribution.mjs");
  });

  it("finds CI warning rows when raw volume is meaningful but final contribution is tiny", () => {
    const rows = [
      { label: "高貢獻", raw: 100, finalEvents: 20 },
      { label: "需警告", raw: 10, finalEvents: 1 },
      { label: "太低量不警告", raw: 9, finalEvents: 0 },
    ];

    expect(findLowContributionRows(rows)).toEqual([{ label: "需警告", raw: 10, finalEvents: 1 }]);
  });

  it("exposes a package script for CI source contribution warning audit", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.scripts["audit:news-source-contribution"]).toBe("node scripts/audit-news-source-contribution.mjs");
  });
});
