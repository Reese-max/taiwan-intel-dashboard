import { describe, expect, it } from "vitest";
import { getActionDecision } from "../src/utils/actionDecision";
import type { IntelEvent } from "../src/types/event";

const base: IntelEvent = {
  id: "base",
  title: "測試事件",
  region: "臺北市",
  timestamp: "2026-06-27T00:00:00.000Z",
  category: "治安",
  scope: "domestic",
  riskLevel: "medium",
  summary: "摘要",
  source: {
    name: "測試來源",
    type: "gov-open-data",
    fetchedAt: "2026-06-27T00:00:00.000Z",
  },
};

describe("getActionDecision", () => {
  it("依類別與摘要輸出金流帳戶行動建議", () => {
    const decision = getActionDecision({
      ...base,
      category: "反詐",
      title: "詐騙網站新增通報",
      summary: "165 通報涉詐網站與銀行帳戶。",
      riskLevel: "high",
    });

    expect(decision.domain).toBe("金流／帳戶");
    expect(decision.impact).toContain("金流／帳戶");
    expect(decision.recommendation).toBe("避免匯款並核對來源");
  });

  it("高風險聚合新聞優先要求查證原文", () => {
    const decision = getActionDecision({
      ...base,
      riskLevel: "high",
      source: { ...base.source, type: "news-rss", sourceConfidence: "aggregated" },
    });

    expect(decision.recommendation).toBe("先查證原文再行動");
    expect(decision.status).toBe("聚合來源待核");
  });

  it("國際事件依對台關聯分層", () => {
    const low = getActionDecision({ ...base, scope: "international", riskLevel: "high", twRelevance: 10 });
    const high = getActionDecision({
      ...base,
      scope: "international",
      category: "地緣政治",
      title: "區域衝突影響供應鏈",
      riskLevel: "critical",
      twRelevance: 85,
      implications: "可能影響台灣供應鏈。",
    });

    expect(low.impact).toContain("低對台關聯 10");
    expect(low.recommendation).toBe("背景觀察，不升級");
    expect(high.impact).toContain("高對台關聯 85");
    expect(high.recommendation).toBe("列入重點追蹤");
    expect(high.status).toBe("已有影響評估");
  });
});
