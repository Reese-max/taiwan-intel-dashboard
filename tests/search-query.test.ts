import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "../src/search-query";

describe("自然語句搜尋解析", () => {
  it("解析時間、填充詞並擴充電信主題", () => {
    const parsed = parseSearchQuery("最近的電信新聞");
    expect(parsed.raw).toBe("最近的電信新聞");
    expect(parsed.windowDays).toBe(7);
    expect(parsed.terms).toEqual(["電信"]);
    expect(parsed.expanded).toEqual(expect.arrayContaining(["電信", "中華電信", "5G"]));
    expect(new Set(parsed.expanded).size).toBe(parsed.expanded.length);
  });

  it.each([
    ["近3天 毒品", 3], ["颱風", null], ["今天地震", 1], ["今日地震", 1],
    ["昨天火災", 2], ["近期資安", 7], ["這幾天交通", 7], ["本週交通", 7],
    ["這週交通", 7], ["這禮拜交通", 7], ["本月停電", 30], ["這個月食安", 30],
    ["5天內疫情", 5], ["近99天國防", 30], ["近0天國防", 1],
  ])("%s 的時間窗為 %s", (query, days) => {
    expect(parseSearchQuery(query).windowDays).toBe(days);
  });

  it("切開標點、空白與語句填充詞，保留一般關鍵字", () => {
    expect(parseSearchQuery("幫我查一下 電信、資安 有哪些相關消息？").terms).toEqual(["電信", "資安"]);
    expect(parseSearchQuery("查獲毒品").terms).toEqual(["查獲毒品"]);
    expect(parseSearchQuery(" ").expanded).toEqual([]);
  });

  it("媒體名稱裡的時間詞與填充詞不被拆掉", () => {
    expect(parseSearchQuery("今日新聞")).toMatchObject({ terms: ["今日新聞"], windowDays: null });
    expect(parseSearchQuery("NOWnews今日新聞 毒品")).toMatchObject({ terms: ["NOWnews今日新聞", "毒品"], windowDays: null });
    expect(parseSearchQuery("今日 毒品").windowDays).toBe(1);
  });
});
