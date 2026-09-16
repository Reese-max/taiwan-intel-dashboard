import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { locationSearchLink } from "../src/utils/locationLink";
import { eventCard } from "../src/components/EventCard";
import type { IntelEvent } from "../src/types/event";

const event = (fields: Partial<IntelEvent> = {}): IntelEvent => ({
  id: "sample", title: "示範新聞", summary: "示範摘要", region: "臺北市", category: "治安",
  scope: "domestic", riskLevel: "medium", timestamp: "2026-09-16T08:00:00Z",
  source: { name: "來源甲", type: "news-rss", fetchedAt: "2026-09-16T09:00:00Z", url: "https://example.com/news" },
  ...fields,
});
const query = (e: IntelEvent) => new URL(locationSearchLink(e)!.href).searchParams.get("query");

describe("安全且誠實的地點連結", () => {
  it("來源明示 exact／address 且座標有效才開啟數值座標", () => {
    for (const locationPrecision of ["exact", "address"] as const) {
      const e = event({ locationPrecision, lat: 25.03, lng: 121.56 });
      assert.equal(locationSearchLink(e)?.kind, "coordinates");
      assert.equal(query(e), "25.03,121.56");
    }
  });
  it("行政區／縣市／國家中心只查區域，不冒充案發點", () => {
    for (const locationPrecision of ["district", "city", "country", "unknown"] as const) {
      const e = event({ locationPrecision, lat: 25.03, lng: 121.56 });
      assert.equal(locationSearchLink(e)?.kind, "region");
      assert.equal(query(e), "臺灣 臺北市");
      assert.match(locationSearchLink(e)!.label, /非案發點/);
    }
  });
  it("沒有 precision 時，存在座標仍不升格精準定位", () => {
    assert.equal(locationSearchLink(event({ lat: 25.03, lng: 121.56 }))?.kind, "region");
  });
  it("NaN、Infinity、越界、字串、佔位座標一律不產生座標連結", () => {
    for (const [lat, lng] of [[NaN, 121], [25, Infinity], [91, 121], [25, 181], [0, 0], ["25", 121]]) {
      const e = event({ locationPrecision: "exact", lat: lat as number, lng: lng as number });
      assert.equal(locationSearchLink(e)?.kind, "region");
    }
  });
  it("赤道等合法單一零座標可使用，不能把所有零值都拒絕", () => {
    assert.equal(query(event({ locationPrecision: "exact", lat: 0, lng: 121 })), "0,121");
  });
  it("未知／全國／全球不猜地點", () => {
    for (const region of ["", "全國", "未知", "-", "全球", "N/A"]) {
      assert.equal(locationSearchLink(event({ region })), null);
    }
    assert.equal(locationSearchLink(event({ locationPrecision: "global", lat: 25, lng: 121 })), null);
  });
  it("國際區域查詢不加入臺灣前綴", () => {
    assert.equal(query(event({ region: "東京都", scope: "international" })), "東京都");
  });
  it("網址固定 Google Maps，特殊字元只能成為已編碼 query", () => {
    const region = '臺北市"><script>\'&query=else';
    const url = new URL(locationSearchLink(event({ region }))!.href);
    assert.equal(url.origin, "https://www.google.com");
    assert.equal(url.pathname, "/maps/search/");
    assert.equal(url.searchParams.get("api"), "1");
    assert.deepEqual(url.searchParams.getAll("query"), [`臺灣 ${region}`]);
  });
  it("不截斷過長地名，不送新聞全文或標題當查詢", () => {
    assert.equal(locationSearchLink(event({ region: "甲".repeat(161) })), null);
    assert.ok(!locationSearchLink(event())!.href.includes("示範"));
  });
  it("事件卡片同時保留原文、關聯按鈕與地點連結", () => {
    const html = eventCard(event(), 3);
    assert.match(html, /location-link/);
    assert.match(html, /查詢區域（非案發點）/);
    assert.match(html, /https:\/\/example.com\/news/);
    assert.match(html, /data-rel="sample"/);
    assert.match(html, /rel="noopener noreferrer"/);
  });
  it("卡片地點文字安全轉義，不能注入 HTML", () => {
    const html = eventCard(event({ region: '<img src=x onerror="bad">' }));
    assert.ok(!html.includes("<img"));
    assert.ok(html.includes("&lt;img"));
  });
  it("沒有可查地點仍保留新聞卡片與原文", () => {
    const html = eventCard(event({ region: "未知" }));
    assert.ok(!html.includes('class="location-link'));
    assert.ok(html.includes("示範新聞"));
    assert.ok(html.includes("https://example.com/news"));
  });
});
