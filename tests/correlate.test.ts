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

  it("只有同縣市與通用詐欺詞重疊，不應誤判為同一事件", () => {
    const events = [
      ev({
        id: "fraud-a",
        region: "高雄市",
        category: "反詐",
        title: "高雄假投資詐騙 老翁匯款百萬元",
        timestamp: "2026-06-20T10:00:00+08:00",
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "fraud-b",
        region: "高雄市",
        category: "反詐",
        title: "高雄假交友詐騙 女子匯款十萬元",
        timestamp: "2026-06-20T11:00:00+08:00",
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    expect(net.edges).toEqual([]);
  });

  it("全國事件沒有地理共置，只有產業與案類詞重疊不可視為同一事件", () => {
    const events = [
      ev({
        id: "crypto-a",
        region: "全國",
        category: "反詐",
        title: "美國裁定加密貨幣平台創辦人詐騙罪成立",
        timestamp: "2026-06-20T10:00:00+08:00",
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "crypto-b",
        region: "全國",
        category: "反詐",
        title: "中企疑利用日本據點涉及加密貨幣詐騙",
        timestamp: "2026-06-20T11:00:00+08:00",
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    expect(net.edges).toEqual([]);
  });

  it("柬埔寨、緬甸等跨境詐騙背景地不可當成同案實體橋接不同故事", () => {
    const events = [
      ev({
        id: "country-a",
        region: "全國",
        category: "反詐",
        title: "柬埔寨詐騙園區人權團體籲救援受困者",
        timestamp: "2026-06-20T10:00:00+08:00",
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "country-b",
        region: "全國",
        category: "反詐",
        title: "柬埔寨掃蕩詐騙驚見毒品窩多名嫌犯被捕",
        timestamp: "2026-06-20T11:00:00+08:00",
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    expect(net.edges).toEqual([]);
  });

  it("判刑、起訴等司法程序詞不可單獨作為同案關聯主證據", () => {
    const events = [
      ev({
        id: "court-a",
        region: "高雄市",
        category: "反詐",
        title: "高雄女淪洗錢幫兇 判刑並民事賠償",
        timestamp: "2026-06-20T10:00:00+08:00",
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "court-b",
        region: "高雄市",
        category: "治安",
        title: "高雄前偵查隊長假辦案真跟監 偷拍情敵誣告遭起訴",
        timestamp: "2026-06-20T11:00:00+08:00",
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    expect(net.edges).toEqual([]);
  });

  it("只有摘要共享通用案類詞，標題沒有具體重疊時不可視為同一事件", () => {
    const events = [
      ev({
        id: "summary-a",
        region: "高雄市",
        category: "反詐",
        title: "修車行老闆遭判刑並賠償",
        summary: "法院審理詐欺與洗錢案件。",
        timestamp: "2026-06-20T10:00:00+08:00",
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "summary-b",
        region: "高雄市",
        category: "治安",
        title: "前偵查隊長偷拍遭起訴",
        summary: "檢方偵辦詐欺相關案件時發現違法行為。",
        timestamp: "2026-06-20T11:00:00+08:00",
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    expect(net.edges).toEqual([]);
  });

  it("低信心 same-incident 可作直接關聯，但不應單獨形成情報群 cluster", () => {
    const events = [
      ev({ id: "weak-a", region: "臺北市", title: "信義區毒品案 警方查獲安非他命", timestamp: "2026-06-20T10:00:00+08:00", source: { name: "來源A", type: "news-rss", fetchedAt: "" } }),
      ev({ id: "weak-b", region: "臺北市", title: "北市信義分局緝毒 起獲海洛因", timestamp: "2026-06-20T14:00:00+08:00", source: { name: "來源B", type: "news-rss", fetchedAt: "" } }),
    ];
    const net = correlateEvents(events);
    const edge = net.edges.find((e: any) => e.type === "same-incident");
    expect(edge).toBeTruthy();
    expect(edge.weight).toBeLessThan(1.5);
    expect(net.clusters).toEqual([]);
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

  it("忽略 AI 萃取的泛用實體，避免法院、檢方、縣市名把不相關事件黏在一起", () => {
    const events = [
      ev({
        id: "generic-a",
        region: "高雄市",
        title: "偷拍案偵結 檢方起訴嫌犯",
        aiEntities: ["高雄市", "法院", "檢方", "消防局"],
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "generic-b",
        region: "臺中市",
        title: "詐騙案宣判 法院判刑",
        aiEntities: ["高雄市", "法院", "檢方", "消防局"],
        timestamp: "2026-06-21T10:00:00+08:00",
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    expect(net.edges).toEqual([]);
  });

  it("忽略人稱、場所與行政區等泛用 AI 實體", () => {
    const s = extractSignals(
      ev({
        title: "詐騙車手在超商提領遭逮",
        aiEntities: ["林姓男子", "車手", "銀行", "超商", "板橋區", "LINE", "愛爾麗"],
      }),
    );
    expect([...s.entities]).not.toContain("林姓男子");
    expect([...s.entities]).not.toContain("車手");
    expect([...s.entities]).not.toContain("銀行");
    expect([...s.entities]).not.toContain("超商");
    expect([...s.entities]).not.toContain("板橋區");
    expect([...s.entities]).not.toContain("LINE");
    expect([...s.entities]).toContain("愛爾麗");
  });

  it("地檢署與法院屬程序機關，不應作為不同案件的 same-entity 橋", () => {
    const events = [
      ev({
        id: "court-entity-a",
        region: "新北市",
        title: "新北地檢署偵辦洗錢案起訴",
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "court-entity-b",
        region: "臺北市",
        title: "新北地檢署偵辦偷拍案起訴",
        timestamp: "2026-06-21T10:00:00+08:00",
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    expect(net.edges).toEqual([]);
  });

  it("保留 AI 萃取的特定專名，仍可連結同一案相關報導", () => {
    const events = [
      ev({
        id: "specific-a",
        region: "臺北市",
        title: "愛爾麗偷拍案偵結",
        aiEntities: ["愛爾麗"],
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "specific-b",
        region: "新北市",
        title: "醫美集團偷拍案後續",
        aiEntities: ["愛爾麗"],
        timestamp: "2026-06-21T10:00:00+08:00",
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    const edge = net.edges.find((e: any) => (e.a === "specific-a" && e.b === "specific-b") || (e.a === "specific-b" && e.b === "specific-a"));
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

  it("same-topic 是弱關聯，不應單獨形成情報群 cluster", () => {
    const events = [
      ev({ id: "topic-a", region: "桃園市", category: "治安", title: "桃園查獲毒品", timestamp: "2026-06-20T09:00:00+08:00", source: { name: "GN 毒品查獲", type: "news-rss", fetchedAt: "" } }),
      ev({ id: "topic-b", region: "桃園市", category: "治安", title: "桃園販毒落網", timestamp: "2026-06-21T09:00:00+08:00", source: { name: "GN 毒品查獲", type: "news-rss", fetchedAt: "" } }),
    ];
    const net = correlateEvents(events);
    expect(net.edges.some((edge: any) => edge.type === "same-topic")).toBe(true);
    expect(net.clusters).toEqual([]);
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
