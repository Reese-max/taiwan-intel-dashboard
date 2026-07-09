import { describe, expect, it } from "vitest";

import {
  clusterPopupHtml,
  eventFocusHash,
  isMapDisplayable,
  isClusterTapGesture,
  mapEmptyLabel,
  mapPopupHtml,
  markerClass,
} from "../src/components/MapView";
import type { IntelEvent } from "../src/types/event";

const EVENT: IntelEvent = {
  id: "twnews-map-test",
  title: "測試新聞",
  region: "臺北市",
  lat: 25.03,
  lng: 121.56,
  locationPrecision: "city",
  timestamp: "2026-06-27T00:00:00.000Z",
  category: "治安",
  scope: "domestic",
  riskLevel: "high",
  summary: "摘要",
  source: {
    name: "Google News 聚合",
    type: "news-rss",
    url: "https://news.google.com/rss/articles/example?oc=5",
    fetchedAt: "2026-06-27T00:00:00.000Z",
    aggregatorName: "Google News",
    sourceConfidence: "aggregated",
  },
};

describe("MapView helpers", () => {
  it("shows source chain and location precision in popup html", () => {
    const html = mapPopupHtml(EVENT);

    expect(html).toContain("來源：Google News 聚合");
    expect(html).toContain("建議：先查證原文再行動｜聚合來源待核");
    expect(html).toContain("經由：Google News");
    expect(html).toContain("定位：縣市推論");
    expect(html).toContain('href="#scope=domestic&amp;focus=twnews-map-test"');
    expect(html).toContain("查看關聯網");
  });

  it("adds marker classes for aggregated and inferred points", () => {
    expect(markerClass("high", EVENT)).toContain("source-aggregated");
    expect(markerClass("high", EVENT)).toContain("loc-city");
  });

  it("does not display global 0,0 events as normal map points", () => {
    expect(isMapDisplayable({ ...EVENT, lat: 0, lng: 0, locationPrecision: "global" })).toBe(false);
    expect(isMapDisplayable(EVENT)).toBe(true);
  });

  it("explains empty map states without implying data load failure", () => {
    expect(mapEmptyLabel(0, 0)).toBe("目前條件沒有可標示的地圖點，請改看列表或放寬篩選。");
    expect(mapEmptyLabel(3, 0)).toBe("這批事件缺少可標示座標，請改看列表或放寬地理條件。");
    expect(mapEmptyLabel(3, 2)).toBe("");
  });

  it("shows readable event summaries for clustered map points", () => {
    const html = clusterPopupHtml([
      EVENT,
      {
        ...EVENT,
        id: "twnews-map-test-2",
        title: "第二則測試新聞",
        region: "新北市",
        riskLevel: "medium",
        source: { ...EVENT.source, publisherName: "測試媒體" },
      },
    ]);

    expect(html).toContain("此區有 2 則情報");
    expect(html).toContain("此區風險構成");
    expect(html).toContain("高 1");
    expect(html).toContain("中 1");
    expect(html).toContain("放大拆分");
    expect(html).toContain("查看最高風險");
    expect(html).toContain("測試新聞");
    expect(html).toContain("第二則測試新聞");
    expect(html).toContain("臺北市｜治安");
    expect(html).toContain('href="#scope=domestic&amp;focus=twnews-map-test"');
    expect(html).toContain("查看");
  });

  it("keeps large cluster popups compact", () => {
    const longTitle = "這是一個非常非常長的地圖聚合事件標題用來確認手機版泡泡不會塞滿整個畫面";
    const html = clusterPopupHtml([
      { ...EVENT, id: "critical-long", title: longTitle, riskLevel: "critical" },
      { ...EVENT, id: "high-2", title: "第二高風險事件", riskLevel: "high" },
      { ...EVENT, id: "medium-3", title: "第三則不應直接展開", riskLevel: "medium" },
      { ...EVENT, id: "low-4", title: "第四則不應直接展開", riskLevel: "low" },
    ]);

    const renderedTitles = html.match(/<span class="map-cluster-title" title="[^"]+">([^<]+)<\/span>/g) ?? [];
    const firstTitle = renderedTitles[0]?.match(/>([^<]+)<\/span>/)?.[1] ?? "";

    expect(renderedTitles).toHaveLength(2);
    expect(firstTitle).toMatch(/…$/);
    expect(firstTitle).not.toBe(longTitle);
    expect(html).toContain(`title="${longTitle}"`);
    expect(html).toContain("另有 2 則，放大後再拆讀。");
    expect(html).not.toContain("第三則不應直接展開");
    expect(html).not.toContain("第四則不應直接展開");
  });

  it("builds focus hashes from event scope and id", () => {
    expect(eventFocusHash(EVENT)).toBe("#scope=domestic&focus=twnews-map-test");
  });

  it("distinguishes cluster taps from drag gestures", () => {
    expect(isClusterTapGesture({ x: 120, y: 200, at: 1000 }, { x: 127, y: 205, at: 1150 })).toBe(true);
    expect(isClusterTapGesture({ x: 120, y: 200, at: 1000 }, { x: 152, y: 218, at: 1150 })).toBe(false);
    expect(isClusterTapGesture({ x: 120, y: 200, at: 1000 }, { x: 123, y: 204, at: 1900 })).toBe(false);
  });
});
