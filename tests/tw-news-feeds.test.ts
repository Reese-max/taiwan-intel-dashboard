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

describe("主題來源 hint（2026-07-04 漏斗診斷處置）", () => {
  const hintOf = (label: string) => TW_NEWS_FEEDS.find((f) => f.label === label)?.hint;
  it("食安/衛生/環境來源掛上主題 hint", () => {
    expect(hintOf("GN 食安黑心")).toBe("食安");
    expect(hintOf("農業部官網")).toBe("食安");
    expect(hintOf("食藥署官網")).toBe("食安");
    expect(hintOf("疾管署官網")).toBe("衛生");
    expect(hintOf("GN 環境污染偷排")).toBe("環境");
    expect(hintOf("環境部官網")).toBe("環境");
  });
  it("資安與 EN 來源 hint 不變", () => {
    expect(hintOf("TechNews 科技新報 RSS")).toBe("資安");
    expect(hintOf("Focus Taiwan (EN)")).toBe("治安");
    expect(hintOf("Taipei Times (EN)")).toBe("治安");
  });
});
