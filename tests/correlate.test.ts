import { describe, expect, it } from "vitest";
import { extractSignals, correlateEvents, relatedIds } from "../scripts/lib/correlate.mjs";

// 最小事件工廠（只填關聯引擎會用到的欄位）
function ev(over: Record<string, unknown> = {}): any {
  return {
    id: "x",
    title: "標題",
    region: "臺北市",
    timestamp: "2026-06-20T10:00:00+08:00",
    category: "治安",
    scope: "domestic",
    riskLevel: "medium",
    summary: "",
    source: { name: "中央社 社會", type: "news-rss", fetchedAt: "2026-06-20T10:00:00+08:00" },
    ...over,
  };
}

describe("extractSignals", () => {
  it("從標題+摘要抽出案類關鍵詞標籤", () => {
    const s = extractSignals(ev({ title: "信義區查獲安非他命毒品案", summary: "警方緝毒" }));
    expect(s.keywords.has("毒品")).toBe(true);
    expect(s.region).toBe("臺北市");
    expect(s.category).toBe("治安");
  });

  it("抽出具名實體（分局/路名/行政區）供跨事件連結", () => {
    const s = extractSignals(ev({ title: "板橋分局在中山路破案" }));
    expect([...s.entities]).toContain("板橋分局");
    expect([...s.entities]).toContain("中山路");
  });

  it("沒有命中時 keywords/entities 為空集合而非報錯", () => {
    const s = extractSignals(ev({ title: "市府記者會公布政策", summary: "" }));
    expect(s.keywords.size).toBe(0);
    expect(s.entities instanceof Set).toBe(true);
  });
});

describe("correlateEvents — same-incident（跨源佐證）", () => {
  it("同縣市 + 案類關鍵詞重疊 + 時間相近 + 不同來源 → same-incident 邊", () => {
    const events = [
      ev({ id: "a", region: "臺北市", title: "信義區毒品案 警方查獲安非他命", timestamp: "2026-06-20T10:00:00+08:00", source: { name: "中央社 社會", type: "news-rss", fetchedAt: "" } }),
      ev({ id: "b", region: "臺北市", title: "北市信義分局緝毒 起獲海洛因", timestamp: "2026-06-20T14:00:00+08:00", source: { name: "自由時報 社會", type: "news-rss", fetchedAt: "" } }),
    ];
    const net = correlateEvents(events);
    const edge = net.edges.find((e: any) => (e.a === "a" && e.b === "b") || (e.a === "b" && e.b === "a"));
    expect(edge).toBeTruthy();
    expect(edge.type).toBe("same-incident");
    expect(edge.weight).toBeGreaterThan(0);
    expect(typeof edge.why).toBe("string");
  });

  it("同縣市但案類無關、不同主題 → 不連結", () => {
    const events = [
      ev({ id: "a", region: "臺北市", category: "治安", title: "信義區毒品案 查獲安非他命" }),
      ev({ id: "c", region: "臺北市", category: "交通", title: "國道一號追撞 釀三傷" }),
    ];
    const net = correlateEvents(events);
    expect(net.edges.length).toBe(0);
  });

  it("同案但同一來源（同媒體重發）不算跨源佐證 → 非 same-incident", () => {
    const events = [
      ev({ id: "a", region: "桃園市", title: "桃園查獲毒品 逮二嫌", timestamp: "2026-06-20T10:00:00+08:00", source: { name: "中央社 社會", type: "news-rss", fetchedAt: "" } }),
      ev({ id: "b", region: "桃園市", title: "桃園毒品案 逮捕二名嫌犯", timestamp: "2026-06-20T11:00:00+08:00", source: { name: "中央社 社會", type: "news-rss", fetchedAt: "" } }),
    ];
    const net = correlateEvents(events);
    const edge = net.edges.find((e: any) => e.a === "a" || e.b === "a");
    if (edge) expect(edge.type).not.toBe("same-incident");
  });
});

describe("correlateEvents — same-entity（共享具名實體跨地連結）", () => {
  it("不同縣市但共享同一分局 → same-entity 邊", () => {
    const events = [
      ev({ id: "d", region: "高雄市", title: "鳳山分局破詐騙水房" }),
      ev({ id: "e", region: "臺南市", title: "鳳山分局協助查緝車手", timestamp: "2026-06-21T10:00:00+08:00" }),
    ];
    const net = correlateEvents(events);
    const edge = net.edges.find((e: any) => (e.a === "d" && e.b === "e") || (e.a === "e" && e.b === "d"));
    expect(edge).toBeTruthy();
    expect(edge.type).toBe("same-entity");
  });
});

describe("correlateEvents — same-topic（同源同題弱連結）", () => {
  it("同縣市同類同關鍵詞、同一來源、時間相近 → same-topic 邊", () => {
    const events = [
      ev({ id: "f", region: "桃園市", category: "治安", title: "桃園查獲毒品", timestamp: "2026-06-20T09:00:00+08:00", source: { name: "GN 毒品查獲", type: "news-rss", fetchedAt: "" } }),
      ev({ id: "g", region: "桃園市", category: "治安", title: "桃園販毒落網", timestamp: "2026-06-21T09:00:00+08:00", source: { name: "GN 毒品查獲", type: "news-rss", fetchedAt: "" } }),
    ];
    const net = correlateEvents(events);
    const edge = net.edges.find((e: any) => (e.a === "f" && e.b === "g") || (e.a === "f" && e.b === "g"));
    expect(edge).toBeTruthy();
    expect(["same-topic", "same-incident"]).toContain(edge.type);
  });
});

describe("correlateEvents — 結構保證", () => {
  it("邊是無向且去重（同一對只出現一次、無自連）", () => {
    const events = [
      ev({ id: "a", region: "臺北市", title: "信義區毒品案 查獲安非他命", source: { name: "A", type: "news-rss", fetchedAt: "" } }),
      ev({ id: "b", region: "臺北市", title: "信義分局緝毒 起獲海洛因", timestamp: "2026-06-20T12:00:00+08:00", source: { name: "B", type: "news-rss", fetchedAt: "" } }),
    ];
    const net = correlateEvents(events);
    for (const e of net.edges) expect(e.a).not.toBe(e.b);
    const keys = net.edges.map((e: any) => [e.a, e.b].sort().join("|"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("回傳 nodes/edges/clusters/stats，nodes 對應傳入事件", () => {
    const events = [ev({ id: "a" }), ev({ id: "b", timestamp: "2026-06-20T12:00:00+08:00", source: { name: "B", type: "news-rss", fetchedAt: "" } })];
    const net = correlateEvents(events);
    expect(net.nodes.length).toBe(2);
    expect(Array.isArray(net.edges)).toBe(true);
    expect(Array.isArray(net.clusters)).toBe(true);
    expect(net.stats.events).toBe(2);
  });

  it("cluster 帶代表標題、主類別、主要地區、最新時間與來源數", () => {
    const events = [
      ev({ id: "a", region: "高雄市", category: "治安", title: "鳳山分局破詐騙水房", timestamp: "2026-06-20T08:00:00+08:00", source: { name: "來源A", type: "news-rss", fetchedAt: "" } }),
      ev({ id: "b", region: "臺南市", category: "治安", title: "鳳山分局 板橋分局中心事件", timestamp: "2026-06-20T09:00:00+08:00", source: { name: "來源B", type: "news-rss", fetchedAt: "" } }),
      ev({ id: "c", region: "嘉義縣", category: "交通", title: "板橋分局事故後續追蹤", timestamp: "2026-06-21T10:00:00+08:00", source: { name: "來源C", type: "news-rss", fetchedAt: "" } }),
    ];
    const net = correlateEvents(events);
    const cluster = net.clusters[0] as any;
    expect(cluster).toMatchObject({
      size: 3,
      representativeTitle: "鳳山分局 板橋分局中心事件",
      topCategory: "治安",
      regions: ["高雄市", "臺南市"],
      latestTs: "2026-06-21T10:00:00+08:00",
      sourceCount: 3,
    });
  });
});

describe("relatedIds", () => {
  it("回傳某事件的相連事件，依權重排序", () => {
    const events = [
      ev({ id: "a", region: "臺北市", title: "信義區毒品案 查獲安非他命", source: { name: "A", type: "news-rss", fetchedAt: "" } }),
      ev({ id: "b", region: "臺北市", title: "信義分局緝毒 起獲海洛因", timestamp: "2026-06-20T12:00:00+08:00", source: { name: "B", type: "news-rss", fetchedAt: "" } }),
    ];
    const net = correlateEvents(events);
    const rel = relatedIds(net, "a");
    expect(rel.map((r: any) => r.id)).toContain("b");
    expect(rel[0]).toHaveProperty("weight");
  });

  it("無相連事件回空陣列", () => {
    const net = correlateEvents([ev({ id: "lonely", title: "市府記者會" })]);
    expect(relatedIds(net, "lonely")).toEqual([]);
  });
});
