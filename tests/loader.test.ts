import { afterEach, describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { filterEvents } from "../src/data/loader";
import type { IntelEvent } from "../src/types/event";
import type { CohortManifest } from "../src/data/manifest";

const base: IntelEvent = {
  id: "1",
  title: "t",
  region: "臺北市",
  timestamp: "2026-06-14T00:00:00+08:00",
  category: "治安",
  scope: "domestic",
  riskLevel: "low",
  summary: "s",
  source: { name: "x", type: "manual", fetchedAt: "2026-06-15T00:00:00+08:00" },
};

const evs: IntelEvent[] = [
  base,
  { ...base, id: "2", category: "災防", riskLevel: "high" },
  { ...base, id: "3", scope: "international", category: "資安", riskLevel: "critical" },
];

describe("filterEvents", () => {
  it("filters by scope", () => {
    expect(filterEvents(evs, { scope: "domestic" }).map((e) => e.id)).toEqual(["1", "2"]);
  });

  it("filters by category", () => {
    expect(filterEvents(evs, { scope: "domestic", category: "災防" }).map((e) => e.id)).toEqual(["2"]);
  });

  it("filters by minimum risk", () => {
    expect(filterEvents(evs, { minRisk: "high" }).map((e) => e.id)).toEqual(["2", "3"]);
  });

  it("filters by source name", () => {
    const events: IntelEvent[] = [
      { ...base, id: "a", source: { name: "中央社", type: "manual", fetchedAt: "2026-06-15T00:00:00+08:00" } },
      { ...base, id: "b", source: { name: "警政署", type: "manual", fetchedAt: "2026-06-15T00:00:00+08:00" } },
      { ...base, id: "c", source: { name: "自建", type: "manual", fetchedAt: "2026-06-15T00:00:00+08:00" } },
    ];
    expect(filterEvents(events, { source: "警政署" }).map((e) => e.id)).toEqual(["b"]);
  });

  it("依官方／媒體警政新聞定義篩選", () => {
    const events: IntelEvent[] = [
      { ...base, id: "official-api", source: { ...base.source, datasetId: "7505" } },
      { ...base, id: "official-rss", source: { ...base.source, datasetId: "tw-news", authority: "official" } },
      { ...base, id: "media-rss", source: { ...base.source, datasetId: "tw-news" } },
      { ...base, id: "other-official", source: { ...base.source, datasetId: "E-A0015-001" } },
    ];

    expect(filterEvents(events, { newsAuthority: "official" }).map((e) => e.id)).toEqual([
      "official-api",
      "official-rss",
    ]);
    expect(filterEvents(events, { newsAuthority: "media" }).map((e) => e.id)).toEqual(["media-rss"]);
  });

  it("用 sinceDays 下界時，會排除低於 cutoff 的事件", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-06-20T00:00:00+08:00"));
      const events: IntelEvent[] = [
        { ...base, id: "old", timestamp: "2026-06-12T10:00:00+08:00" },
        { ...base, id: "in-range", timestamp: "2026-06-18T10:00:00+08:00" },
      ];
      expect(filterEvents(events, { sinceDays: 3 }).map((e) => e.id)).toEqual(["in-range"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("非法 timestamp 在指定 sinceDays 時被排除，但可透過 includeUnknownTime 保留", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-06-20T00:00:00+08:00"));
      const events: IntelEvent[] = [
        { ...base, id: "invalid-time", timestamp: "not-a-number" },
        { ...base, id: "old", timestamp: "2026-06-12T10:00:00+08:00" },
      ];
      expect(filterEvents(events, { sinceDays: 3 }).map((e) => e.id)).toEqual([]);
      expect(filterEvents(events, { sinceDays: 3, includeUnknownTime: true }).map((e) => e.id)).toEqual(["invalid-time"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("排除超過明日的離譜未來時間資料", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-06-21T00:00:00+08:00"));
      const events = [
        { ...base, id: "now", timestamp: "2026-06-20T10:00:00+08:00" },
        { ...base, id: "future", timestamp: "2066-02-22T12:00:00+08:00" },
      ];
      expect(filterEvents(events, { sinceDays: 3 }).map((e) => e.id)).toEqual(["now"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("支援地區篩選與台／臺異體字正規化匹配", () => {
    const events: IntelEvent[] = [
      { ...base, id: "tp-main", region: "臺北市" },
      { ...base, id: "tp-sub", region: "台北市中正區" },
      { ...base, id: "ntp", region: "新北市" },
      { ...base, id: "tc", region: "臺中市西區" },
    ];

    expect(filterEvents(events, { region: "臺北市" }).map((e) => e.id)).toEqual(["tp-main", "tp-sub"]);
    expect(filterEvents(events, { region: "台北市" }).map((e) => e.id)).toEqual(["tp-main", "tp-sub"]);
    expect(filterEvents(events, { region: "台中市" }).map((e) => e.id)).toEqual(["tc"]);
    expect(filterEvents(events, { region: "新北市" }).map((e) => e.id)).toEqual(["ntp"]);
  });
});

import { explainOutOfFilter } from "../src/data/loader";

describe("explainOutOfFilter", () => {
  it("回傳未符條件之明確原因，符合時回傳空陣列", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-06-20T00:00:00+08:00"));
      const event: IntelEvent = {
        ...base,
        id: "ev-out",
        category: "治安",
        riskLevel: "low",
        region: "臺南市",
        timestamp: "2026-06-10T00:00:00+08:00", // 10 days ago
      };

      const reasons = explainOutOfFilter(event, {
        category: "反詐",
        minRisk: "high",
        region: "臺北市",
        sinceDays: 3,
        query: "投資",
      });

      expect(reasons).toContain("分類非「反詐」");
      expect(reasons).toContain("風險未達「high」");
      expect(reasons).toContain("地點非「臺北市」");
      expect(reasons).toContain("時間超出近 3 天");
      expect(reasons).toContain("未含關鍵字「投資」");

      // 符合條件時
      const matchingEvent: IntelEvent = {
        ...base,
        id: "ev-match",
        category: "反詐",
        riskLevel: "high",
        region: "臺北市中正區",
        timestamp: "2026-06-19T10:00:00+08:00",
        title: "投資詐騙破獲",
      };
      expect(explainOutOfFilter(matchingEvent, {
        category: "反詐",
        minRisk: "high",
        region: "台北市",
        sinceDays: 3,
        query: "投資",
      })).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("loadEvents / loadMapEvents 有界載入", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 永不回應的 fetch（尊重 abort signal）：沒有預設逾時時 loadEvents 會永久等待，
  // 讓 main.ts 的 cohortPairInflight 去重快取被一筆不 settle 的請求佔住，連手動重試都失效。
  const hangUntilAborted = () =>
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal;
          if (signal?.aborted) {
            reject(signal.reason ?? new DOMException("aborted", "AbortError"));
            return;
          }
          signal?.addEventListener("abort", () =>
            reject(signal.reason ?? new DOMException("aborted", "AbortError")),
          );
        }),
    );

  const lockedMapManifest = (): CohortManifest => ({
    manifestVersion: 1, snapshotId: "owned-map-timeout", generatedAt: "2026-10-09T00:00:00.000Z", rulesVersion: "correlate-v1",
    scopes: {
      domestic: { events: "domestic.json", map: "domestic.map.json", network: "network.json" },
      international: { events: "international.json", map: "international.map.json", network: "network.json" },
    },
    files: { "domestic.map.json": { path: "domestic.map.json", sha256: createHash("sha256").update("[]").digest("hex"), bytes: 2 } },
  });

  it("loadEvents 逾時後 reject（TimeoutError），不永久佔住呼叫端", async () => {
    const { loadEvents } = await import("../src/data/loader");
    hangUntilAborted();
    const err = await loadEvents("domestic", { timeoutMs: 5 }).then(
      () => null,
      (e: unknown) => e as DOMException,
    );
    expect(err?.name).toBe("TimeoutError");
  });

  it("loadMapEvents 逾時後 fail-soft 回 null，不把等待丟給 first-paint", async () => {
    const { loadMapEvents } = await import("../src/data/loader");
    const fetchSpy = hangUntilAborted();
    await expect(loadMapEvents("domestic", { manifest: lockedMapManifest(), timeoutMs: 5 })).resolves.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("./data/domestic.map.json");
    const signal = fetchSpy.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason?.name).toBe("TimeoutError");
  });

  it("呼叫端 signal abort 時 loadEvents 立即放棄，不等預設逾時", async () => {
    const { loadEvents } = await import("../src/data/loader");
    hangUntilAborted();
    const controller = new AbortController();
    const promise = loadEvents("domestic", { signal: controller.signal, timeoutMs: 60_000 });
    controller.abort();
    await expect(promise).rejects.toThrow();
  });

  it("呼叫端 signal abort 時具名 map 真正中止已開始的 fetch", async () => {
    const { loadMapEvents } = await import("../src/data/loader");
    const fetchSpy = hangUntilAborted();
    const controller = new AbortController();
    const promise = loadMapEvents("domestic", { manifest: lockedMapManifest(), signal: controller.signal, timeoutMs: 60_000 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("./data/domestic.map.json");
    const signal = fetchSpy.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    controller.abort();
    await expect(promise).resolves.toBeNull();
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toBe(controller.signal.reason);
  });
});
