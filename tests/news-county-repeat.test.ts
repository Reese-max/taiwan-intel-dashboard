import { describe, expect, it } from "vitest";
import { detectCounty, detectCountyInBody, mapBulkNews } from "../scripts/lib/news-bulk.mjs";

describe("A：重複短名與無括號署名", () => {
  it("國1民雄事故由署名後的嘉義民雄路段判為縣", () => {
    const title = "國1民雄段聯結車疑爆胎翻覆! 後方4車追撞釀2死2傷";
    const description = "南部中心／鄭榮文、郭佩綺嘉義報導31號凌晨國道1號北上嘉義民雄路段，發生一起追撞連環車禍…";
    expect(detectCountyInBody(description).region).toBe("嘉義縣");
    expect(mapBulkNews([{ title, description, link: "https://example.test/a", source: "測試", hint: "交通", pubDate: "2026-11-04T00:00:00Z" }])[0].region).toBe("嘉義縣");
  });
  it.each([
    ["嘉義傳出事故，後續確認為嘉義民雄路段", "嘉義縣"],
    ["新竹傳出事故，後續確認為新竹湖口工廠", "新竹縣"],
    ["嘉義市傳出事故，嘉義民雄警消支援", "嘉義市"],
    ["竹市傳出事故，新竹湖口警消支援", "新竹市"],
    ["新竹發生事故，後續確認為新竹寶山路", "新竹市"],
    ["嘉義傳出事故，嘉義市民雄路車禍", "嘉義市"],
    ["嘉義東石路段車禍", "嘉義縣"],
  ])("每次命中獨立判斷：%s", (text, region) => expect(detectCounty(text).region).toBe(region));
  it("剝除無括號署名，沒有本文地點時仍可回退署名", () => {
    expect(detectCountyInBody("南部中心／鄭榮文、郭佩綺嘉義報導高雄市發生事故").region).toBe("高雄市");
    expect(detectCountyInBody("南部中心／鄭榮文、郭佩綺嘉義報導事故仍在調查").region).toBe("嘉義市");
  });
});
