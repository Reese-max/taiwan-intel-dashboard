import { afterEach, describe, expect, it, vi } from "vitest";
import { getRealSummaryForScope, renderAiBrief } from "../src/components/AiBrief";

// @ts-expect-error JS ESM module without declarations
import { summarize, formatActionableLlmError } from "../scripts/lib/nvidia.mjs";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("summary pipeline fallback & carryover", () => {
  it("各範圍在連續部分失敗時保留各自文字、時間及實際回應模型", async () => {
    for (const [key, value] of Object.entries({
      SUMMARY_API_KEY: "fake", SUMMARY_BASE_URL: "https://partial.invalid/v1", SUMMARY_MODEL: "configured-model",
      SUMMARY_LLM: "", LLM_FALLBACK_API_KEY: "", LLM_FALLBACK_BASE_URL: "", LLM_API_KEY: "",
      SUMMARY_MAX_RETRIES: "0",
    })) vi.stubEnv(key, value);
    let failing = "國內今日重點事件";
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      const prompt = JSON.parse(options.body).messages[1].content as string;
      if (prompt.includes(failing)) return new Response("bad request", { status: 400 });
      const model = prompt.includes("國際今日重點事件") ? "international-model" : prompt.includes("國內今日重點事件") ? "domestic-model" : "auxiliary-model";
      return Response.json({ model, choices: [{ message: { content: `有效的${model}情勢摘要` } }] });
    }));
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-30T10:00:00Z"));
    const event = { id: "e1", title: "測試事件", summary: "內容", category: "治安", riskLevel: "high", timestamp: "2026-10-30T09:00:00Z", source: { name: "新聞", datasetId: "news-test" } };
    const previousSummary = {
      domestic: "國內舊摘要", international: "國際舊摘要", generatedAt: "2026-10-29T00:00:00Z", model: "old-model", degraded: false,
    };
    const first = await summarize({ domestic: [event], international: [event], previousSummary });
    expect(getRealSummaryForScope(first, "domestic")).toMatchObject({ text: "國內舊摘要", generatedAt: "2026-10-29T00:00:00Z", model: undefined, isStale: true });
    expect(first.lastSuccessful.scopeMetadata.international).toEqual({ generatedAt: "2026-10-30T10:00:00.000Z", model: "international-model" });

    now.mockReturnValue(Date.parse("2026-10-30T11:00:00Z"));
    const second = await summarize({ domestic: [event], international: [event], previousSummary: first });
    expect(getRealSummaryForScope(second, "domestic")).toMatchObject({ text: "國內舊摘要", generatedAt: "2026-10-29T00:00:00Z", model: undefined, isStale: true });
    expect(second.lastSuccessAtByScope).toEqual({ domestic: "2026-10-29T00:00:00Z", international: "2026-10-30T11:00:00.000Z" });

    failing = "國際今日重點事件";
    now.mockReturnValue(Date.parse("2026-10-30T12:00:00Z"));
    const third = await summarize({ domestic: [event], international: [event], previousSummary: second });
    expect(getRealSummaryForScope(third, "international")).toMatchObject({ generatedAt: "2026-10-30T11:00:00.000Z", model: "international-model", isStale: true });
    expect(third.lastSuccessful.scopeMetadata.domestic).toEqual({ generatedAt: "2026-10-30T12:00:00.000Z", model: "domestic-model" });
  });

  it("無法查證舊版部分成功紀錄的範圍時間時，不沿用共用時間冒充確切時間", async () => {
    for (const key of ["SUMMARY_API_KEY", "SUMMARY_BASE_URL", "SUMMARY_LLM", "NVIDIA_API_KEY", "NVIDIA_BASE_URL", "LLM_API_KEY", "LLM_BASE_URL", "LLM_FALLBACK_API_KEY", "LLM_FALLBACK_BASE_URL"]) vi.stubEnv(key, "");
    const event = { id: "e", title: "合成事件", summary: "測試", category: "治安", riskLevel: "high", timestamp: new Date().toISOString(), source: { name: "測試" } };
    const previousSummary = {
      domestic: "AI 摘要暫時無法生成，系統統計備援", international: "國際正常摘要",
      generatedAt: "2026-10-30T12:00:00Z", model: "potentially-wrong-model",
      degraded: { domestic: true, international: false },
      lastSuccessful: { domestic: "國內真正的舊摘要", international: "國際正常摘要", generatedAt: "2026-10-30T12:00:00Z", model: "potentially-wrong-model" },
    };
    const result = await summarize({ domestic: [event], international: [event], previousSummary });
    expect(getRealSummaryForScope(result, "domestic")).toMatchObject({ text: "國內真正的舊摘要", generatedAt: undefined, model: undefined, isStale: true });
    const element = { innerHTML: "" } as HTMLElement;
    renderAiBrief(element, result, "domestic", [event as never]);
    expect(element.innerHTML).toContain("時間未記錄");
    expect(element.innerHTML).not.toContain("potentially-wrong-model");
  });

  it("formatActionableLlmError 針對不同錯誤類型產生精確可操作說明", () => {
    expect(formatActionableLlmError(new Error("缺少 API key（LLM_API_KEY）"))).toContain("缺少 LLM API 金鑰");
    expect(formatActionableLlmError(new Error("缺少 API key（missing env NVIDIA_API_KEY）"))).toContain("missing env NVIDIA_API_KEY");
    expect(formatActionableLlmError(new Error("LLM HTTP 401: unauthorized"))).toContain("HTTP 401");
    expect(formatActionableLlmError(new Error("LLM HTTP 429: rate limit"))).toContain("HTTP 429 quota");
    expect(formatActionableLlmError(new Error("LLM HTTP 429 quota"))).toContain("HTTP 429 quota");
    expect(formatActionableLlmError(new Error("LLM HTTP 410: retired"))).toContain("HTTP 404/410");
    expect(formatActionableLlmError(new Error("LLM HTTP 404: Not Found for account"))).toContain("HTTP 404/410");
    expect(formatActionableLlmError(new Error("LLM HTTP 503: service unavailable"))).toContain("HTTP 5xx");
    expect(formatActionableLlmError(new Error("The operation was aborted (timeout)"))).toContain("請求逾時");
  });

  it("LLM 呼叫失敗時記錄精確 degradedReason，並在降級時繼承上一輪之 lastSuccessful 與 lastSuccessAt", async () => {
    for (const [key, value] of Object.entries({
      SUMMARY_API_KEY: "invalid-key",
      SUMMARY_BASE_URL: "https://summary-auth-failure.invalid/v1",
      SUMMARY_MODEL: "test-model",
      SUMMARY_LLM: "",
      LLM_FALLBACK_API_KEY: "",
      LLM_FALLBACK_BASE_URL: "",
      LLM_API_KEY: "",
    })) vi.stubEnv(key, value);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("Unauthorized", { status: 401 })));

    const event = (id: string, category = "治安") => ({
      id,
      title: `測試事件 ${id}`,
      summary: "內容明細",
      category,
      riskLevel: "low",
      timestamp: new Date().toISOString(),
      source: { name: "新聞", datasetId: "news-test" },
    });

    const previousSummary = {
      domestic: "上期國內成功情勢摘要",
      international: "上期國際成功情勢摘要",
      recent24h: "上期24h脈動",
      trend: "上期趨勢",
      byCategory: { 治安: "治安穩定" },
      degraded: { domestic: false, international: false },
      model: "previous-model",
      generatedAt: "2026-10-29T10:00:00.000Z",
    };

    const result = await summarize({
      domestic: [event("d1"), event("d2")],
      international: [event("i1")],
      previousSummary,
    });

    expect(result.degraded).toEqual({ domestic: true, international: true });
    expect(result.degradedReason.domestic).toContain("HTTP 401");
    expect(result.degradedReason.international).toContain("HTTP 401");
    expect(result.reason).toContain("HTTP 401");
    expect(result.lastSuccessAt).toBe("2026-10-29T10:00:00.000Z");
    expect(result.lastSuccessful).toMatchObject({
      domestic: "上期國內成功情勢摘要",
      international: "上期國際成功情勢摘要",
      generatedAt: "2026-10-29T10:00:00.000Z",
    });
    expect(result.domestic).toContain("國內事件共 2 起");
  });

  it("summarize 自動排除 reference-only rows，避免統計備援與審計閘門計數不符", async () => {
    for (const [key, value] of Object.entries({
      SUMMARY_API_KEY: "key",
      SUMMARY_BASE_URL: "https://mock.invalid/v1",
      SUMMARY_MODEL: "model",
      SUMMARY_LLM: "",
      LLM_FALLBACK_API_KEY: "",
      LLM_FALLBACK_BASE_URL: "",
      LLM_API_KEY: "",
    })) vi.stubEnv(key, value);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("error", { status: 500 })));

    const incident = {
      id: "inc-1",
      title: "真實治安事件",
      summary: "內容",
      category: "治安",
      riskLevel: "medium",
      timestamp: new Date().toISOString(),
      source: { name: "新聞", datasetId: "tw-news" },
    };
    const reference = {
      id: "ref-1",
      title: "高級中等學校教育概況",
      summary: "參考資料",
      category: "其他",
      riskLevel: "low",
      timestamp: new Date().toISOString(),
      source: { name: "統計", datasetId: "124173" }, // REFERENCE_DATASET_ID
    };

    const result = await summarize({
      domestic: [incident, reference],
      international: [],
    });

    expect(result.domestic).toContain("國內事件共 1 起");
    expect(result.domestic).not.toContain("共 2 起");
  });

  it("generate-summary.mjs 排除參考事件、保留上一輪成功摘要並通過 audit:summary", async () => {
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, rmSync, writeFileSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const tempDir = mkdtempSync(join(tmpdir(), "gen-sum-test-"));
    try {
      const now = new Date().toISOString();
      const incident = {
        id: "inc-1",
        title: "測試治安事件",
        summary: "說明",
        category: "治安",
        riskLevel: "medium",
        timestamp: now,
        source: { name: "新聞", datasetId: "tw-news" },
      };
      const reference = {
        id: "ref-1",
        title: "高級中等學校教育概況",
        summary: "參考資料",
        category: "其他",
        riskLevel: "low",
        timestamp: now,
        source: { name: "統計", datasetId: "124173" },
      };
      const prevSummary = {
        domestic: "上期真實國內摘要",
        international: "上期真實國際摘要",
        generatedAt: "2026-10-29T10:00:00Z",
        model: "prev-model",
        degraded: false,
      };

      writeFileSync(join(tempDir, "domestic.json"), JSON.stringify([incident, reference]));
      writeFileSync(join(tempDir, "international.json"), JSON.stringify([]));
      writeFileSync(join(tempDir, "network.json"), JSON.stringify({ domestic: { clusters: [] } }));
      writeFileSync(join(tempDir, "summary.json"), JSON.stringify(prevSummary));

      execFileSync(
        process.execPath,
        ["scripts/generate-summary.mjs"],
        {
          env: {
            ...process.env,
            FETCH_LIVE_DATA_DIR: tempDir,
            LLM_API_KEY: "",
            NVIDIA_API_KEY: "",
            SUMMARY_API_KEY: "",
          },
        }
      );

      const generated = JSON.parse(readFileSync(join(tempDir, "summary.json"), "utf8"));
      expect(generated.degraded).toEqual({ domestic: true, international: false });
      // 國內事件只有 1 起（排除參考資料 1 筆）
      expect(generated.domestic).toContain("國內事件共 1 起");
      expect(generated.domestic).not.toContain("共 2 起");
      // 繼承上期真實摘要
      expect(generated.lastSuccessful).toMatchObject({
        domestic: "上期真實國內摘要",
        generatedAt: "2026-10-29T10:00:00Z",
      });
      expect(generated.lastSuccessAt).toBe("2026-10-29T10:00:00Z");

      // 驗證能通過 audit-summary
      const auditOut = execFileSync(
        process.execPath,
        ["scripts/audit-summary.mjs", `--data-dir=${tempDir}`, "--no-annotations"],
        { encoding: "utf8" }
      );
      expect(auditOut).toContain("SUMMARY_AUDIT_OK");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
