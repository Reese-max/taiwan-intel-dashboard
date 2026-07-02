import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { calibrateIntlRisk } from "../scripts/lib/nvidia.mjs";

const ev = (riskLevel: string, twRelevance: number, title = "一般外交會談", summary = "兩國外長會晤討論經貿") => ({
  id: "intl-x",
  scope: "international",
  category: "金融",
  riskLevel,
  twRelevance,
  title,
  summary,
});

describe("calibrateIntlRisk (deterministic 安全網)", () => {
  it("低台灣關聯 + 無危機關鍵字：high → medium", () => {
    expect(calibrateIntlRisk(ev("high", 10)).riskLevel).toBe("medium");
  });

  it("低台灣關聯 + 無危機關鍵字：critical → high", () => {
    expect(calibrateIntlRisk(ev("critical", 10)).riskLevel).toBe("high");
  });

  it("高台灣關聯（>= floor）：不降級", () => {
    expect(calibrateIntlRisk(ev("high", 60)).riskLevel).toBe("high");
  });

  it("邊界 twRelevance == floor(30)：不降級", () => {
    expect(calibrateIntlRisk(ev("high", 30)).riskLevel).toBe("high");
  });

  it("命中危機關鍵字（戰爭）：即使低關聯也不降級", () => {
    expect(calibrateIntlRisk(ev("critical", 5, "俄烏戰爭升溫", "前線爆發大規模衝突")).riskLevel).toBe("critical");
  });

  it("medium / low 不受影響（不升級、不亂動）", () => {
    expect(calibrateIntlRisk(ev("medium", 5)).riskLevel).toBe("medium");
    expect(calibrateIntlRisk(ev("low", 5)).riskLevel).toBe("low");
  });

  it("不可變：回傳新物件，原事件不被改動", () => {
    const original = ev("high", 5);
    const out = calibrateIntlRisk(original);
    expect(original.riskLevel).toBe("high");
    expect(out).not.toBe(original);
  });

  it("twRelevance 缺失視為 0（低關聯）：high → medium", () => {
    const e: Record<string, unknown> = { id: "intl-y", riskLevel: "high", title: "科技新品發表", summary: "某公司推出新手機" };
    expect(calibrateIntlRisk(e).riskLevel).toBe("medium");
  });
});
