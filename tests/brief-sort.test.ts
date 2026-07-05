import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { sortForBrief } from "../scripts/lib/nvidia.mjs";

const event = (id: string, riskLevel: string, timestamp: string) => ({
  id,
  title: id,
  region: "測試",
  timestamp,
  category: "測試",
  scope: "domestic",
  riskLevel,
  summary: id,
  source: { name: "測試", type: "manual", fetchedAt: "2026-07-05T00:00:00Z" },
});

describe("sortForBrief", () => {
  it("slice 前先按 risk×recency 排序，讓 critical 進入摘要視窗", () => {
    const lowEvents = Array.from({ length: 25 }, (_, i) =>
      event(`low-${i}`, "low", `2026-07-05T00:${String(i).padStart(2, "0")}:00Z`),
    );
    const critical = event("critical-late", "critical", "2026-07-04T00:00:00Z");

    const ids = sortForBrief([...lowEvents, critical]).slice(0, 20).map((e) => e.id);

    expect(ids[0]).toBe("critical-late");
    expect(ids).toContain("critical-late");
  });

  it("同風險取較新事件在前，非法 timestamp 不丟錯且排在同風險最後", () => {
    const ids = sortForBrief([
      event("old-high", "high", "2026-07-04T00:00:00Z"),
      event("invalid-high", "high", "不是日期"),
      event("new-high", "high", "2026-07-05T00:00:00Z"),
      event("medium", "medium", "2026-07-06T00:00:00Z"),
    ]).map((e) => e.id);

    expect(ids).toEqual(["new-high", "old-high", "invalid-high", "medium"]);
  });
});
