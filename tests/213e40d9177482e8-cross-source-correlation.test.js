import { describe, expect, it } from "vitest";
import { correlateEvents } from "../scripts/lib/correlate.mjs";

function ev(over = {}) {
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

describe("跨來源事件歸併與佐證保留", () => {
  it("同事件跨兩來源正確歸併，佐證來源正確記錄", () => {
    const events = [
      ev({
        id: "src-a",
        region: "臺北市",
        title: "信義區毒品案 警方查獲安非他命",
        timestamp: "2026-06-20T10:00:00+08:00",
        source: { name: "中央社 社會", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "src-b",
        region: "臺北市",
        title: "北市信義分局緝毒 起獲海洛因",
        timestamp: "2026-06-20T14:00:00+08:00",
        source: { name: "自由時報 社會", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    const edge = net.edges.find(
      (e) => (e.a === "src-a" && e.b === "src-b") || (e.a === "src-b" && e.b === "src-a"),
    );
    expect(edge).toBeTruthy();
    expect(edge.type).toBe("same-incident");
    const nodeA = net.nodes.find((n) => n.id === "src-a");
    expect(nodeA.evidenceSources).toContain("自由時報 社會");
    expect(nodeA.sourceCount).toBeGreaterThanOrEqual(1);
  });

  it("三來源跨源佐證歸入同一群組，佐證來源數正確", () => {
    const events = [
      ev({
        id: "tri-a",
        region: "高雄市",
        title: "鳳山分局破獲毒品工場 查扣愷他命",
        timestamp: "2026-06-20T08:00:00+08:00",
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "tri-b",
        region: "高雄市",
        title: "鳳山分局緝毒行動 查獲愷他命",
        timestamp: "2026-06-20T10:00:00+08:00",
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "tri-c",
        region: "高雄市",
        title: "鳳山分局毒犯落網 起獲愷他命",
        timestamp: "2026-06-20T12:00:00+08:00",
        source: { name: "來源C", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    const cluster = net.clusters.find((c) => c.members.includes("tri-a"));
    expect(cluster).toBeTruthy();
    expect(cluster.size).toBeGreaterThanOrEqual(2);
    expect(cluster.evidenceSources.length).toBeGreaterThanOrEqual(2);
    const nodeA = net.nodes.find((n) => n.id === "tri-a");
    expect(nodeA.evidenceSources.length).toBeGreaterThanOrEqual(2);
  });
});

describe("時序演變計算", () => {
  it("跨日事件產出逐日時序序列與首末觀測時間", () => {
    const events = [
      ev({
        id: "ts-a",
        region: "臺北市",
        title: "信義區毒品案 初報",
        timestamp: "2026-06-20T08:00:00+08:00",
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "ts-b",
        region: "臺北市",
        title: "信義區毒品案 後續",
        timestamp: "2026-06-21T14:00:00+08:00",
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "ts-c",
        region: "臺北市",
        title: "信義區毒品案 追蹤",
        timestamp: "2026-06-22T09:00:00+08:00",
        source: { name: "來源C", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    const cluster = net.clusters.find((c) => c.members.includes("ts-a"));
    expect(cluster).toBeTruthy();
    expect(cluster.temporalSeries).toHaveLength(3);
    expect(cluster.firstSeenTs).toBe("2026-06-20T08:00:00+08:00");
    expect(cluster.lastSeenTs).toBe("2026-06-22T09:00:00+08:00");
    expect(cluster.temporalSpanDays).toBeCloseTo(2, 0);
    const totalReports = cluster.temporalSeries.reduce((sum, b) => sum + b.reports, 0);
    expect(totalReports).toBe(3);
  });

  it("同日多篇歸入同一日桶，reports 與 sources 計數正確", () => {
    const events = [
      ev({
        id: "day-a",
        region: "臺北市",
        title: "信義區毒品案 報導一",
        timestamp: "2026-06-20T08:00:00+08:00",
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "day-b",
        region: "臺北市",
        title: "信義區毒品案 報導二",
        timestamp: "2026-06-20T15:00:00+08:00",
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    const cluster = net.clusters.find((c) => c.members.includes("day-a"));
    expect(cluster).toBeTruthy();
    expect(cluster.temporalSeries).toHaveLength(1);
    expect(cluster.temporalSeries[0].reports).toBe(2);
    expect(cluster.temporalSeries[0].sources).toBe(2);
  });

  it("缺失時間戳的事件不進入時序序列，degraded 記錄正確", () => {
    const events = [
      ev({
        id: "miss-a",
        region: "臺北市",
        title: "信義分局破獲毒品工場",
        timestamp: undefined,
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "miss-b",
        region: "臺北市",
        title: "信義分局毒品案後續",
        timestamp: undefined,
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    const cluster = net.clusters.find((c) => c.members.includes("miss-a"));
    expect(cluster).toBeTruthy();
    const totalReports = cluster.temporalSeries.reduce((sum, b) => sum + b.reports, 0);
    expect(totalReports).toBe(0);
    expect(cluster.degraded.missingTimestamp.count).toBe(2);
    expect(cluster.degraded.missingTimestamp.ids).toContain("miss-a");
    expect(cluster.degraded.missingTimestamp.ids).toContain("miss-b");
  });

  it("全員時間缺失時省略 firstSeenTs/lastSeenTs，不以空字串輸出", () => {
    const events = [
      ev({
        id: "allmiss-a",
        region: "臺北市",
        title: "信義分局共享實體案甲",
        timestamp: undefined,
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "allmiss-b",
        region: "臺北市",
        title: "信義分局共享實體案乙",
        timestamp: undefined,
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    const cluster = net.clusters[0];
    expect(cluster).toBeTruthy();
    expect("firstSeenTs" in cluster).toBe(false);
    expect("lastSeenTs" in cluster).toBe(false);
    expect(cluster.temporalSeries).toEqual([]);
    expect(cluster.degraded.missingTimestamp).toEqual({
      count: 2,
      ids: ["allmiss-a", "allmiss-b"],
    });
  });
});

describe("鄰近地點群集", () => {
  it("距離 15km 內的事件形成同一地理群集", () => {
    const events = [
      ev({
        id: "geo-a",
        region: "臺北市",
        title: "信義區毒品案",
        lat: 25.033,
        lng: 121.565,
        timestamp: "2026-06-20T10:00:00+08:00",
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "geo-b",
        region: "臺北市",
        title: "信義區毒品案後續",
        lat: 25.04,
        lng: 121.57,
        timestamp: "2026-06-20T14:00:00+08:00",
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    const cluster = net.clusters.find((c) => c.members.includes("geo-a"));
    expect(cluster).toBeTruthy();
    expect(cluster.geoClusters.length).toBeGreaterThanOrEqual(1);
    const geoGroup = cluster.geoClusters.find((g) =>
      g.members.some((m) => m.id === "geo-a") && g.members.some((m) => m.id === "geo-b"),
    );
    expect(geoGroup).toBeTruthy();
    expect(geoGroup.size).toBe(2);
  });

  it("距離超過 15km 的事件分屬不同地理群集", () => {
    const events = [
      ev({
        id: "far-a",
        region: "臺北市",
        title: "北投分局破獲毒品工場",
        lat: 25.135,
        lng: 121.501,
        timestamp: "2026-06-20T10:00:00+08:00",
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "far-b",
        region: "臺北市",
        title: "北投分局緝毒行動",
        lat: 24.95,
        lng: 121.57,
        timestamp: "2026-06-20T14:00:00+08:00",
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    const cluster = net.clusters.find((c) => c.members.includes("far-a"));
    expect(cluster).toBeTruthy();
    expect(cluster.geoClusters.length).toBeGreaterThanOrEqual(2);
    const geoA = cluster.geoClusters.find((g) => g.members.some((m) => m.id === "far-a"));
    const geoB = cluster.geoClusters.find((g) => g.members.some((m) => m.id === "far-b"));
    expect(geoA).toBeTruthy();
    expect(geoB).toBeTruthy();
    expect(geoA.id).not.toBe(geoB.id);
  });

  it("缺失座標的事件不進入任何地理群集，degraded 記錄正確", () => {
    const events = [
      ev({
        id: "nocoord-a",
        region: "臺北市",
        title: "信義區毒品案",
        lat: 25.033,
        lng: 121.565,
        timestamp: "2026-06-20T10:00:00+08:00",
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "nocoord-b",
        region: "臺北市",
        title: "信義區毒品案後續",
        lat: undefined,
        lng: undefined,
        timestamp: "2026-06-20T14:00:00+08:00",
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    const cluster = net.clusters.find((c) => c.members.includes("nocoord-a"));
    expect(cluster).toBeTruthy();
    const allGeoMembers = cluster.geoClusters.flatMap((g) => g.members.map((m) => m.id));
    expect(allGeoMembers).not.toContain("nocoord-b");
    expect(cluster.degraded.missingCoordinates.count).toBe(1);
    expect(cluster.degraded.missingCoordinates.ids).toContain("nocoord-b");
  });
});

describe("明顯不符項目不得合併", () => {
  it("主題明顯不符（毒品 vs 交通）不同來源不形成 same-incident", () => {
    const events = [
      ev({
        id: "theme-a",
        region: "臺北市",
        category: "治安",
        title: "信義區毒品案 查獲安非他命",
        timestamp: "2026-06-20T10:00:00+08:00",
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "theme-b",
        region: "臺北市",
        category: "交通",
        title: "國道一號追撞 釀三死傷",
        timestamp: "2026-06-20T14:00:00+08:00",
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    const sameIncident = net.edges.filter(
      (e) =>
        e.type === "same-incident" &&
        ((e.a === "theme-a" && e.b === "theme-b") || (e.a === "theme-b" && e.b === "theme-a")),
    );
    expect(sameIncident).toHaveLength(0);
    expect(net.clusters).toHaveLength(0);
  });

  it("時間差距超過佐證窗口（>3 天）不形成 same-incident", () => {
    const events = [
      ev({
        id: "time-a",
        region: "高雄市",
        title: "鳳山區毒品案 初報",
        timestamp: "2026-06-15T10:00:00+08:00",
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "time-b",
        region: "高雄市",
        title: "鳳山區毒品案 後續",
        timestamp: "2026-06-25T10:00:00+08:00",
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    const sameIncident = net.edges.filter(
      (e) =>
        e.type === "same-incident" &&
        ((e.a === "time-a" && e.b === "time-b") || (e.a === "time-b" && e.b === "time-a")),
    );
    expect(sameIncident).toHaveLength(0);
  });

  it("地理明顯不符（臺北市 vs 高雄市）且無共享實體，不形成 same-incident", () => {
    const events = [
      ev({
        id: "geo-far-a",
        region: "臺北市",
        title: "信義區毒品案 查獲安非他命",
        timestamp: "2026-06-20T10:00:00+08:00",
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "geo-far-b",
        region: "高雄市",
        title: "鳳山區毒品案 查獲安非他命",
        timestamp: "2026-06-20T14:00:00+08:00",
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    const sameIncident = net.edges.filter(
      (e) =>
        e.type === "same-incident" &&
        ((e.a === "geo-far-a" && e.b === "geo-far-b") ||
          (e.a === "geo-far-b" && e.b === "geo-far-a")),
    );
    expect(sameIncident).toHaveLength(0);
  });

  it("只有同縣市但案類關鍵詞完全無重疊，不形成 same-incident", () => {
    const events = [
      ev({
        id: "nooverlap-a",
        region: "桃園市",
        category: "治安",
        title: "桃園查獲毒品 逮二嫌",
        timestamp: "2026-06-20T10:00:00+08:00",
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "nooverlap-b",
        region: "桃園市",
        category: "天氣",
        title: "桃園豪雨成災 淹水嚴重",
        timestamp: "2026-06-20T14:00:00+08:00",
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    const sameIncident = net.edges.filter(
      (e) =>
        e.type === "same-incident" &&
        ((e.a === "nooverlap-a" && e.b === "nooverlap-b") ||
          (e.a === "nooverlap-b" && e.b === "nooverlap-a")),
    );
    expect(sameIncident).toHaveLength(0);
  });

  it("同來源重發不算跨源佐證，不形成 same-incident", () => {
    const events = [
      ev({
        id: "samesrc-a",
        region: "臺北市",
        title: "信義區毒品案 警方查獲",
        timestamp: "2026-06-20T10:00:00+08:00",
        source: { name: "中央社 社會", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "samesrc-b",
        region: "臺北市",
        title: "信義區毒品案 查獲安非他命",
        timestamp: "2026-06-20T11:00:00+08:00",
        source: { name: "中央社 社會", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    const sameIncident = net.edges.filter(
      (e) =>
        e.type === "same-incident" &&
        ((e.a === "samesrc-a" && e.b === "samesrc-b") ||
          (e.a === "samesrc-b" && e.b === "samesrc-a")),
    );
    expect(sameIncident).toHaveLength(0);
  });

  it("缺失時間戳的事件與有時間戳事件不因時間窗預設為 0 而錯誤連結主題不同者", () => {
    const events = [
      ev({
        id: "nots-a",
        region: "臺北市",
        category: "治安",
        title: "信義區毒品案 查獲安非他命",
        timestamp: undefined,
        source: { name: "來源A", type: "news-rss", fetchedAt: "" },
      }),
      ev({
        id: "nots-b",
        region: "臺北市",
        category: "交通",
        title: "國道一號追撞 釀三死傷",
        timestamp: "2026-06-20T14:00:00+08:00",
        source: { name: "來源B", type: "news-rss", fetchedAt: "" },
      }),
    ];
    const net = correlateEvents(events);
    const sameIncident = net.edges.filter(
      (e) =>
        e.type === "same-incident" &&
        ((e.a === "nots-a" && e.b === "nots-b") || (e.a === "nots-b" && e.b === "nots-a")),
    );
    expect(sameIncident).toHaveLength(0);
  });
});
