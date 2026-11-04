import { describe, expect, it, vi } from "vitest";

vi.mock("../scripts/lib/llm-client.mjs", () => ({
  chat: vi.fn(async () => "連貫群摘要"),
  extractJson: vi.fn(),
  llmModel: vi.fn(() => "mock-model"),
  respondedModel: vi.fn(() => "mock-model"),
}));

const llm = await import("../scripts/lib/llm-client.mjs");
const { summarizeClusters, summarize } = await import("../scripts/lib/nvidia.mjs");

describe("summarizeClusters", () => {
  it("略過 incoherent 雜燴群，不送 LLM 摘要", async () => {
    const domestic = [
      { id: "a", category: "治安", title: "連貫事件 A", summary: "", description: "", riskLevel: "medium", timestamp: "2026-06-20T00:00:00+08:00" },
      { id: "b", category: "治安", title: "連貫事件 B", summary: "", description: "", riskLevel: "medium", timestamp: "2026-06-20T01:00:00+08:00" },
      { id: "x", category: "交通", title: "雜燴事件 X", summary: "", description: "", riskLevel: "medium", timestamp: "2026-06-20T02:00:00+08:00" },
      { id: "y", category: "天氣", title: "雜燴事件 Y", summary: "", description: "", riskLevel: "medium", timestamp: "2026-06-20T03:00:00+08:00" },
    ];
    const result = await summarizeClusters(
      [
        { id: "junk", members: ["x", "y"], size: 477, incoherent: true },
        { id: "story", members: ["a", "b"], size: 2, incoherent: false },
      ],
      domestic,
      2,
    );

    expect(result).toEqual({ story: "連貫群摘要" });
    expect(vi.mocked(llm.chat)).toHaveBeenCalledTimes(1);
  });
  it("U3：摘要同時輸出排序後的群集成員版本", async () => {
    const domestic = ["乙", "甲"].map((id) => ({ id, title: `合成事件${id}`, summary: "合成事件摘要", category: "治安", riskLevel: "medium", timestamp: new Date().toISOString() }));
    const result = await summarize({ domestic, clusters: [{ id: "c0", members: ["甲", "乙"], size: 2 }] });
    expect(result.clusterSummaries.c0).toBe("連貫群摘要");
    expect(result.clusterVersions).toEqual({ c0: JSON.stringify(["乙", "甲"]) });
  });
});
