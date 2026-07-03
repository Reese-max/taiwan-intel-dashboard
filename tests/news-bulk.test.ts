import { describe, it, expect } from "vitest";
import { mapBulkNews, titleKey, cleanTitle, isRelevantNewsItem } from "../scripts/lib/news-bulk.mjs";

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

describe("isRelevantNewsItem（hint 分派主題漏斗）", () => {
  const mk = (title: string, hint: string, description = "") => ({
    title,
    hint,
    description,
    link: "https://x/t",
    source: "s",
    sourceUrl: "u",
    pubDate: "x",
  });

  it("食安 hint 用食安關鍵字（不再被警政漏斗擋掉）", () => {
    expect(isRelevantNewsItem(mk("知名餐廳使用餿水油遭勒令下架", "食安"))).toBe(true);
    expect(isRelevantNewsItem(mk("農委會推廣有機農業補助說明會", "食安"))).toBe(false);
  });

  it("衛生 hint 用衛生關鍵字", () => {
    expect(isRelevantNewsItem(mk("腸病毒疫情升溫 幼兒園爆群聚", "衛生"))).toBe(true);
    expect(isRelevantNewsItem(mk("醫院擴建工程動土典禮", "衛生"))).toBe(false);
  });

  it("環境 hint 用環境關鍵字", () => {
    expect(isRelevantNewsItem(mk("電鍍廠偷排廢水遭裁罰百萬", "環境"))).toBe(true);
    expect(isRelevantNewsItem(mk("公園綠美化志工招募", "環境"))).toBe(false);
  });

  it("資安 hint 用資安關鍵字", () => {
    expect(isRelevantNewsItem(mk("駭客入侵上市公司 個資外洩百萬筆", "資安"))).toBe(true);
    expect(isRelevantNewsItem(mk("新款筆電開箱評測", "資安"))).toBe(false);
  });

  it("未列 TOPIC_RE 的 hint 照舊走警政漏斗（回歸保護）", () => {
    expect(isRelevantNewsItem(mk("高雄街頭砍人送醫", "治安"))).toBe(true);
    expect(isRelevantNewsItem(mk("新北市躋身全球幸福城市前50名", "治安"))).toBe(false);
    expect(isRelevantNewsItem(mk("台南工廠火警濃煙竄天 消防搶救", "災防"))).toBe(true);
  });
});

describe("mapBulkNews 新主題分類", () => {
  it("食安/環境/資安 item 入庫且歸到自己的分類", () => {
    const items = [
      {
        title: "台中查獲黑心食品工廠",
        link: "https://x/f1",
        description: "",
        source: "GN 食安黑心",
        sourceUrl: "u",
        hint: "食安",
        pubDate: "x",
      },
      {
        title: "高雄工廠偷排廢水遭稽查裁罰",
        link: "https://x/e1",
        description: "",
        source: "環境部官網",
        sourceUrl: "u",
        hint: "環境",
        pubDate: "x",
      },
      {
        title: "勒索病毒攻擊醫院系統 個資外洩",
        link: "https://x/c1",
        description: "",
        source: "TechNews",
        sourceUrl: "u",
        hint: "資安",
        pubDate: "x",
      },
    ];
    const ev = mapBulkNews(items, { fetchedAt: FETCHED_AT });
    expect(ev).toHaveLength(3);
    expect(ev.find((e) => e.title.includes("黑心"))!.category).toBe("食安");
    expect(ev.find((e) => e.title.includes("廢水"))!.category).toBe("環境");
    expect(ev.find((e) => e.title.includes("勒索病毒"))!.category).toBe("資安");
  });
});

describe("EN 來源支援（Focus Taiwan / Taipei Times）", () => {
  const mk = (title: string) => ({ title, hint: "治安", description: "", link: "https://x/en", source: "Focus Taiwan (EN)", sourceUrl: "u", pubDate: "x" });

  it("英文警政標題通過相關性漏斗", () => {
    expect(isRelevantNewsItem(mk("Police arrest fraud ring leader in Taipei"))).toBe(true);
    expect(isRelevantNewsItem(mk("Drug smuggling suspects detained at port"))).toBe(true);
    expect(isRelevantNewsItem(mk("Taiwan shares close higher on tech gains"))).toBe(false);
  });

  it("英文標題風險評級正確（不再全判 low）", () => {
    const ev = mapBulkNews(
      [
        { ...mk("Man killed in Kaohsiung shooting incident"), link: "https://x/en1" },
        { ...mk("Police arrest fraud suspects in Taichung"), link: "https://x/en2" },
      ],
      { fetchedAt: FETCHED_AT },
    );
    expect(ev.find((e) => e.title.includes("killed"))!.riskLevel).toBe("high");
    expect(ev.find((e) => e.title.includes("fraud"))!.riskLevel).toBe("medium");
  });
});
