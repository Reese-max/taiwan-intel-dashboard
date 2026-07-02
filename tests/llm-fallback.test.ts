import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error — JS ESM module without types
import { normalizeInternational, intlNormalizeFailed } from "../scripts/lib/nvidia.mjs";

const item = (i: number) => ({
  title: `備援測試标题完全相異第${i}號`,
  link: `https://example.com/fb/${i}`,
  description: `摘要 ${i}`,
  source: "測試源",
  pubDate: "2026-07-03T00:00:00Z",
});

const okCompletion = (content: string) =>
  new Response(JSON.stringify({ model: "fallback-model", choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("primary→fallback LLM 備援（C1）", () => {
  const KEYS = [
    "LLM_API_KEY", "NVIDIA_API_KEY", "LLM_MAX_RETRIES",
    "LLM_FALLBACK_API_KEY", "LLM_FALLBACK_BASE_URL", "LLM_FALLBACK_MODEL", "LLM_FALLBACK_MAX_RETRIES",
  ];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    // primary 無 key → 必 throw（不發任何真實網路請求）
    delete process.env.LLM_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    process.env.LLM_MAX_RETRIES = "0";
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("primary 失敗 + fallback 配置：經 fallback 產出事件、不標 normalizeFailed", async () => {
    process.env.LLM_FALLBACK_BASE_URL = "https://fallback.test/v1";
    process.env.LLM_FALLBACK_API_KEY = "fb-key";
    process.env.LLM_FALLBACK_MODEL = "fb-model";
    process.env.LLM_FALLBACK_MAX_RETRIES = "0";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () =>
      okCompletion(
        JSON.stringify([{ idx: 0, title_zh: "備援事件", summary_zh: "s", category: "金融", riskLevel: "low", region: "美國", lat: 1, lng: 2, twRelevance: 10 }]),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const items = Array.from({ length: 5 }, (_, i) => item(i));
    const out = await normalizeInternational(items, { max: 10, batchSize: 2, concurrency: 1 });

    expect(out.length).toBeGreaterThan(0);
    expect(intlNormalizeFailed()).toBe(false);
    // fetch 只該打 fallback 端點（primary 無 key 在 fetch 前就 throw）
    for (const call of fetchMock.mock.calls) expect(String(call[0])).toContain("fallback.test");
    expect(warn.mock.calls.some((c) => String(c[0]).includes("改走 fallback"))).toBe(true);
  });

  it("fallback 未配置：行為不變（全批失敗、標旗）", async () => {
    for (const k of ["LLM_FALLBACK_API_KEY", "LLM_FALLBACK_BASE_URL", "LLM_FALLBACK_MODEL"]) delete process.env[k];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await normalizeInternational(Array.from({ length: 5 }, (_, i) => item(i)), { max: 10, batchSize: 2, concurrency: 1 });
    expect(out).toEqual([]);
    expect(intlNormalizeFailed()).toBe(true);
  });
});
