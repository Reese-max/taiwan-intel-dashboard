import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error JS ESM module without declarations
import { summarize, formatActionableLlmError } from "../scripts/lib/nvidia.mjs";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("summary pipeline fallback & carryover", () => {
  it("formatActionableLlmError 針對不同錯誤類型產生精確可操作說明", () => {
    expect(formatActionableLlmError(new Error("缺少 API key（LLM_API_KEY）"))).toContain("缺少 LLM API 金鑰");
    expect(formatActionableLlmError(new Error("LLM HTTP 401: unauthorized"))).toContain("HTTP 401");
    expect(formatActionableLlmError(new Error("LLM HTTP 429: rate limit"))).toContain("HTTP 429");
    expect(formatActionableLlmError(new Error("LLM HTTP 410: retired"))).toContain("HTTP 404/410");
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
