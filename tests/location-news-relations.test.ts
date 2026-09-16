import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { correlateEvents, extractSignals } from "../scripts/lib/correlate.mjs";

const event = (id: string, fields: Record<string, unknown> = {}) => ({
  id, title: "甲新聞", summary: "", region: "臺北市", category: "治安", scope: "domestic",
  timestamp: "2026-09-16T08:00:00Z", source: { name: id, type: "news-rss", fetchedAt: "" }, ...fields,
});
const pair = (a: Record<string, unknown> = {}, b: Record<string, unknown> = {}) =>
  correlateEvents([event("a", a), event("b", b)]);
const place = { title: "中山路 舉辦活動" };
const topic = { aiTopic: "連鎖商場營運消息" };

describe("地點與新聞關聯的證據邊界", () => {
  it("跨縣市同名路段不連線", () => {
    assert.deepEqual(pair(place, { title: "中山路 完成施工", region: "高雄市" }).edges, []);
  });
  it("未知地區不以同名路段定位", () => {
    assert.deepEqual(pair({ ...place, region: "全國" }, { title: "中山路 完成施工", region: "全國" }).edges, []);
  });
  it("同區域地名保留線索，但不獨自成群或計為佐證", () => {
    const net = pair(place, { title: "中山路 完成施工" });
    assert.equal(net.edges[0]?.type, "same-entity");
    assert.match(net.edges[0].why, /僅文字線索，非同案/);
    assert.deepEqual(net.clusters, []);
    assert.ok(net.nodes.every((n: { sourceCount: number }) => n.sourceCount === 0));
  });
  it("台／臺區域別名可連結，原始事件不改寫", () => {
    const events = [event("a", { ...place, region: "台北市" }), event("b", { title: "中山路 完成施工" })];
    const before = JSON.stringify(events);
    assert.equal(correlateEvents(events).edges[0]?.type, "same-entity");
    assert.equal(JSON.stringify(events), before);
  });
  it("同地名跨月不連成近期線索", () => {
    assert.deepEqual(pair(place, { ...place, timestamp: "2026-08-16T08:00:00Z" }).edges, []);
  });
  it("不同 scope 的同名地點隔離", () => {
    assert.deepEqual(pair(place, { ...place, scope: "international" }).edges, []);
  });
  it("不同 scope 的具名組織也隔離", () => {
    assert.deepEqual(pair({ title: "鳳山分局 甲消息" }, { title: "鳳山分局 乙消息", scope: "international" }).edges, []);
  });
  it("真正具名組織仍保留跨地追蹤", () => {
    const net = pair({ title: "鳳山分局破詐騙水房", region: "高雄市" },
      { title: "鳳山分局協助查緝車手", region: "臺南市" });
    assert.equal(net.edges[0]?.type, "same-entity");
  });
  it("地名不重複算成具名身分與標題證據", () => {
    const s = extractSignals(event("a", { title: "中山路", aiEntities: ["中山路"] }));
    assert.ok(s.entities.has("中山路"));
    assert.equal(s.identityEntities.size, 0);
    assert.equal(s.bigrams.size, 0);
  });
  it("AI 同題但跨月不連線", () => {
    assert.deepEqual(pair(topic, { ...topic, title: "乙新聞", timestamp: "2026-08-16T08:00:00Z" }).edges, []);
  });
  it("AI 同題但不同 scope 不連線", () => {
    assert.deepEqual(pair(topic, { ...topic, title: "乙新聞", scope: "international" }).edges, []);
  });
  it("AI 同題但不同城市且無共同具名身分，不連線", () => {
    assert.deepEqual(pair(topic, { ...topic, title: "乙新聞", region: "高雄市" }).edges, []);
  });
  it("只有 AI 同題保留弱線索，不升同案或增加佐證數", () => {
    const net = pair(topic, { ...topic, title: "乙新聞" });
    assert.equal(net.edges[0]?.type, "same-topic");
    assert.match(net.edges[0].why, /非同案佐證/);
    assert.deepEqual(net.clusters, []);
    assert.ok(net.nodes.every((n: { sourceCount: number }) => n.sourceCount === 0));
  });
  it("AI 同題 48 小時邊界包含，超過 1ms 不包含", () => {
    assert.equal(pair(topic, { ...topic, title: "乙新聞", timestamp: "2026-09-18T08:00:00Z" }).edges.length, 1);
    assert.equal(pair(topic, { ...topic, title: "乙新聞", timestamp: "2026-09-18T08:00:00.001Z" }).edges.length, 0);
  });
  it("無效或缺少時間不能冒充時間相近", () => {
    for (const timestamp of [undefined, "bad", ""]) {
      assert.deepEqual(pair({ ...topic, timestamp }, { ...topic, timestamp, title: "乙新聞" }).edges, []);
      assert.deepEqual(pair({ title: "信義區毒品案 初報", timestamp },
        { title: "信義區毒品案 追蹤", timestamp }).edges, []);
    }
  });
  it("有具體共同內容的同區域近期報導仍保留同案候選", () => {
    const net = pair({ title: "信義分局查獲安非他命毒品工場" },
      { title: "信義分局查獲安非他命毒品工場後續", timestamp: "2026-09-16T10:00:00Z" });
    assert.equal(net.edges[0]?.type, "same-incident");
  });
  it("AI 不能覆蓋已成立的強內容關聯", () => {
    const net = pair({ ...topic, title: "信義分局查獲安非他命毒品工場" },
      { ...topic, title: "信義分局查獲安非他命毒品工場後續" });
    assert.equal(net.edges[0]?.type, "same-incident");
  });
  it("地區中的 regex 符號以純文字處理", () => {
    assert.doesNotThrow(() => pair({ region: "[" }, { region: "[" }));
  });
  it("混合共享理由不因先出現地名而丟失非地理實體", () => {
    const net = pair({ ...place, aiEntities: ["示範集團"] },
      { title: "中山路 完成施工", aiEntities: ["示範集團"] });
    assert.equal(net.edges[0]?.type, "same-entity");
    assert.equal(net.clusters.length, 1);
  });
});
