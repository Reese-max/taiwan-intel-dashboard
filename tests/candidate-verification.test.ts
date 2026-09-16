import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { corroborationOf, candidateSourceLabel, type CorroborationResult } from "../src/utils/corroboration";
import { getActionDecision } from "../src/utils/actionDecision";
import { eventCard } from "../src/components/EventCard";
import { NetworkIndex, edgeTypeLabel, type EdgeType } from "../src/data/network";
import type { IntelEvent } from "../src/types/event";

const event = (id: string, fields: Partial<IntelEvent> = {}): IntelEvent => ({
  id, title: `測試公開事件 ${id}`, summary: "僅為合成測試，不是實際案件。", region: "臺北市",
  timestamp: "2026-09-16T10:00:00Z", category: "治安", scope: "domestic", riskLevel: "high",
  lat: 25.03, lng: 121.56, locationPrecision: "city",
  source: { name: id, publisherName: id, type: "news-rss", url: `https://${id}.example/news/1`, fetchedAt: "2026-09-16T10:00:00Z" },
  ...fields,
});
const network = (type: EdgeType = "same-incident", extra: string[] = []): NetworkIndex => new NetworkIndex({
  edges: ["b", ...extra].map((b) => ({ a: "a", b, type, weight: 1.2, why: "同事件候選（仍需查證）" })),
  clusters: [], stats: {},
});
const resultFor = (events: IntelEvent[], net = network()): CorroborationResult =>
  corroborationOf("a", new Map(events.map((e) => [e.id, e])), net);

// Existing raw/source counting stays compatible. These tests govern verification,
// not independence of messages, ground-truth accuracy, or automatic collapse.
describe("候選關聯與查證分離（Issue #36）", () => {
  it("兩個發布者仍是未查證候選，保留來源與管道計數", () => {
    const r = resultFor([event("a"), event("b")]);
    assert.equal(r.sources, 2); assert.equal(r.channels, 2);
    assert.equal(r.confirmed, false); assert.equal(r.verification, "unverified");
  });
  it("增加到三個來源也不會自動升格", () => {
    const r = resultFor([event("a"), event("b"), event("c")], network("same-incident", ["c"]));
    assert.equal(r.sources, 3); assert.equal(r.confirmed, false);
    assert.equal(r.verification, "unverified");
  });
  it("缺少目標事件明示 unverified，不產生成功結論", () => {
    const r = resultFor([]);
    assert.equal(r.confirmed, false); assert.equal(r.verification, "unverified");
  });
  it("同稿多管道保留既有 URL 去重，不冒充獨立證據", () => {
    const a = event("a"), b = event("b");
    a.source.url = "https://news.example/story/1?utm_source=direct";
    b.source.url = "https://news.example/story/1?utm_source=aggregate";
    const r = resultFor([a, b]);
    assert.equal(r.sources, 1); assert.equal(r.channels, 2);
    assert.equal(r.isMultiChannel, true); assert.equal(r.confirmed, false);
    assert.match(candidateSourceLabel(r), /多管道收錄.*待查證/);
  });
  for (const type of ["same-topic", "same-entity"] as const) {
    it(`${type} 不增加同事件候選的來源計數`, () => {
      const r = resultFor([event("a"), event("b")], network(type));
      assert.equal(r.sources, 1); assert.equal(r.confirmed, false);
    });
  }
  it("缺少鄰居不膨脹來源數", () => {
    const r = resultFor([event("a")], network("same-incident", ["missing"]));
    assert.equal(r.sources, 1); assert.equal(r.confirmed, false);
  });
  it("高風險新聞即使有多個來源仍須先核對原文", () => {
    const a = event("a"), r = resultFor([a, event("b")]);
    const d = getActionDecision(a, r);
    assert.equal(d.recommendation, "先查證原文再行動");
    assert.equal(d.status, candidateSourceLabel(r));
  });
  it("舊版 confirmed=true 不得解除高風險新聞的查證要求", () => {
    const d = getActionDecision(event("a"), { sources: 3, channels: 3, confirmed: true });
    assert.equal(d.recommendation, "先查證原文再行動");
    assert.match(d.status, /待查證/); assert.ok(!d.status.includes("源佐證"));
  });
  it("舊版 confirmed=true 卡片仍使用可見的中性候選提示", () => {
    const html = eventCard(event("a"), 1, undefined, { sources: 3, channels: 3, confirmed: true });
    assert.ok(html.includes('class="channel-chip candidate-source-note"'));
    assert.ok(html.includes("多來源線索（3 個標記）·待查證"));
    assert.ok(!html.includes("✓ 3 源佐證"));
    assert.ok(!html.includes('class="corroboration-chip"'));
    assert.ok(html.includes("先查證原文再行動"));
  });
  it("新結果的卡片保留原文、地點與關聯按鈕", () => {
    const a = event("a"), html = eventCard(a, 1, undefined, resultFor([a, event("b")]));
    assert.ok(html.includes('href="https://a.example/news/1"'));
    assert.ok(html.includes("查詢區域（非案發點）"));
    assert.ok(html.includes('data-rel="a"'));
    assert.ok(html.includes("多來源線索（2 個標記）·待查證"));
  });
  it("歷史與司法資料保留原來的狀態及建議", () => {
    const r = resultFor([event("a"), event("b")]);
    assert.equal(getActionDecision(event("a", { temporal: "historical" }), r).status, "歷史資料");
    assert.equal(getActionDecision(event("a", { temporal: "judicial" }), r).recommendation, "參考司法結果");
  });
  it("危急事件原有政策不在此修正中變更", () => {
    assert.equal(getActionDecision(event("a", { riskLevel: "critical" }), resultFor([event("a"), event("b")])).recommendation, "立即避開／處理");
  });
  it("無多來源資訊時不捏造候選數量，非法計數不進文案", () => {
    assert.equal(candidateSourceLabel(), "");
    assert.equal(candidateSourceLabel({ sources: 1, channels: 1, confirmed: false }), "");
    assert.equal(candidateSourceLabel({ sources: NaN, channels: Infinity, confirmed: true }), "");
  });
  it("首頁關聯型別名稱不直接宣称跨源已查證", () => {
    assert.equal(edgeTypeLabel("same-incident"), "同事件候選（待查證）");
    assert.equal(edgeTypeLabel("same-topic"), "同題情勢（弱關聯）");
  });
  it("來源與標題中的 HTML 仍安全轉義", () => {
    const a = event("a", { title: '<img src=x onerror="alert(1)">' });
    a.source.publisherName = '<script>alert(1)</script>';
    const html = eventCard(a, 1, undefined, resultFor([a, event("b")]));
    assert.ok(!html.includes("<img src=x")); assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;img"));
  });
});
