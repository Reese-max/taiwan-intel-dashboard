import { describe, expect, it } from "vitest";
import { clusterSummariesForScope, type AiSummary } from "../src/components/AiBrief";

// 回歸測試：clusterSummaries 只為國內群生成，cluster id（c0/c1/c2…）跨 scope 撞號。
// 國際 scope 不可套用，否則國際群會誤掛同號的國內群摘要（實際案例：國際資安群 c1
// 顯示國內治安摘要「近期台灣治安事件與天災頻傳…」）。
const summary: AiSummary = {
  domestic: "國內摘要",
  international: "國際摘要",
  clusterSummaries: {
    c0: "國內群 c0：集會遊行",
    c1: "近期台灣治安事件與天災頻傳，含毒品走私、偷拍、共諜及水患等。",
  },
  generatedAt: "2026-06-27T05:37:00+08:00",
};

describe("clusterSummariesForScope", () => {
  it("國內 scope 回傳完整 clusterSummaries", () => {
    const map = clusterSummariesForScope(summary, "domestic");
    expect(map.c1).toBe(summary.clusterSummaries!.c1);
    expect(Object.keys(map)).toHaveLength(2);
  });

  it("國際 scope 一律回空，避免國內群摘要污染同號國際群", () => {
    const map = clusterSummariesForScope(summary, "international");
    expect(map).toEqual({});
    expect(map.c1).toBeUndefined();
  });

  it("summary 為 null 時回空物件，不丟錯", () => {
    expect(clusterSummariesForScope(null, "domestic")).toEqual({});
    expect(clusterSummariesForScope(null, "international")).toEqual({});
  });

  it("summary 無 clusterSummaries 欄位時國內 scope 也回空", () => {
    const bare: AiSummary = { domestic: "x", international: "y", generatedAt: "2026-06-27T00:00:00+08:00" };
    expect(clusterSummariesForScope(bare, "domestic")).toEqual({});
  });
});
