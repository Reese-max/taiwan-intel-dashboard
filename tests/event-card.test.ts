import { describe, expect, it } from "vitest";
import { eventCard } from "../src/components/EventCard";
import type { IntelEvent } from "../src/types/event";

describe("eventCard", () => {
  it("呈現事件的完整來源與脈絡欄位", () => {
    const event: IntelEvent = {
      id: "evt-1",
      title: "詐騙網站新增通報",
      region: "臺北市",
      timestamp: "2026-06-20T10:00:00+08:00",
      category: "反詐",
      scope: "domestic",
      riskLevel: "high",
      summary: "165 通報新增涉詐網站。",
      source: {
        name: "165反詐騙 涉詐網站停解析",
        type: "gov-open-data",
        datasetId: "176455",
        recordRef: "row-9",
        url: "https://data.gov.tw/dataset/176455",
        fetchedAt: "2026-06-20T23:00:00+08:00",
        query: "query_rows 176455",
      },
    };

    const html = eventCard(event, 3);

    expect(html).toContain("完整脈絡");
    expect(html).toContain("資料時間");
    expect(html).toContain("擷取時間");
    expect(html).toContain("開放資料");
    expect(html).toContain("<b>資料集</b>176455");
    expect(html).toContain("<b>原始編號</b>row-9");
    // 標籤不應重複（修正前曾誤輸出「資料集 資料集」「原始編號 原始編號」）
    expect(html).not.toContain("資料集 資料集");
    expect(html).not.toContain("原始編號 原始編號");
    expect(html).toContain("可重現查詢");
    expect(html).toContain("關聯 3");
  });

  it("shows Google News as aggregator, not query label source", () => {
    const html = eventCard({
      id: "twnews-test",
      title: "測試新聞",
      region: "臺北市",
      lat: 25.03,
      lng: 121.56,
      locationPrecision: "city",
      timestamp: "2026-06-27T00:00:00.000Z",
      category: "治安",
      scope: "domestic",
      riskLevel: "medium",
      summary: "摘要",
      source: {
        name: "Google News 聚合",
        type: "news-rss",
        datasetId: "tw-news",
        recordRef: "https://news.google.com/rss/articles/example?oc=5",
        url: "https://news.google.com/rss/articles/example?oc=5",
        fetchedAt: "2026-06-27T00:00:00.000Z",
        query: "GN 詐騙逮捕｜RSS https://news.google.com/rss/search?q=x",
        aggregatorName: "Google News",
        ingestMethod: "google-news-rss",
        sourceConfidence: "aggregated",
      },
    });

    expect(html).toContain("Google News 聚合");
    expect(html).toContain("經由");
    expect(html).toContain("縣市推論");
    expect(html).not.toContain(">GN 詐騙逮捕<");
  });
});
