import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchRssItems, TW_NEWS_FEEDS } from "../scripts/lib/fetch-rss.mjs";

describe("TW_NEWS_FEEDS", () => {
  it("includes max-coverage audited Taiwan news sources", () => {
    const labels = new Set(TW_NEWS_FEEDS.map((feed) => feed.label));

    for (const label of [
      "中央廣播電臺 RSS",
      "TechNews 科技新報 RSS",
      "iThome Security RSS",
      "iThome News RSS",
      "TWCERT/CC 資安新聞",
      "報導者 RSS",
      "INSIDE RSS",
      "GN UDN 綜合治安",
      "GN ETtoday 綜合治安",
      "GN TVBS 綜合治安",
      "GN 三立綜合治安",
      "GN CTWANT 綜合治安",
      "GN 風傳媒綜合治安",
      "GN 上報綜合治安",
      "GN 今周刊詐騙資安",
      "GN iThome 資安",
      "GN TechNews 資安",
      "GN 經濟日報詐騙金融",
      "GN 數位時代資安",
      "彰化縣消防局官網",
      "高雄市交通局災防",
    ]) {
      expect(labels.has(label), `missing feed: ${label}`).toBe(true);
    }
  });

  it("does not contain duplicate labels", () => {
    const labels = TW_NEWS_FEEDS.map((feed) => feed.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["新北市警局官網", "police.ntpc.gov.tw"],
    ["嘉義市警局官網", "ccpb.gov.tw"],
    ["桃園地檢署官網", "tyc.moj.gov.tw"],
  ])("稽核來源 %s 的 URL、分類與官方識別", async (label, domain) => {
    const feed = TW_NEWS_FEEDS.find(f => f.label === label);
    expect(feed?.hint).toBe("治安");
    // 地檢署子站擋境外 IP，與警局一樣走 GN site 查詢
    expect(new URL(feed.url).searchParams.get("q")).toBe(`site:${domain} when:5d`);
    vi.stubGlobal("fetch", vi.fn(async () => new Response('<rss><channel><item><title>查獲詐騙車手</title><link>https://example.test/news/1</link><pubDate>Wed, 04 Nov 2026 08:00:00 GMT</pubDate></item></channel></rss>')));
    const result = await fetchRssItems({ feeds: [feed], retryDelayMs: 0 });
    expect(result.items[0]).toMatchObject({ official: true, source: label, hint: "治安" });
    // 跨家族審查 S1：地檢署名稱不含縣市全名，也要有轄區
    expect(result.items[0].jurisdiction).toMatch(/[市縣]$/);
  });

  it("不再直連 CI 連不上的地檢署子站與桃園警局列表", () => {
    expect(TW_NEWS_FEEDS.some(f => /^https:\/\/www\.[a-z]+\.moj\.gov\.tw\//.test(f.url) || f.url.includes("typd.gov.tw"))).toBe(false);
  });

  it("移除沒有近期案件的新北舊 RSS", () => {
    expect(TW_NEWS_FEEDS.some(f => f.label === "新北市警局 最新" || f.url.includes("rss-3344-1.html"))).toBe(false);
  });
});

describe("主題來源 hint（2026-07-04 漏斗診斷處置）", () => {
  const hintOf = (label: string) => TW_NEWS_FEEDS.find((f) => f.label === label)?.hint;
  it("食安/衛生/環境來源掛上主題 hint", () => {
    expect(hintOf("GN 食安黑心")).toBe("食安");
    expect(hintOf("農業部官網")).toBe("食安");
    expect(hintOf("食藥署官網")).toBe("食安");
    expect(hintOf("疾管署官網")).toBe("衛生");
    expect(hintOf("GN 環境污染偷排")).toBe("環境");
  });
  it("資安與 EN 來源 hint 不變", () => {
    expect(hintOf("TechNews 科技新報 RSS")).toBe("資安");
    expect(hintOf("TWCERT/CC 資安新聞")).toBe("資安");
    expect(hintOf("Focus Taiwan (EN)")).toBe("治安");
    expect(hintOf("Taipei Times (EN)")).toBe("治安");
  });
});

describe("GN 100 則上限的時間窗", () => {
  const q = (label: string) => {
    const feed = TW_NEWS_FEEDS.find((f) => f.label === label);
    expect(feed, label).toBeDefined();
    return new URL(feed!.url).searchParams.get("q");
  };

  it.each(["GN 傷害鬥毆", "GN 收押通緝", "GN 妨害自由恐嚇", "司法院官網", "GN CTWANT 綜合治安", "GN 今周刊詐騙資安"])(
    "近 5 天會撞上限的 %s 改抓近 1 天",
    (label) => {
      expect(q(label)).toMatch(/ when:1d$/);
      expect(TW_NEWS_FEEDS.some((f) => f.label === `${label} 6h`)).toBe(false);
    },
  );

  it.each(["GN 家暴兒虐", "央廣 RTI 治安", "GN UDN 綜合治安", "GN ETtoday 綜合治安", "GN 三立綜合治安", "GN 風傳媒綜合治安", "GN 上報綜合治安", "GN 經濟日報詐騙金融"])(
    "近 1 天仍撞上限的 %s 另有近 6 小時查詢",
    (label) => {
      expect(q(label)).toMatch(/ when:1d$/);
      expect(q(`${label} 6h`)).toBe(q(label)!.replace(/when:1d$/, "when:6h"));
      expect(TW_NEWS_FEEDS.find((f) => f.label === `${label} 6h`)?.hint).toBe(TW_NEWS_FEEDS.find((f) => f.label === label)?.hint);
    },
  );

  it("其他 GN 查詢維持近 5 天", () => {
    expect(q("GN 殺人分屍")).toMatch(/ when:5d$/);
    expect(q("新北市警局官網")).toBe("site:police.ntpc.gov.tw when:5d");
  });
});
