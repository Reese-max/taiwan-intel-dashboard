import { describe, expect, it } from "vitest";

import {
  clusterPopupHtml,
  eventFocusHash,
  isMapDisplayable,
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
    expect(html).toContain("測試新聞");
    expect(html).toContain("第二則測試新聞");
    expect(html).toContain("臺北市｜治安");
    expect(html).toContain("來源：測試媒體");
    expect(html).toContain("放大地圖可拆分重疊標點");
    expect(html).toContain('href="#scope=domestic&amp;focus=twnews-map-test"');
    expect(html).toContain("查看");
  });

  it("builds focus hashes from event scope and id", () => {
    expect(eventFocusHash(EVENT)).toBe("#scope=domestic&focus=twnews-map-test");
  });
});
