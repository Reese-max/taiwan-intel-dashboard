import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { clusterSignals, geoClustersOf, isValidCoordinate, isValidTimestamp, temporalSeriesOf } from "../scripts/lib/cluster-signals.mjs";

function ev(id: string, over: Record<string, unknown> = {}): any {
  return {
    id,
    title: "事件",
    timestamp: "2026-06-20T10:00:00+08:00",
    source: { name: "中央社 社會", type: "news-rss", fetchedAt: "" },
    ...over,
  };
}

describe("isValidTimestamp / isValidCoordinate", () => {
  it("有效時間與無效時間的判定", () => {
    expect(isValidTimestamp("2026-06-20T10:00:00+08:00")).toBe(true);
    expect(isValidTimestamp("not-a-date")).toBe(false);
    expect(isValidTimestamp(undefined)).toBe(false);
  });

  it("缺座標與 (0,0) 佔位座標皆視為無效", () => {
    expect(isValidCoordinate(25.03, 121.56)).toBe(true);
    expect(isValidCoordinate(undefined, 121.56)).toBe(false);
    expect(isValidCoordinate(0, 0)).toBe(false);
  });
});

describe("temporalSeriesOf — 按時間排序的來源／報導數序列", () => {
  it("逐日（UTC）分桶並依時間排序，序列含報導數與不重複來源數", () => {
    const members = [
      ev("a", { timestamp: "2026-06-20T02:00:00.000Z", source: { name: "來源A", type: "news-rss", fetchedAt: "" } }),
      ev("b", { timestamp: "2026-06-20T06:00:00.000Z", source: { name: "來源B", type: "news-rss", fetchedAt: "" } }),
      ev("c", { timestamp: "2026-06-21T02:00:00.000Z", source: { name: "來源A", type: "news-rss", fetchedAt: "" } }),
    ];
    const { series, firstSeenTs, lastSeenTs } = temporalSeriesOf(members);

    expect(series.map((b: any) => b.ts)).toEqual(["2026-06-20T00:00:00.000Z", "2026-06-21T00:00:00.000Z"]);
    expect(series[0]).toMatchObject({ reports: 2, sources: 2 });
    expect(series[1]).toMatchObject({ reports: 1, sources: 1 });
    expect(firstSeenTs).toBe("2026-06-20T02:00:00.000Z");
    expect(lastSeenTs).toBe("2026-06-21T02:00:00.000Z");
  });

  it("缺失或無效時間的事件不進序列，記入 degraded 供追溯", () => {
    const members = [
      ev("good", { timestamp: "2026-06-20T10:00:00+08:00" }),
      ev("no-time", { timestamp: undefined }),
      ev("bad-time", { timestamp: "not-a-date" }),
    ];
    const { series, firstSeenTs, lastSeenTs, degraded } = temporalSeriesOf(members);

    expect(series).toHaveLength(1);
    expect(series[0].reports).toBe(1);
    expect(firstSeenTs).toBe("2026-06-20T10:00:00+08:00");
    expect(lastSeenTs).toBe("2026-06-20T10:00:00+08:00");
    expect(degraded.missingTimestamp).toEqual({ count: 2, ids: ["no-time", "bad-time"] });
  });

  it("全員時間缺失：firstSeenTs/lastSeenTs 為 undefined 而非空字串，全員記入 degraded", () => {
    const members = [
      ev("no-time", { timestamp: undefined }),
      ev("bad-time", { timestamp: "not-a-date" }),
    ];
    const result = temporalSeriesOf(members);

    expect(result.series).toEqual([]);
    expect(result.firstSeenTs).toBeUndefined();
    expect(result.lastSeenTs).toBeUndefined();
    expect(result.firstSeenTs).not.toBe("");
    expect(result.lastSeenTs).not.toBe("");
    expect(result.degraded.missingTimestamp).toEqual({ count: 2, ids: ["no-time", "bad-time"] });
  });

  it("空群回空序列與 undefined 首末時間，無降級成員", () => {
    const result = temporalSeriesOf([]);
    expect(result.series).toEqual([]);
    expect(result.firstSeenTs).toBeUndefined();
    expect(result.lastSeenTs).toBeUndefined();
    expect(result.degraded.missingTimestamp).toEqual({ count: 0, ids: [] });
  });
});

describe("geoClustersOf — 地理座標群集與成員佐證", () => {
  it("近距離座標併入同一群集，回傳質心與成員座標佐證", () => {
    const members = [
      ev("a", { lat: 25.03, lng: 121.56 }),
      ev("b", { lat: 25.04, lng: 121.57 }),
      ev("c", { lat: 24.99, lng: 121.51 }),
    ];
    const { clusters } = geoClustersOf(members);

    expect(clusters).toHaveLength(1);
    const group = clusters[0];
    expect(group.size).toBe(3);
    expect(group.centroidLat).toBeCloseTo((25.03 + 25.04 + 24.99) / 3, 3);
    expect(group.centroidLng).toBeCloseTo((121.56 + 121.57 + 121.51) / 3, 3);
    expect(group.members.map((m: any) => m.id).sort()).toEqual(["a", "b", "c"]);
    expect(group.members[0]).toHaveProperty("lat");
    expect(group.members[0]).toHaveProperty("lng");
  });

  it("遠距座標各自成群，不做錯誤合併", () => {
    const members = [
      ev("taipei", { lat: 25.03, lng: 121.56 }),
      ev("kaohsiung", { lat: 22.62, lng: 120.3 }),
    ];
    const { clusters } = geoClustersOf(members);

    expect(clusters).toHaveLength(2);
    expect(clusters.map((c: any) => c.size)).toEqual([1, 1]);
  });

  it("星狀聚集：中間點不把遠距兩端串成鏈（防單連鎖誤併）", () => {
    const members = [
      ev("west", { lat: 25.0, lng: 121.5 }),
      ev("mid", { lat: 25.0, lng: 121.65 }),
      ev("east", { lat: 25.0, lng: 121.8 }),
    ];
    const { clusters } = geoClustersOf(members);

    // west 與 east 相距約 30km > 閾值 15km，不得透過 mid 橋接成一團。
    expect(clusters.length).toBeGreaterThanOrEqual(2);
    for (const group of clusters) {
      const ids = group.members.map((m: any) => m.id);
      expect(ids.includes("west") && ids.includes("east")).toBe(false);
    }
  });

  it("缺座標或 (0,0) 的事件不進群集，記入 degraded 供追溯", () => {
    const members = [
      ev("with-coord", { lat: 25.03, lng: 121.56 }),
      ev("no-coord", {}),
      ev("zero-zero", { lat: 0, lng: 0 }),
    ];
    const { clusters, degraded } = geoClustersOf(members);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.map((m: any) => m.id)).toEqual(["with-coord"]);
    expect(degraded.missingCoordinates).toEqual({ count: 2, ids: ["no-coord", "zero-zero"] });
  });
});

describe("clusterSignals — 單一入口", () => {
  it("一次產出時序、地理與降級紀錄", () => {
    const members = [
      ev("a", { timestamp: "2026-06-20T10:00:00+08:00", lat: 25.03, lng: 121.56, source: { name: "來源A", type: "news-rss", fetchedAt: "" } }),
      ev("b", { timestamp: "2026-06-21T10:00:00+08:00", lat: 25.04, lng: 121.57, source: { name: "來源B", type: "news-rss", fetchedAt: "" } }),
      ev("c", { timestamp: undefined, lat: undefined, lng: undefined }),
    ];
    const signals = clusterSignals(members);

    expect(signals.temporalSeries).toHaveLength(2);
    expect(signals.firstSeenTs).toBe("2026-06-20T10:00:00+08:00");
    expect(signals.lastSeenTs).toBe("2026-06-21T10:00:00+08:00");
    expect(signals.geoClusters).toHaveLength(1);
    expect(signals.geoClusters[0].size).toBe(2);
    expect(signals.degraded).toEqual({
      missingTimestamp: { count: 1, ids: ["c"] },
      missingCoordinates: { count: 1, ids: ["c"] },
    });
  });

  it("全員時間缺失：省略 firstSeenTs/lastSeenTs 欄位（不存在），不以空字串輸出", () => {
    const members = [
      ev("x", { timestamp: undefined, lat: 25.03, lng: 121.56 }),
      ev("y", { timestamp: undefined, lat: 25.04, lng: 121.57 }),
    ];
    const signals = clusterSignals(members);

    expect("firstSeenTs" in signals).toBe(false);
    expect("lastSeenTs" in signals).toBe(false);
    expect(signals.firstSeenTs).toBeUndefined();
    expect(signals.lastSeenTs).toBeUndefined();
    expect(signals.temporalSeries).toEqual([]);
    expect(signals.degraded.missingTimestamp).toEqual({ count: 2, ids: ["x", "y"] });
    // 座標完整者仍正常聚集，不受時間缺失影響。
    expect(signals.geoClusters).toHaveLength(1);
    expect(signals.geoClusters[0].size).toBe(2);
  });
});
