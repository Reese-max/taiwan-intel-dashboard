import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error — JS ESM module without types
import { normalizeDomesticNews, normalizeInternational, eventIdFor } from "../scripts/lib/nvidia.mjs";
// @ts-expect-error — JS ESM module without types
import { buildNewsProcessingNote } from "../scripts/lib/provenance.mjs";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let endpoint = 0;

describe.each([
  ["domestic", normalizeDomesticNews],
  ["international", normalizeInternational],
])("%s 新聞精修 provenance", (scope, normalize) => {
  const item = (n: number) => ({ title: `警政專案第${n}號偵破詐騙案件`, description: "警方偵破案件並逮捕嫌犯", link: `https://news.test/${scope}/${n}`, pubDate: new Date().toISOString(), source: "測試新聞", datasetId: scope === "domestic" ? "tw-news" : "international-news" });
  const setup = () => {
    vi.stubEnv("LLM_API_KEY", "test-key");
    vi.stubEnv("LLM_BASE_URL", `https://normalization-${++endpoint}.test/v1`);
    vi.stubEnv("LLM_MODEL", "configured-model");
    vi.stubEnv("LLM_MAX_RETRIES", "0");
    vi.stubEnv("LLM_FALLBACK_API_KEY", "");
    vi.stubEnv("LLM_FALLBACK_BASE_URL", "");
    vi.stubEnv("INTL_DEEP_ANALYSIS", "0");
  };

  it("全批 HTTP 404 不登錄精修輸出", async () => {
    setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    const onNormalized = vi.fn();
    const events = await normalize(Array.from({ length: 10 }, (_, n) => item(n)), { batchSize: 2, onNormalized });
    expect(events).toEqual([]);
    expect(onNormalized).toHaveBeenCalledWith([]);
    expect(buildNewsProcessingNote(events, new Set(), "configured-model")).toContain("本輪無 LLM 新聞精修結果落地");
  });

  it.each(["response-model", undefined])("成功記錄該請求的模型 %s，回呼排除快取", async (model) => {
    setup();
    const current = item(1);
    const cached = item(2);
    const prior = {
      id: eventIdFor(scope, cached.link), title: cached.title, summary: cached.description,
      region: "臺北市", category: "治安", riskLevel: "low", scope, timestamp: cached.pubDate,
      source: { name: cached.source, recordRef: cached.link, model: "old-model", normalizationMethod: "llm", fetchedAt: cached.pubDate },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ model, choices: [{ message: { content: JSON.stringify([{ idx: 0, title_zh: current.title, summary_zh: current.description, category: "治安", riskLevel: "low", region: "臺北市" }]) } }] }))));
    const normalizedSources = new Set();
    const onNormalized = vi.fn((events: any[]) => events.forEach((event) => normalizedSources.add(event.source)));
    const events = await normalize([current, cached], { max: 10, priorById: new Map([[prior.id, prior]]), onNormalized });
    expect(events).toHaveLength(2);
    expect(onNormalized).toHaveBeenCalledOnce();
    expect(onNormalized.mock.calls[0][0]).toHaveLength(1);
    const fresh = onNormalized.mock.calls[0][0][0];
    expect(fresh.source).toMatchObject({ model: model || "configured-model", normalizationMethod: "llm" });
    expect(buildNewsProcessingNote(events, normalizedSources, "configured-model")).toContain(`LLM 精修 1 筆（模型：${model || "configured-model"}）`);
  });
});

it("國際全批失敗後仍保留官方原文備援，但不登錄成 LLM 精修", async () => {
  vi.stubEnv("LLM_API_KEY", "test-key");
  vi.stubEnv("LLM_BASE_URL", "https://official-fallback.test/v1");
  vi.stubEnv("LLM_MODEL", "configured-model");
  vi.stubEnv("LLM_MAX_RETRIES", "0");
  vi.stubEnv("LLM_FALLBACK_API_KEY", "");
  vi.stubEnv("LLM_FALLBACK_BASE_URL", "");
  vi.stubEnv("INTL_DEEP_ANALYSIS", "0");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
  const onNormalized = vi.fn();
  const events = await normalizeInternational(Array.from({ length: 10 }, (_, n) => ({
    title: `官方警政事件第${n}號`, link: `https://police.test/${n}`, source: "Official Police",
    pubDate: new Date().toISOString(), official: true, topic: "police", hint: "治安",
  })), { max: 10, batchSize: 2, onNormalized });
  expect(events).toHaveLength(3);
  expect(events.every((event: any) => event.source.normalizationMethod === "official-police-fallback")).toBe(true);
  expect(onNormalized).toHaveBeenCalledWith([]);
  expect(buildNewsProcessingNote(events, new Set(), "configured-model")).toContain("本輪無 LLM 新聞精修結果落地");
});
