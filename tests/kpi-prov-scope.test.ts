import { describe, expect, it, beforeEach } from "vitest";
import {
  computeKpiKey,
  computeKpiMetrics,
  computeProvStat,
  computeStatFromEvents,
  getProvStat,
  KPI_TIME_BUCKET_MS,
  renderKpiStrip,
  resetProvCacheForTest,
  setProvCacheForTest,
} from "../src/components/KpiStrip";
import type { IntelEvent } from "../src/types/event";

// 回歸測試：provenance.json 每筆來源帶 scope，KPI「活躍資料源／官方來源占比」須依 scope 過濾，
// 否則國際頁會誤顯國內主導的全域數字（實際案例：國際頁顯示 144/161 與 30% 官方，
// 但國際來源全為 news-rss、官方占比應為 0%）。
const manifest = {
  generatedAt: "2026-06-27T05:37:00+08:00",
  sources: [
    // 國內：3 筆，其中 2 官方（gov-open-data / cwa），全部活躍
    { type: "gov-open-data", scope: "domestic" as const, fetchedAt: "2026-06-27T05:00:00+08:00" },
    { type: "cwa", scope: "domestic" as const, fetchedAt: "2026-06-27T05:00:00+08:00" },
    { type: "news-rss", scope: "domestic" as const, fetchedAt: "2026-06-27T05:00:00+08:00" },
    // 國際：2 筆，皆 news-rss（0 官方），其中 1 筆過期（兩天前）不算活躍
    { type: "news-rss", scope: "international" as const, fetchedAt: "2026-06-27T05:00:00+08:00" },
    { type: "news-rss", scope: "international" as const, fetchedAt: "2026-06-25T00:00:00+08:00" },
    // 時間雖新但本輪失敗，不得顯示為活躍。
    { type: "gov-open-data", scope: "international" as const, fetchedAt: "2026-06-27T05:20:00+08:00", stale: true },
  ],
};

function makeEvent(overrides: Partial<IntelEvent> = {}): IntelEvent {
  return {
    id: "evt-" + Math.random().toString(36).slice(2, 8),
    title: "測試事件",
    region: "台北市",
    timestamp: "2026-06-27T05:00:00+08:00",
    category: "治安",
    scope: "domestic",
    riskLevel: "low",
    summary: "測試摘要",
    source: {
      name: "警政署",
      type: "gov-open-data",
      fetchedAt: "2026-06-27T05:00:00+08:00",
      ...overrides.source,
    },
    ...overrides,
  };
}

function makeFakeContainer(): HTMLElement {
  return {
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: () => [],
  } as unknown as HTMLElement;
}

describe("computeProvStat", () => {
  it("國內：只計國內來源，官方占比正確", () => {
    const stat = computeProvStat(manifest, "domestic")!;
    expect(stat.total).toBe(3);
    expect(stat.active).toBe(3);
    expect(stat.officialPct).toBe(67); // 2/3 → 67%
  });

  it("國際：只計國際來源，官方占比為 0%、過期來源不算活躍", () => {
    const stat = computeProvStat(manifest, "international")!;
    expect(stat.total).toBe(3);
    expect(stat.active).toBe(1); // 過期那筆排除
    expect(stat.officialPct).toBe(33);
  });

  it("manifest 為 null 時回 null，不丟錯", () => {
    expect(computeProvStat(null, "domestic")).toBeNull();
  });

  it("該 scope 無來源時 total=0、officialPct=0（不除以零）", () => {
    const empty = { generatedAt: manifest.generatedAt, sources: [] };
    const stat = computeProvStat(empty, "international")!;
    expect(stat).toEqual({ total: 0, active: 0, officialPct: 0 });
  });

  it("支援 authority: 'official' 判定為官方來源", () => {
    const m = {
      generatedAt: "2026-06-27T05:37:00+08:00",
      sources: [
        { type: "news-rss", authority: "official", scope: "international" as const, fetchedAt: "2026-06-27T05:00:00+08:00" },
        { type: "news-rss", authority: "media", scope: "international" as const, fetchedAt: "2026-06-27T05:00:00+08:00" },
      ],
    };
    const stat = computeProvStat(m, "international")!;
    expect(stat.total).toBe(2);
    expect(stat.active).toBe(2);
    expect(stat.officialPct).toBe(50);
  });
});

describe("computeStatFromEvents", () => {
  it("當 provenance.json 不可用時，從已載入事件彙整計算不重複來源與官方佔比", () => {
    const events: IntelEvent[] = [
      makeEvent({ source: { name: "警政署", type: "gov-open-data", fetchedAt: "2026-06-27T05:00:00+08:00" } }),
      makeEvent({ source: { name: "中央氣象署", type: "cwa", fetchedAt: "2026-06-27T05:00:00+08:00" } }),
      makeEvent({ source: { name: "民間新聞", type: "news-rss", fetchedAt: "2026-06-27T05:00:00+08:00" } }),
      makeEvent({ source: { name: "民間新聞", type: "news-rss", fetchedAt: "2026-06-27T05:00:00+08:00" } }), // 重複來源應去重
    ];
    const stat = computeStatFromEvents(events, "domestic")!;
    expect(stat.total).toBe(3);
    expect(stat.active).toBe(3);
    expect(stat.officialPct).toBe(67); // 2/3 官方
  });

  it("依 scope 過濾事件來源", () => {
    const events: IntelEvent[] = [
      makeEvent({ scope: "domestic", source: { name: "國內來源", type: "gov-open-data", fetchedAt: "2026-06-27T05:00:00+08:00" } }),
      makeEvent({ scope: "international", source: { name: "國際來源", type: "news-rss", fetchedAt: "2026-06-27T05:00:00+08:00" } }),
    ];
    const domesticStat = computeStatFromEvents(events, "domestic")!;
    expect(domesticStat.total).toBe(1);
    expect(domesticStat.officialPct).toBe(100);

    const intlStat = computeStatFromEvents(events, "international")!;
    expect(intlStat.total).toBe(1);
    expect(intlStat.officialPct).toBe(0);
  });

  it("無事件時回傳 null", () => {
    expect(computeStatFromEvents([], "domestic")).toBeNull();
  });
});

describe("getProvStat", () => {
  it("manifest 存在且有來源時優先使用 manifest", () => {
    const events: IntelEvent[] = [
      makeEvent({ source: { name: "臨時來源", type: "news-rss", fetchedAt: "2026-06-27T05:00:00+08:00" } }),
    ];
    const stat = getProvStat(manifest, events, "domestic")!;
    expect(stat.total).toBe(3); // manifest 內為 3
    expect(stat.officialPct).toBe(67);
  });

  it("manifest 為 null 時 fallback 至 events 計算", () => {
    const events: IntelEvent[] = [
      makeEvent({ source: { name: "A", type: "gov-open-data", fetchedAt: "2026-06-27T05:00:00+08:00" } }),
      makeEvent({ source: { name: "B", type: "news-rss", fetchedAt: "2026-06-27T05:00:00+08:00" } }),
    ];
    const stat = getProvStat(null, events, "domestic")!;
    expect(stat.total).toBe(2);
    expect(stat.officialPct).toBe(50);
  });

  it("manifest 與 events 皆無資料時回傳 null", () => {
    expect(getProvStat(null, [], "domestic")).toBeNull();
  });
});

describe("renderKpiStrip source cards", () => {
  beforeEach(() => {
    resetProvCacheForTest();
  });

  it("在 manifest 尚未完成時立即以 loaded events 渲染真實數值", () => {
    const container = makeFakeContainer();
    const events: IntelEvent[] = [
      makeEvent({ source: { name: "來源1", type: "gov-open-data", fetchedAt: "2026-06-27T05:00:00+08:00" } }),
      makeEvent({ source: { name: "來源2", type: "cwa", fetchedAt: "2026-06-27T05:00:00+08:00" } }),
    ];
    renderKpiStrip(container, events, "domestic");

    expect(container.innerHTML).toContain("活躍資料源");
    expect(container.innerHTML).toContain('<span class="kpi-num">2 / 2</span>');
    expect(container.innerHTML).toContain("官方來源占比");
    expect(container.innerHTML).toContain('<span class="kpi-num">100%</span>');
  });

  it("真正無資料時顯示破折號並帶有 tooltip 原因", () => {
    const container = makeFakeContainer();
    setProvCacheForTest(null);
    renderKpiStrip(container, [], "domestic");

    expect(container.innerHTML).toContain("活躍資料源");
    expect(container.innerHTML).toContain('title="目前範圍無可用資料源">—</span>');
    expect(container.innerHTML).toContain("官方來源占比");
    expect(container.innerHTML).toContain('aria-label="活躍資料源：目前範圍無可用資料源"');
    expect(container.innerHTML).toContain('aria-label="官方來源占比：目前範圍無可用資料源"');
  });
});

describe("computeKpiKey 與時間桶分組（Round 2 KPI 快取防過期）", () => {
  // 對齊時間桶起點
  const baseTime = Math.floor(1761800000000 / KPI_TIME_BUCKET_MS) * KPI_TIME_BUCKET_MS;
  const baseBucket = Math.floor(baseTime / KPI_TIME_BUCKET_MS);
  const events = [
    makeEvent({ id: "e1" }),
    makeEvent({ id: "e2" }),
  ];

  it("匯出 KPI_TIME_BUCKET_MS 常數為 5 分鐘（300,000 ms）", () => {
    expect(KPI_TIME_BUCKET_MS).toBe(5 * 60 * 1000);
  });

  it("格式化 KPI key：包含 scope、筆數、首筆 ID 與時間桶", () => {
    const key = computeKpiKey("domestic", events, baseTime);
    expect(key).toBe(`domestic:2:e1:${baseBucket}`);
  });

  it("同一個 5 分鐘時間桶內，key 保持完全穩定，避免冗餘重繪", () => {
    const key1 = computeKpiKey("domestic", events, baseTime);
    const key2 = computeKpiKey("domestic", events, baseTime + 60000); // 1 分鐘後
    const key3 = computeKpiKey("domestic", events, baseTime + 299999); // 4 分 59 秒後（同一桶底）

    expect(key1).toBe(key2);
    expect(key2).toBe(key3);
  });

  it("跨越 5 分鐘邊界時，時間桶遞增，key 變更以觸發重算", () => {
    const keyInitial = computeKpiKey("domestic", events, baseTime);
    const keyAfter5Min = computeKpiKey("domestic", events, baseTime + 5 * 60 * 1000);
    const keyAfter15Min = computeKpiKey("domestic", events, baseTime + 15 * 60 * 1000);

    expect(keyAfter5Min).not.toBe(keyInitial);
    expect(keyAfter5Min).toBe(`domestic:2:e1:${baseBucket + 1}`);
    expect(keyAfter15Min).toBe(`domestic:2:e1:${baseBucket + 3}`);
  });

  it("scope 切換時 key 變更", () => {
    const domesticKey = computeKpiKey("domestic", events, baseTime);
    const intlKey = computeKpiKey("international", events, baseTime);

    expect(domesticKey).not.toBe(intlKey);
    expect(intlKey).toBe(`international:2:e1:${baseBucket}`);
  });

  it("事件筆數或首筆 ID 變更時 key 變更", () => {
    const keyOrig = computeKpiKey("domestic", events, baseTime);
    const keyDifferentCount = computeKpiKey("domestic", [events[0]], baseTime);
    const keyDifferentFirst = computeKpiKey("domestic", [events[1], events[0]], baseTime);

    expect(keyOrig).not.toBe(keyDifferentCount);
    expect(keyOrig).not.toBe(keyDifferentFirst);
  });

  it("無事件空陣列時安全產生 key（首筆 ID 為空字串），不拋出錯誤", () => {
    const emptyKey = computeKpiKey("domestic", [], baseTime);
    expect(emptyKey).toBe(`domestic:0::${baseBucket}`);
  });
});

describe("KPI 近 24h 滾動指標動態過期與重繪驗證", () => {
  beforeEach(() => {
    resetProvCacheForTest();
  });

  it("時間前進時，事件從近 24 小時滾出至前日，指標與 DOM 正確更新", () => {
    const container = makeFakeContainer();
    const t0 = 1761800000000;
    // 事件發生在 t0 前 23 小時（屬於近 24h）
    const eventTimeIso = new Date(t0 - 23 * 3600 * 1000).toISOString();
    const events = [makeEvent({ id: "time-e1", timestamp: eventTimeIso })];

    // 在 t0 渲染：近 24h 應為 1，前日為 0，delta 為 +1
    const metricsAtT0 = computeKpiMetrics(events, t0);
    expect(metricsAtT0.last24h).toBe(1);
    expect(metricsAtT0.prev24h).toBe(0);

    renderKpiStrip(container, events, "domestic", undefined, t0);
    expect(container.innerHTML).toContain("近 24 小時");
    expect(container.innerHTML).toContain('<span class="kpi-num">1</span>');
    expect(container.innerHTML).toContain("+1 較前日");

    // 時間前進 2 小時（變成 t0 + 2h，事件距現在已 25 小時，滾入前 24h~48h 區間）
    const tAfter2h = t0 + 2 * 3600 * 1000;
    const metricsAfter2h = computeKpiMetrics(events, tAfter2h);
    expect(metricsAfter2h.last24h).toBe(0);
    expect(metricsAfter2h.prev24h).toBe(1);

    // key 跨越時間桶改變，驅動重新渲染
    const key1 = computeKpiKey("domestic", events, t0);
    const key2 = computeKpiKey("domestic", events, tAfter2h);
    expect(key1).not.toBe(key2);

    renderKpiStrip(container, events, "domestic", undefined, tAfter2h);
    expect(container.innerHTML).toContain('<span class="kpi-num">0</span>');
    expect(container.innerHTML).toContain("-1 較前日");
  });
});
