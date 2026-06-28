import { describe, expect, it } from "vitest";

import { deriveNewsProvenance } from "../scripts/lib/fetch-rss.mjs";

describe("source provenance", () => {
  it("does not treat Google News query labels as publishers", () => {
    const item = deriveNewsProvenance({
      title: "測試新聞",
      link: "https://news.google.com/rss/articles/example?oc=5",
      source: "GN 詐騙逮捕",
      sourceUrl: "https://news.google.com/rss/search?q=詐騙逮捕%20when%3A5d&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
      publisherName: "自由時報",
      publisherUrl: "https://news.ltn.com.tw/",
    });

    expect(item.name).toBe("自由時報");
    expect(item.publisherName).toBe("自由時報");
    expect(item.aggregatorName).toBe("Google News");
    expect(item.ingestMethod).toBe("google-news-rss");
    expect(item.sourceConfidence).toBe("aggregated");
    expect(item.query).toContain("GN 詐騙逮捕");
  });

  it("falls back to Google News 聚合 when publisher is unavailable", () => {
    const item = deriveNewsProvenance({
      title: "測試新聞",
      link: "https://news.google.com/rss/articles/example?oc=5",
      source: "GN 假投資假交友",
      sourceUrl: "https://news.google.com/rss/search?q=假投資%20when%3A5d&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
    });

    expect(item.name).toBe("Google News 聚合");
    expect(item.name.startsWith("GN ")).toBe(false);
    expect(item.aggregatorName).toBe("Google News");
    expect(item.query).toContain("GN 假投資假交友");
  });
});
