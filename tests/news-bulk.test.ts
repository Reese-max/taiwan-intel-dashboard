import { describe, it, expect } from "vitest";
import { mapBulkNews, titleKey, cleanTitle } from "../scripts/lib/news-bulk.mjs";

const FETCHED_AT = "2026-06-20T00:00:00.000Z";

const ITEMS = [
  { title: "高雄街頭砍人 男子背部受傷送醫 - 自由時報", link: "https://x/1", description: "街頭鬥毆", source: "自由時報 社會", sourceUrl: "u1", hint: "治安", pubDate: "Fri, 20 Jun 2026 01:00:00 +0800" },
  { title: "新北詐騙集團車手落網", link: "https://news.google.com/rss/articles/2?oc=5", description: "假檢警詐騙", source: "GN 詐騙逮捕", sourceUrl: "https://news.google.com/rss/search?q=詐騙逮捕", hint: "反詐", pubDate: "Fri, 20 Jun 2026 02:00:00 +0800" },
  { title: "台南工廠火警濃煙竄天", link: "https://news.google.com/rss/articles/3?oc=5", description: "消防搶救", source: "GN 火警氣爆", sourceUrl: "https://news.google.com/rss/search?q=火警氣爆", hint: "災防", pubDate: "Fri, 20 Jun 2026 03:00:00 +0800" },
  // 重複標題（不同連結/媒體）→ 去重
  { title: "高雄街頭砍人 男子背部受傷送醫 - ETtoday", link: "https://x/4", description: "...", source: "GN 傷害鬥毆", sourceUrl: "u4", hint: "治安", pubDate: "x" },
];

describe("titleKey / cleanTitle", () => {
  it("strips media suffix for dedup key and display", () => {
    expect(cleanTitle("高雄街頭砍人 - 自由時報")).toBe("高雄街頭砍人");
    expect(titleKey("高雄街頭砍人 - 自由時報")).toBe(titleKey("高雄街頭砍人 - ETtoday"));
  });
});

describe("mapBulkNews", () => {
  it("dedupes by title, classifies by hint, geocodes by county, scores risk", () => {
    const ev = mapBulkNews(ITEMS, { fetchedAt: FETCHED_AT });
    expect(ev).toHaveLength(3); // 去重後 3
    const ks = ev.find((e) => e.title.includes("砍人"));
    expect(ks!.region).toBe("高雄市");
    expect(ks!.lat).toBeCloseTo(22.6273, 2);
    expect(ks!.category).toBe("治安");
    expect(ks!.riskLevel).toBe("high"); // 砍人
    expect(ks!.scope).toBe("domestic");
    expect(ks!.source.datasetId).toBe("tw-news");

    const fraud = ev.find((e) => e.title.includes("車手"));
    expect(fraud!.region).toBe("新北市");
    expect(fraud!.category).toBe("反詐");
    expect(fraud!.riskLevel).toBe("medium"); // 詐騙
    expect(fraud!.source.name.startsWith("GN ")).toBe(false);
    expect(fraud!.source.aggregatorName).toBe("Google News");
    expect(fraud!.locationPrecision).toBe("city");

    const fire = ev.find((e) => e.title.includes("火警"));
    expect(fire!.region).toBe("臺南市");
    expect(fire!.category).toBe("災防");
  });

  it("excludes titles already enriched", () => {
    const exclude = new Set([titleKey("高雄街頭砍人 男子背部受傷送醫 - 自由時報")]);
    const ev = mapBulkNews(ITEMS, { fetchedAt: FETCHED_AT, excludeKeys: exclude });
    expect(ev.find((e) => e.title.includes("砍人"))).toBeUndefined();
    expect(ev).toHaveLength(2);
  });

  it("filters out non-police items (health/culture/policy noise)", () => {
    const noise = [
      { title: "癌症篩檢抽大獎 嘉義縣送iPhone 17", link: "https://x/a", description: "鼓勵民眾顧健康", source: "s", sourceUrl: "u", hint: "治安", pubDate: "x" },
      { title: "新北市躋身全球幸福城市前50名", link: "https://x/b", description: "英國評比", source: "s", sourceUrl: "u", hint: "治安", pubDate: "x" },
      { title: "高雄街頭砍人送醫", link: "https://x/c", description: "", source: "s", sourceUrl: "u", hint: "治安", pubDate: "x" },
    ];
    const ev = mapBulkNews(noise, { fetchedAt: FETCHED_AT });
    expect(ev).toHaveLength(1); // 只留砍人
    expect(ev[0].title).toContain("砍人");
  });

  it("falls back to 全國 with null coords when no county in title", () => {
    const ev = mapBulkNews(
      [{ title: "立委質詢打詐成效", link: "https://x/9", description: "", source: "s", sourceUrl: "u", hint: "反詐", pubDate: "x" }],
      { fetchedAt: FETCHED_AT },
    );
    expect(ev[0].region).toBe("全國");
    expect(ev[0].lat).toBeNull();
  });
});
