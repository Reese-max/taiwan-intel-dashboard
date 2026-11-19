import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error — JS ESM module without types
import { readIntlCache, serializeIntlCache, updateIntlCache } from "../scripts/lib/intl-normalize-cache.mjs";
// @ts-expect-error — JS ESM module without types
import { eventIdFor, intlFreshNormalized, normalizeInternational } from "../scripts/lib/nvidia.mjs";

const NOW = Date.parse("2026-11-19T00:00:00.000Z");
const DAY = 86400000;
const ev = (id: string, fetchedAt: string) => ({ id, source: { fetchedAt } });

describe("國際正規化跨輪快取", () => {
  it("讀取時丟掉過期的事件與看過不收紀錄", () => {
    const raw = serializeIntlCache({
      events: [ev("a", "2026-11-18T00:00:00.000Z"), ev("old", "2026-11-10T00:00:00.000Z"), { source: {} }],
      rejected: new Map([["r1", "2026-11-18T18:00:00.000Z"], ["r-old", "2026-11-01T00:00:00.000Z"]]),
    });
    const cache = readIntlCache(JSON.parse(JSON.stringify(raw)), { now: NOW, ttlMs: 3 * DAY });
    expect(cache.events.map((e: { id: string }) => e.id)).toEqual(["a"]);
    expect([...cache.rejected.keys()]).toEqual(["r1"]);
    expect(readIntlCache(null, { now: NOW, ttlMs: DAY })).toEqual({ events: [], rejected: new Map() });
  });

  it("看過不收只鎖 12 小時；未來時間戳無效；停用重評時事件不依時間過期", () => {
    const raw = {
      events: [ev("future", "2099-01-01T00:00:00.000Z"), ev("week", "2026-11-12T00:00:00.000Z")],
      rejected: { r13h: "2026-11-18T11:00:00.000Z", r1h: "2026-11-18T23:00:00.000Z", rFuture: "2099-01-01T00:00:00.000Z" },
    };
    const cache = readIntlCache(raw, { now: NOW, ttlMs: 3 * DAY });
    expect(cache.events).toEqual([]);
    expect([...cache.rejected.keys()]).toEqual(["r1h"]);
    expect(readIntlCache(raw, { now: NOW, ttlMs: Infinity }).events.map((e: { id: string }) => e.id)).toEqual(["week"]);
  });

  it("看過不收超過上限時留最新的", () => {
    const cache = { events: [], rejected: new Map([["old1", "a"], ["old2", "b"]]) };
    const out = updateIntlCache(cache, { answeredIds: ["new1", "old1"], now: NOW, maxRejected: 2 });
    expect([...out.rejected.keys()]).toEqual(["new1", "old1"]);
  });

  it("新結果排前面並覆蓋同 id，看過不收的只記沒產出的 id，超過上限丟最舊", () => {
    const cache = { events: [ev("a", "old"), ev("b", "old")], rejected: new Map([["c", "2026-11-18T00:00:00.000Z"]]) };
    const fresh = [{ id: "a", source: { fetchedAt: "new" } }, { id: "c", source: { fetchedAt: "new" } }];
    const out = updateIntlCache(cache, { freshEvents: fresh, answeredIds: ["a", "c", "d"], now: NOW, maxEvents: 2 });
    expect(out.events).toEqual(fresh);
    expect([...out.rejected]).toEqual([["d", "2026-11-19T00:00:00.000Z"]]);
  });
});

describe("normalizeInternational 回報全部新結果", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("未挑進前 max 的新結果也回報；只有有產出的批次算看過", async () => {
    Object.assign(process.env, { LLM_API_KEY: "k", LLM_BASE_URL: "https://llm.test/v1", LLM_MAX_RETRIES: "0", INTL_DEEP_ANALYSIS: "0" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const items = Array.from({ length: 6 }, (_, i) => ({
      title: `完全不同的測試標題第${i}號事件內容`, link: `https://example.com/n/${i}`, description: "", source: "測試源", pubDate: "2026-11-18T00:00:00Z",
    }));
    const event = (idx: number, n: number) => ({ idx, title_zh: `事件${n}`, summary_zh: "摘要", category: "治安", riskLevel: "low", region: "歐洲", lat: 50, lng: 4 });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const prompt = String(init.body);
      // 第 1 批只收第 0 號；第 2 批只收第 2 號；第 3 批零產出。
      const content = prompt.includes("第0號") ? [event(0, 0)] : prompt.includes("第2號") ? [event(0, 2)] : [];
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
    }));
    const out = await normalizeInternational(items, { max: 1, batchSize: 2, concurrency: 1 });
    const id = (i: number) => eventIdFor("international", items[i].link);
    expect(out).toHaveLength(1);
    const { events, answeredIds } = intlFreshNormalized();
    expect(events.map((e: { id: string }) => e.id).sort()).toEqual([id(0), id(2)].sort());
    expect([...answeredIds].sort()).toEqual([id(0), id(1), id(2), id(3)].sort());
  });
});
