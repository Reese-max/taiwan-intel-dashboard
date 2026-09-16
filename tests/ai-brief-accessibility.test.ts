import { describe, expect, it } from "vitest";
import { renderAiBrief, type AiSummary } from "../src/components/AiBrief";
import type { IntelEvent } from "../src/types/event";

function mockContainer(): HTMLElement {
  return { innerHTML: "" } as HTMLElement;
}

const sampleSummary: AiSummary = {
  domestic: "這是超過一百一十個字的國內情報情勢摘要，說明治安與交通問題。" + "重點細節。".repeat(25),
  international: "這是超過一百一十個字的國際情報情勢摘要，說明地緣政治與資安威脅。" + "國際細節。".repeat(25),
  recent24h: "近二十四小時重點動態，包含重大事故與交通即時查驗。" + "即時細節。".repeat(15),
  trend: "整體呈微幅下降，前四日維持近一千二，末日驟跌至九百六十七。" + "趨勢細節。".repeat(15),
  byCategory: {
    治安: "治安分類重點態勢摘要，警政全力打詐。" + "治安補充。".repeat(10),
    反詐: "反詐騙成效檢視，攔阻境外詐欺金流。",
    災防: "強降雨特報發布，低窪地區請注意積淹水。",
  },
  model: "test-model",
  generatedAt: "2026-09-16T12:00:00Z",
};

const sampleEvent: IntelEvent = {
  id: "ev-1",
  title: "詐騙逮捕行動",
  region: "臺北市",
  timestamp: "2026-09-16T10:00:00Z",
  category: "反詐",
  scope: "domestic",
  riskLevel: "high",
  summary: "逮捕多名詐欺車手",
  source: { name: "警政署", type: "gov-open-data", fetchedAt: "2026-09-16T10:05:00Z" },
};

describe("AiBrief — Issue #28 全域範圍標示與篩選區分", () => {
  it("國內 scope 標明國內全域與不隨篩選變動，國際 scope 標明國際全域", () => {
    const c1 = mockContainer();
    renderAiBrief(c1, sampleSummary, "domestic", [sampleEvent]);
    expect(c1.innerHTML).toContain("國內全域");
    expect(c1.innerHTML).toContain("不隨目前篩選條件變動");

    const c2 = mockContainer();
    renderAiBrief(c2, sampleSummary, "international", [sampleEvent]);
    expect(c2.innerHTML).toContain("國際全域");
    expect(c2.innerHTML).toContain("不隨目前篩選條件變動");
  });

  it("行動判斷依傳入之目前篩選事件標示範圍，無符合事件時明確提示", () => {
    const cWithEvents = mockContainer();
    renderAiBrief(cWithEvents, sampleSummary, "domestic", [sampleEvent]);
    expect(cWithEvents.innerHTML).toContain("目前篩選 (1 則)");
    expect(cWithEvents.innerHTML).toContain("行動判斷");

    const cEmpty = mockContainer();
    renderAiBrief(cEmpty, sampleSummary, "domestic", []);
    expect(cEmpty.innerHTML).toContain("目前篩選");
    expect(cEmpty.innerHTML).toContain("無符合事件");
  });

  it("明確區分生成時間標籤，不冒充資料涵蓋期間", () => {
    const c = mockContainer();
    renderAiBrief(c, sampleSummary, "domestic", []);
    expect(c.innerHTML).toContain("生成於");
    expect(c.innerHTML).toContain("test-model");
  });
});

describe("AiBrief — Issue #29 可操作全文展開與無障礙", () => {
  it("超過預覽長度時使用 details/summary 提供可操作展開全文，全文存在於 DOM", () => {
    const c = mockContainer();
    renderAiBrief(c, sampleSummary, "domestic", []);
    expect(c.innerHTML).toContain("ai-expandable");
    expect(c.innerHTML).toContain("<summary");
    expect(c.innerHTML).toContain("ai-full-text");
    expect(c.innerHTML).toContain("展開全文 ▾");
    // 全文內容存在於 DOM
    expect(c.innerHTML).toContain(sampleSummary.domestic);
  });

  it("未超過長度之短文不增加冗餘展開按鈕", () => {
    const shortSummary: AiSummary = {
      domestic: "短摘要",
      international: "短國際摘要",
      generatedAt: "2026-09-16T12:00:00Z",
    };
    const c = mockContainer();
    renderAiBrief(c, shortSummary, "domestic", []);
    expect(c.innerHTML).not.toContain("展開全文 ▾");
    expect(c.innerHTML).toContain("短摘要");
  });

  it("近 24 小時與趨勢若超過預覽長度亦提供展開路徑", () => {
    const c = mockContainer();
    renderAiBrief(c, sampleSummary, "domestic", []);
    expect(c.innerHTML).toContain(sampleSummary.recent24h);
    expect(c.innerHTML).toContain(sampleSummary.trend);
  });

  it("其餘分類摘要提供查看入口，不被直接切除", () => {
    const c = mockContainer();
    renderAiBrief(c, sampleSummary, "domestic", []);
    expect(c.innerHTML).toContain("ai-cats-more");
    expect(c.innerHTML).toContain("查看其餘 2 個分類摘要 ▾");
    expect(c.innerHTML).toContain("反詐");
    expect(c.innerHTML).toContain("災防");
  });
});
