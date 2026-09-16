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
        datasetId: "13166",
        recordRef: "row-9",
        url: "https://data.gov.tw/dataset/13166",
        fetchedAt: "2026-06-20T23:00:00+08:00",
        query: "data.gov.tw 13166 ZIP",
      },
    };

    const html = eventCard(event, 3);

    expect(html).toContain("完整脈絡");
    expect(html).toContain("行動判斷");
    expect(html).toContain("查證依據");
    expect(html).toContain("原始資料");
    expect(html.match(/class="event-context /g)).toHaveLength(1);
    expect(html).toContain("<b>建議</b>");
    expect(html).toContain("金流／帳戶");
    expect(html).toContain("避免匯款並核對來源");
    expect(html).toContain("資料時間");
    expect(html).toContain("擷取時間");
    expect(html).toContain("開放資料");
    expect(html).toContain("<b>資料集</b>13166");
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

  it("legacy confirmed input renders an unverified candidate chip, not proof", () => {
    const html = eventCard(
      {
        id: "confirmed",
        title: "同案多源報導",
        region: "臺北市",
        timestamp: "2026-06-27T00:00:00.000Z",
        category: "治安",
        scope: "domestic",
        riskLevel: "high",
        summary: "摘要",
        source: {
          name: "來源A",
          type: "news-rss",
          fetchedAt: "2026-06-27T00:00:00.000Z",
        },
      },
      0,
      undefined,
      { sources: 3, channels: 3, confirmed: true },
    );

    expect(html).toContain("candidate-source-note");
    expect(html).toContain("多來源線索（3 個標記）·待查證");
    expect(html).toContain("先查證原文再行動");
    expect(html).not.toContain("✓ 3 源佐證");
    expect(html).not.toContain("corroboration-chip");
    expect(html).not.toContain("單一來源·待查證");
  });

  it("multi-channel single-publisher event renders a channel chip instead of confirmed", () => {
    const html = eventCard(
      {
        id: "multi-channel",
        title: "多管道收錄報導",
        region: "臺北市",
        timestamp: "2026-06-27T00:00:00.000Z",
        category: "治安",
        scope: "domestic",
        riskLevel: "high",
        summary: "摘要",
        source: {
          name: "中央社 RSS",
          publisherName: "中央社",
          type: "news-rss",
          fetchedAt: "2026-06-27T00:00:00.000Z",
        },
      },
      0,
      undefined,
      { sources: 1, channels: 2, confirmed: false, isMultiChannel: true },
    );

    expect(html).toContain("channel-chip");
    expect(html).toContain("多管道收錄（2 管道）·待查證");
    expect(html).not.toContain("源佐證");
    expect(html).not.toContain("單一來源·待查證");
  });

  it("high-risk single-source event renders a subtle verification note", () => {
    const html = eventCard(
      {
        id: "single",
        title: "高風險孤證",
        region: "臺北市",
        timestamp: "2026-06-27T00:00:00.000Z",
        category: "治安",
        scope: "domestic",
        riskLevel: "critical",
        summary: "摘要",
        source: {
          name: "來源A",
          type: "news-rss",
          fetchedAt: "2026-06-27T00:00:00.000Z",
        },
      },
      0,
      undefined,
      { sources: 1, channels: 1, confirmed: false },
    );

    expect(html).toContain("single-source-note");
    expect(html).toContain("單一來源·待查證");
    expect(html).not.toContain("corroboration-chip");
  });

  it("高風險聚合新聞會要求先查證原文，而不是直接行動", () => {
    const html = eventCard({
      id: "agg-risk",
      title: "疑似詐騙集團大量投放釣魚簡訊",
      region: "臺北市",
      timestamp: "2026-06-27T00:00:00.000Z",
      category: "反詐",
      scope: "domestic",
      riskLevel: "high",
      summary: "多名民眾回報金融帳戶釣魚簡訊。",
      source: {
        name: "Google News 聚合",
        type: "news-rss",
        fetchedAt: "2026-06-27T00:00:00.000Z",
        sourceConfidence: "aggregated",
      },
    });

    expect(html).toContain("先查證原文再行動");
    expect(html).toContain("聚合來源待核");
    expect(html).toContain("金流／帳戶");
  });

  it("低對台關聯的國際高風險事件只做背景觀察", () => {
    const html = eventCard({
      id: "intl-low",
      title: "海外科技公司股價大跌",
      region: "美國",
      timestamp: "2026-06-27T00:00:00.000Z",
      category: "金融",
      scope: "international",
      riskLevel: "high",
      twRelevance: 10,
      summary: "海外市場波動，對台供應鏈關聯低。",
      source: {
        name: "國際新聞",
        type: "news-rss",
        fetchedAt: "2026-06-27T00:00:00.000Z",
      },
    });

    expect(html).toContain("國際｜低對台關聯 10｜金流／帳戶");
    expect(html).toContain("背景觀察，不升級");
  });

  it("高對台關聯的國際重大事件列入重點追蹤", () => {
    const html = eventCard({
      id: "intl-critical",
      title: "區域衝突升溫影響半導體供應鏈",
      region: "東亞",
      timestamp: "2026-06-27T00:00:00.000Z",
      category: "地緣政治",
      scope: "international",
      riskLevel: "critical",
      twRelevance: 85,
      summary: "區域軍事衝突可能影響航運與供應鏈。",
      implications: "可能影響台灣出口、能源與晶片供應鏈。",
      source: {
        name: "國際新聞",
        type: "news-rss",
        fetchedAt: "2026-06-27T00:00:00.000Z",
      },
    });

    expect(html).toContain("國際｜高對台關聯 85｜外交／供應鏈");
    expect(html).toContain("列入重點追蹤");
    expect(html).toContain("已有影響評估");
  });

  it("renders temporal badges for historical and judicial events only", () => {
    const base: IntelEvent = {
      id: "temporal",
      title: "測試事件",
      region: "臺北市",
      timestamp: "2026-06-27T00:00:00.000Z",
      category: "治安",
      scope: "domestic",
      riskLevel: "medium",
      summary: "摘要",
      source: {
        name: "來源A",
        type: "news-rss",
        fetchedAt: "2026-06-27T00:00:00.000Z",
      },
    };

    expect(eventCard({ ...base, temporal: "historical" })).toContain("歷史資料");
    expect(eventCard({ ...base, temporal: "judicial" })).toContain("司法結果");
    expect(eventCard(base)).not.toContain("temporal-badge");
  });

  it("零關聯或關聯失敗降級時不顯示破裂按鈕，保留原文連結與完整卡片資訊", () => {
    const event: IntelEvent = {
      id: "no-rel",
      title: "獨立事件新聞",
      region: "新北市",
      timestamp: "2026-06-27T00:00:00.000Z",
      category: "治安",
      scope: "domestic",
      riskLevel: "medium",
      summary: "內容摘要",
      source: {
        name: "中央社",
        type: "news-rss",
        url: "https://www.cna.com.tw/news/123",
        fetchedAt: "2026-06-27T00:00:00.000Z",
      },
    };

    const html = eventCard(event, 0);
    expect(html).not.toContain("🔗 關聯");
    expect(html).toContain("https://www.cna.com.tw/news/123");
    expect(html).toContain("獨立事件新聞");
    expect(html).toContain("新北市");
  });

  it("卡片分開三個動作：本頁定位、查看此區新聞、外部地圖，無座標時保留新聞閱讀", () => {
    const fullLocEvent: IntelEvent = {
      id: "loc-test-1",
      title: "台北車站周邊巡邏",
      region: "臺北市中正區",
      lat: 25.0478,
      lng: 121.517,
      locationPrecision: "district",
      timestamp: "2026-06-27T00:00:00.000Z",
      category: "治安",
      scope: "domestic",
      riskLevel: "medium",
      summary: "內容摘要",
      source: {
        name: "中央社",
        type: "news-rss",
        fetchedAt: "2026-06-27T00:00:00.000Z",
      },
    };

    const htmlFull = eventCard(fullLocEvent, 0);
    expect(htmlFull).toContain("locate-on-page-btn");
    expect(htmlFull).toContain('data-locate="loc-test-1"');
    expect(htmlFull).toContain("📍 本頁定位");
    expect(htmlFull).toContain("filter-region-btn");
    expect(htmlFull).toContain('data-filter-region="臺北市中正區"');
    expect(htmlFull).toContain("🔍 查看此區新聞");
    expect(htmlFull).toContain("location-link");
    expect(htmlFull).toContain("google.com/maps");
    expect(htmlFull).toContain("查詢區域");

    // 缺少座標：不顯示本頁定位，但若有具體行政區仍可看此區新聞
    const noCoordEvent: IntelEvent = {
      ...fullLocEvent,
      id: "no-coord",
      lat: undefined,
      lng: undefined,
    };
    const htmlNoCoord = eventCard(noCoordEvent, 0);
    expect(htmlNoCoord).not.toContain("locate-on-page-btn");
    expect(htmlNoCoord).toContain("filter-region-btn");
    expect(htmlNoCoord).toContain("台北車站周邊巡邏");

    // 概略/籠統位置（如全國、台灣）：不提供地區過濾按鈕，保留新聞閱讀
    const vagueEvent: IntelEvent = {
      ...fullLocEvent,
      id: "vague-loc",
      region: "全國",
      lat: undefined,
      lng: undefined,
      locationPrecision: "global",
    };
    const htmlVague = eventCard(vagueEvent, 0);
    expect(htmlVague).not.toContain("locate-on-page-btn");
    expect(htmlVague).not.toContain("filter-region-btn");
    expect(htmlVague).toContain("全國");
    expect(htmlVague).toContain("台北車站周邊巡邏");
  });
});
