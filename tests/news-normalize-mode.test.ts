import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eventIdFor } from "../scripts/lib/event-id.mjs";
import { warnOnNormalizeFailure } from "../scripts/assert-pipeline-sources.mjs";

vi.mock("../scripts/lib/nvidia.mjs", async (importOriginal) => ({
  ...await importOriginal<object>(),
  normalizeInternational: vi.fn(),
  normalizeDomesticNews: vi.fn(),
  summarize: vi.fn(),
  intlNormalizeFailed: () => true,
  domesticNormalizeFailed: () => true,
}));
vi.mock("../scripts/lib/fetch-rss.mjs", async (importOriginal) => {
  const original = await importOriginal<any>();
  return {
    ...original,
    fetchRssItems: vi.fn(async ({ feeds }) => {
      const domestic = feeds === original.TW_NEWS_FEEDS;
      return {
        items: Array.from({ length: domestic ? 1 : 2 }, () => ({
          title: domestic ? "臺北警方破獲詐騙機房逮捕車手" : "Japan earthquake damages roads",
          description: domestic ? "警方查獲詐騙集團並逮捕嫌犯。" : "Japan earthquake damages roads and buildings.",
          link: `https://example.test/${domestic ? "domestic" : "international"}`,
          pubDate: new Date().toISOString(),
          source: feeds[0].label,
          hint: domestic ? "治安" : "災害",
        })),
        feedStatus: [{ label: feeds[0].label, ok: true, count: 1 }],
      };
    }),
  };
});

let dataDir: string;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  process.exitCode = undefined;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe("新聞正規化模式", () => {
  it.each([[undefined, false], ["rules", false], ["llm", false], ["rules", true]] as const)("NEWS_NORMALIZE_MODE=%s，沿用快取=%s", async (mode, cached) => {
    dataDir = mkdtempSync(join(process.cwd(), ".normalize-test-"));
    vi.stubEnv("FETCH_LIVE_DATA_DIR", dataDir);
    vi.stubEnv("SOURCES", "rss,twnews");
    vi.stubEnv("NEWS_NORMALIZE_MODE", mode);
    vi.stubEnv("EXCLUSIVE", "");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("測試禁止外部網路"); }));
    const llm = await import("../scripts/lib/nvidia.mjs");
    vi.mocked(llm.summarize).mockReset().mockResolvedValue({ domestic: "國內測試摘要", international: "國際測試摘要" });
    if (cached) {
      for (const scope of ["domestic", "international"]) {
        const link = `https://example.test/${scope}`;
        writeFileSync(join(dataDir, `${scope}.json`), JSON.stringify([{
          id: eventIdFor(scope, link),
          title: scope === "domestic" ? "臺北警方破獲詐騙機房逮捕車手" : "日本地震損壞道路",
          summary: "既有精修事件摘要",
          region: scope === "domestic" ? "臺北市" : "日本",
          scope,
          category: scope === "domestic" ? "治安" : "災害",
          riskLevel: "medium",
          timestamp: new Date().toISOString(),
          aiTopic: "既有精修",
          source: { name: "測試來源", type: "news-rss", url: link, recordRef: link, fetchedAt: new Date().toISOString(), datasetId: scope === "domestic" ? "tw-news" : "international-news", normalizationMethod: "llm" },
        }]));
      }
    }
    for (const normalize of [llm.normalizeInternational, llm.normalizeDomesticNews]) {
      vi.mocked(normalize).mockReset().mockImplementation(async () => {
        if (mode !== "llm") throw new Error("規則模式不應呼叫 LLM 正規化");
        return [];
      });
    }
    const { run } = await import("../scripts/fetch-live.mjs");
    await run();
    expect(llm.summarize).toHaveBeenCalledTimes(1);
    const { pipeline } = JSON.parse(readFileSync(join(dataDir, "provenance.json"), "utf8"));
    for (const normalize of [llm.normalizeInternational, llm.normalizeDomesticNews]) {
      expect(normalize).toHaveBeenCalledTimes(mode === "llm" ? 1 : 0);
    }
    for (const scope of ["international", "twnews"]) {
      expect(pipeline[scope]).toMatchObject({ ok: true, bulk: cached ? 0 : 1, enriched: cached ? 1 : 0 });
      if (mode === "llm") {
        expect(pipeline[scope].normalizeMode).toBeUndefined();
        expect(pipeline[scope].normalizeFailed).toBe(true);
      } else {
        expect(pipeline[scope]).toMatchObject({ normalizeMode: "rules", normalizeFailed: false });
        expect(pipeline[scope].normalizeSkippedBatches).toBeUndefined();
      }
    }
  });

  it("INTL_NORMALIZE_MODE=llm 只讓國際新聞走 LLM，國內維持規則", async () => {
    dataDir = mkdtempSync(join(process.cwd(), ".normalize-test-"));
    vi.stubEnv("FETCH_LIVE_DATA_DIR", dataDir);
    vi.stubEnv("SOURCES", "rss,twnews");
    vi.stubEnv("NEWS_NORMALIZE_MODE", undefined);
    vi.stubEnv("INTL_NORMALIZE_MODE", "llm");
    vi.stubEnv("EXCLUSIVE", "");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("測試禁止外部網路"); }));
    const llm = await import("../scripts/lib/nvidia.mjs");
    vi.mocked(llm.summarize).mockReset().mockResolvedValue({ domestic: "國內測試摘要", international: "國際測試摘要" });
    vi.mocked(llm.normalizeInternational).mockReset().mockResolvedValue([]);
    vi.mocked(llm.normalizeDomesticNews).mockReset().mockRejectedValue(new Error("國內不應呼叫 LLM"));
    const { run } = await import("../scripts/fetch-live.mjs");
    await run();
    const { pipeline } = JSON.parse(readFileSync(join(dataDir, "provenance.json"), "utf8"));
    expect(llm.normalizeInternational).toHaveBeenCalledTimes(1);
    expect(llm.normalizeDomesticNews).not.toHaveBeenCalled();
    expect(pipeline.international.normalizeMode).toBeUndefined();
    expect(pipeline.twnews).toMatchObject({ normalizeMode: "rules", normalizeFailed: false });
  });

  it("規則模式不觸發 LLM 故障告警", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(warnOnNormalizeFailure({
      international: { normalizeMode: "rules", normalizeFailed: true, enriched: 0 },
      twnews: { normalizeMode: "rules", normalizeFailed: false, enriched: 0 },
    })).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
