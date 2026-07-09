import { describe, expect, it } from "vitest";
import { actionDecisionBrief, clusterSummariesForScope, renderAiBrief, type AiSummary } from "../src/components/AiBrief";
import type { IntelEvent } from "../src/types/event";

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

const event: IntelEvent = {
  id: "evt-action",
  title: "詐騙網站新增通報",
  region: "臺北市",
  timestamp: "2026-06-27T00:00:00.000Z",
  category: "反詐",
  scope: "domestic",
  riskLevel: "high",
  summary: "165 通報涉詐網站與銀行帳戶。",
  source: {
    name: "165",
    type: "gov-open-data",
    fetchedAt: "2026-06-27T00:00:00.000Z",
  },
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

  it("AI 摘要可共用行動判斷規則產生決策摘要", () => {
    const text = actionDecisionBrief([event]);

    expect(text).toContain("行動判斷");
    expect(text).toContain("金流／帳戶");
    expect(text).toContain("避免匯款並核對來源");
  });

  it("renderAiBrief 會把行動判斷摘要插入 AI 摘要區", () => {
    const container = { innerHTML: "" } as HTMLElement;

    renderAiBrief(container, summary, "domestic", [event]);

    expect(container.innerHTML).toContain("ai-action");
    expect(container.innerHTML).toContain("行動判斷");
    expect(container.innerHTML).toContain("避免匯款並核對來源");
  });

  it("renderAiBrief 會壓縮長摘要與分類數量，避免側欄過高", () => {
    const container = { innerHTML: "" } as HTMLElement;
    const longSummary: AiSummary = {
      domestic: "國內摘要".repeat(80),
      international: "國際摘要".repeat(80),
      recent24h: "近 24 小時".repeat(40),
      trend: "趨勢".repeat(80),
      byCategory: {
        治安: "治安分類摘要".repeat(30),
        反詐: "反詐分類摘要".repeat(30),
        資安: "資安分類摘要".repeat(30),
        災防: "災防分類摘要不應顯示",
      },
      generatedAt: "2026-06-27T05:37:00+08:00",
    };

    renderAiBrief(container, longSummary, "domestic", []);

    expect(container.innerHTML).toContain("國內摘要國內摘要");
    expect(container.innerHTML).toContain("…");
    expect((container.innerHTML.match(/<li/g) ?? [])).toHaveLength(1);
    expect(container.innerHTML).not.toContain("反詐分類摘要");
    expect(container.innerHTML).not.toContain("資安分類摘要");
    expect(container.innerHTML).not.toContain("災防分類摘要不應顯示");
    expect(container.innerHTML).toContain('title="國內摘要');
  });
});
