import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error — JS ESM module without types
import {
  normalizeDomesticNews,
  domesticNormalizeFailed,
  eventIdFor,
  intlNormalizeFailed,
  normalizeInternational,
} from "../scripts/lib/nvidia.mjs";

const item = (i: number) => ({
  title: `完全不同的測試標題第${i}號事件內容`,
  link: `https://example.com/news/${i}`,
  description: `摘要 ${i}`,
  source: "測試源",
  pubDate: "2026-07-03T00:00:00Z",
});
const okDomesticCompletion = (content: string) =>
  new Response(JSON.stringify({ model: "intl-test-model", choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
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

describe("normalizeDomesticNews 全批失敗可見性（A3）", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of [
      "LLM_API_KEY",
      "NVIDIA_API_KEY",
      "LLM_MAX_RETRIES",
      "LLM_BASE_URL",
    ]) saved[k] = process.env[k];
    delete process.env.LLM_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.LLM_BASE_URL;
    process.env.LLM_MAX_RETRIES = "0"; // 無 key 必 throw，關重試讓測試快速
    vi.restoreAllMocks();
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("多批全失敗：回傳 []、domesticNormalizeFailed()=true、有 warn+error 留痕", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const items = Array.from({ length: 5 }, (_, i) => item(i));
    const out = await normalizeDomesticNews(items, { max: 10, batchSize: 2, concurrency: 2 });
    expect(out).toEqual([]);
    expect(domesticNormalizeFailed()).toBe(true);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("放棄該批"))).toBe(true);
    expect(error.mock.calls.some((c) => String(c[0]).includes("全批失敗"))).toBe(true);
  });

  it("成功路徑：domesticNormalizeFailed()=false", async () => {
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_BASE_URL = "https://llm.test/v1";
    const fetchMock = vi.fn(async () =>
      okDomesticCompletion(
        JSON.stringify([
          {
            idx: 0,
            title_zh: "警政事件 A",
            summary_zh: "警政摘要 A",
            category: "治安",
            riskLevel: "low",
            region: "台北市",
            lat: -33.8688,
            lng: 151.2093,
            entities: ["A"],
            topic: "警政事件",
            sentiment: "negative",
          },
        ]),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await normalizeDomesticNews([item(1)], { max: 10, batchSize: 2, concurrency: 2 });
    expect(out.length).toBe(1);
    expect(out[0].region).toBe("臺北市");
    expect(out[0].lat).toBeCloseTo(25.0375, 4);
    expect(out[0].lng).toBeCloseTo(121.5637, 4);
    expect(out[0].locationPrecision).toBe("city");
    expect(out[0].locationNote).not.toContain("LLM");
    expect(out[0].category).toBe("治安");
    expect(out[0].categoryBasis).toBe("llm");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.messages.map((m: { content: string }) => m.content).join("\n")).not.toContain("lat, lng");
    expect(domesticNormalizeFailed()).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("LLM 精修後仍套用高信心協尋分類規則", async () => {
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_BASE_URL = "https://llm.test/v1";
    vi.stubGlobal("fetch", vi.fn(async () =>
      okDomesticCompletion(JSON.stringify([{
        idx: 0,
        title_zh: "失智老婦迷航40公里",
        summary_zh: "警方協助返家",
        category: "治安",
        riskLevel: "low",
        region: "屏東縣",
      }]))
    ));

    const out = await normalizeDomesticNews([
      { ...item(2), title: "失智老婦騎三輪車迷航40公里 東港警助返家", hint: "治安" },
    ], { max: 10, batchSize: 2, concurrency: 1 });

    expect(out[0].category).toBe("協尋");
    expect(out[0].categoryBasis).toBe("rule:協尋");
  });

  it("全快取命中（fresh=0）：不標失敗", async () => {
    const items = [item(10), item(11)];
    const prior = new Map(
      items.map((it) => {
        const id = eventIdFor("domestic", it.link);
        return [
          id,
          {
            id,
            title: it.title,
            riskLevel: "low",
            scope: "domestic",
            aiTopic: "舊事件主題",
            source: { name: "測試源", recordRef: it.link, fetchedAt: it.pubDate },
          },
        ];
      }),
    );
    const out = await normalizeDomesticNews(items, { max: 250, priorById: prior });
    expect(out.length).toBe(2);
    expect(domesticNormalizeFailed()).toBe(false);
    expect(out.map((e: { id: string }) => e.id).sort()).toEqual(
      items.map((it) => eventIdFor("domestic", it.link)).sort(),
    );
  });
});
