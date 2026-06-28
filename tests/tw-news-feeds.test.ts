import { describe, expect, it } from "vitest";

import { TW_NEWS_FEEDS } from "../scripts/lib/fetch-rss.mjs";

describe("TW_NEWS_FEEDS", () => {
  it("includes max-coverage audited Taiwan news sources", () => {
    const labels = new Set(TW_NEWS_FEEDS.map((feed) => feed.label));

    for (const label of [
      "中央廣播電臺 RSS",
      "TechNews 科技新報 RSS",
      "iThome Security RSS",
      "iThome News RSS",
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
});
