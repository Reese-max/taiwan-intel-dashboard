import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error — JS ESM module without types
import { normalizeInternational, intlNormalizeFailed } from "../scripts/lib/nvidia.mjs";

const item = (i: number) => ({
  title: `完全不同的測試標題第${i}號事件內容`,
  link: `https://example.com/news/${i}`,
  description: `摘要 ${i}`,
  source: "測試源",
  pubDate: "2026-07-03T00:00:00Z",
});

describe("normalizeInternational 全批失敗可見性（A3）", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ["LLM_API_KEY", "NVIDIA_API_KEY", "LLM_MAX_RETRIES"]) saved[k] = process.env[k];
    delete process.env.LLM_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    process.env.LLM_MAX_RETRIES = "0"; // 無 key 必 throw，關重試讓測試快速
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.restoreAllMocks();
  });

  it("多批全失敗：回傳 []、intlNormalizeFailed()=true、有 warn+error 留痕", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const items = Array.from({ length: 5 }, (_, i) => item(i));
    const out = await normalizeInternational(items, { max: 10, batchSize: 2, concurrency: 2 });
    expect(out).toEqual([]);
    expect(intlNormalizeFailed()).toBe(true);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("放棄該批"))).toBe(true);
    expect(error.mock.calls.some((c) => String(c[0]).includes("全批失敗"))).toBe(true);
  });

  it("全部命中快取（無新項）：不標失敗", async () => {
    // @ts-expect-error — JS ESM module without types
    const { eventIdFor } = await import("../scripts/lib/nvidia.mjs");
    const items = [item(1), item(2)];
    const prior = new Map(
      items.map((it) => {
        const id = eventIdFor("international", it.link);
        return [id, { id, category: "其他", riskLevel: "low", timestamp: it.pubDate }];
      }),
    );
    const out = await normalizeInternational(items, { max: 10, priorById: prior });
    expect(out.length).toBe(2);
    expect(intlNormalizeFailed()).toBe(false);
  });
});
