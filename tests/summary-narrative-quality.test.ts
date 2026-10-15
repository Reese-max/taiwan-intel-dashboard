import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error JS ESM module without declarations
import { summarize } from "../scripts/lib/nvidia.mjs";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("live summary narrative quality", () => {
  it("marks a reasoning trace as degraded and publishes a labeled statistical brief", async () => {
    for (const [key, value] of Object.entries({
      SUMMARY_API_KEY: "test-key",
      SUMMARY_BASE_URL: "https://summary-quality-test.invalid/v1",
      SUMMARY_MODEL: "test-model",
      SUMMARY_LLM: "",
      LLM_FALLBACK_API_KEY: "",
      LLM_FALLBACK_BASE_URL: "",
      LLM_API_KEY: "",
    })) vi.stubEnv(key, value);

    const leaked = "We need to produce a concise Chinese summary. " + "Analyze the events before answering. ".repeat(25);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      model: "test-model",
      choices: [{ message: { content: leaked } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const event = (scope: string) => ({
      id: `${scope}-1`,
      title: `${scope}測試事件`,
      summary: "有具體事件可查閱",
      category: "治安",
      riskLevel: "low",
      timestamp: new Date(Date.now() - 2 * 86400_000).toISOString(),
    });
    const result = await summarize({ domestic: [event("國內")], international: [event("國際")] });

    expect(result.degraded).toEqual({ domestic: true, international: true });
    expect(result.domestic).toContain("系統統計備援");
    expect(result.international).toContain("系統統計備援");
    expect(JSON.stringify(result)).not.toContain("We need to produce");
  });
});
