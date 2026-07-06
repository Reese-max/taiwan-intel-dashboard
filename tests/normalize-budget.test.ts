import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error — JS ESM module without types
import {
  domesticNormalizeFailed,
  intlNormalizeFailed,
  lastDomesticNormalizeSkippedBatches,
  lastIntlNormalizeSkippedBatches,
  normalizeDomesticNews,
  normalizeInternational,
  eventIdFor,
} from "../scripts/lib/nvidia.mjs";

const item = (i: number) => ({
  title: `牆鐘預算測試標題第${i}號完全不同事件`,
  link: `https://example.com/budget/${i}`,
  description: `摘要 ${i}`,
  source: "測試源",
  pubDate: "2026-07-06T00:00:00Z",
});

const priorEvent = (scope: "international" | "domestic", it: ReturnType<typeof item>) => {
  const id = eventIdFor(scope, it.link);
  return [
    id,
    {
      id,
      title: it.title,
      scope,
      category: scope === "international" ? "其他" : "社會",
      riskLevel: "low",
      timestamp: it.pubDate,
      source: { name: "測試源", recordRef: it.link, fetchedAt: it.pubDate },
    },
  ] as const;
};

describe("LLM 正規化牆鐘預算", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ["LLM_API_KEY", "NVIDIA_API_KEY", "LLM_FALLBACK_API_KEY", "LLM_MAX_RETRIES"]) saved[k] = process.env[k];
    delete process.env.LLM_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.LLM_FALLBACK_API_KEY;
    process.env.LLM_MAX_RETRIES = "0";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("international：預算耗盡時整批跳過，回傳快取且不標全批失敗", async () => {
    const items = Array.from({ length: 70 }, (_, i) => item(i));
    const priorById = new Map([priorEvent("international", items[0])]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => (now += 2));

    const out = await normalizeInternational(items, { max: 70, batchSize: 30, concurrency: 2, priorById, budgetMs: 1 });

    expect(out.map((e: { id: string }) => e.id)).toEqual([eventIdFor("international", items[0].link)]);
    expect(lastIntlNormalizeSkippedBatches).toBe(3);
    expect(intlNormalizeFailed()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn.mock.calls.some((c) => String(c[0]).includes("國際正規化 3/3 批因時間預算跳過"))).toBe(true);
  });

  it("international：未耗盡預算時維持既有全批失敗語義", async () => {
    const items = Array.from({ length: 70 }, (_, i) => item(i));
    const out = await normalizeInternational(items, { max: 70, batchSize: 30, concurrency: 2 });

    expect(out).toEqual([]);
    expect(lastIntlNormalizeSkippedBatches).toBe(0);
    expect(intlNormalizeFailed()).toBe(true);
  });

  it("domestic：預算耗盡時整批跳過，回傳快取且不標全批失敗", async () => {
    const items = Array.from({ length: 70 }, (_, i) => item(i));
    const priorById = new Map([priorEvent("domestic", items[0])]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let now = 2_000;
    vi.spyOn(Date, "now").mockImplementation(() => (now += 2));

    const out = await normalizeDomesticNews(items, { max: 70, batchSize: 30, concurrency: 2, priorById, budgetMs: 1 });

    expect(out.map((e: { id: string }) => e.id)).toEqual([eventIdFor("domestic", items[0].link)]);
    expect(lastDomesticNormalizeSkippedBatches).toBe(3);
    expect(domesticNormalizeFailed()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn.mock.calls.some((c) => String(c[0]).includes("國內新聞正規化 3/3 批因時間預算跳過"))).toBe(true);
  });

  it("domestic：未耗盡預算時維持既有全批失敗語義", async () => {
    const items = Array.from({ length: 70 }, (_, i) => item(i));
    const out = await normalizeDomesticNews(items, { max: 70, batchSize: 30, concurrency: 2 });

    expect(out).toEqual([]);
    expect(lastDomesticNormalizeSkippedBatches).toBe(0);
    expect(domesticNormalizeFailed()).toBe(true);
  });
});

