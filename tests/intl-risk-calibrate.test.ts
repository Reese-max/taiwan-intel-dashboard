import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { calibrateIntlRisk } from "../scripts/lib/nvidia.mjs";

const ev = (
  riskLevel: string,
  twRelevance: number,
  title = "一般外交會談",
  summary = "兩國外長會晤討論經貿",
  category = "金融",
) => ({
  id: "intl-x",
  scope: "international",
  category,
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

  // false-positive 防護：一般商業新聞的常見詞（大規模/違約/死亡）不應誤觸危機擋降級
  it("金融「大規模擴廠」低關聯：不被裸詞誤觸，high → medium", () => {
    expect(calibrateIntlRisk(ev("high", 10, "某科技公司宣布大規模擴廠計畫", "投資設廠")).riskLevel).toBe("medium");
  });

  it("金融「企業違約風險」低關聯：不被裸詞誤觸，high → medium", () => {
    expect(calibrateIntlRisk(ev("high", 10, "債券市場傳企業違約風險上升", "信評下調")).riskLevel).toBe("medium");
  });

  it("其他「企業家病逝」低關聯：不被裸詞誤觸，high → medium", () => {
    expect(calibrateIntlRisk(ev("high", 10, "知名企業家因病死亡享壽82歲", "業界追悼", "其他")).riskLevel).toBe("medium");
  });

  // 真危機用複合詞精確表達，仍應擋降級
  it("金融「主權違約」：真危機不降級", () => {
    expect(calibrateIntlRisk(ev("critical", 10, "某國宣布主權違約", "債務重組談判破裂")).riskLevel).toBe("critical");
  });

  it("「大規模傷亡」：真危機不降級", () => {
    expect(calibrateIntlRisk(ev("critical", 10, "工業事故釀大規模傷亡", "數百人罹難", "其他")).riskLevel).toBe("critical");
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

  it("twRelevance 缺失視為 0（低關聯）：金融類 high → medium", () => {
    const e: Record<string, unknown> = { id: "intl-y", category: "金融", riskLevel: "high", title: "科技新品發表", summary: "某公司推出新手機" };
    expect(calibrateIntlRisk(e).riskLevel).toBe("medium");
  });

  it("地緣政治類：即使低關聯也不降級（保護全球重大衝突）", () => {
    expect(calibrateIntlRisk(ev("high", 5, "他國邊境衝突", "兩國交火", "地緣政治")).riskLevel).toBe("high");
  });

  it("災害類：即使低關聯也不降級（保護全球天災）", () => {
    expect(calibrateIntlRisk(ev("critical", 5, "他國強震", "傷亡慘重", "災害")).riskLevel).toBe("critical");
  });

  it("資安類：即使低關聯也不降級（保護重大漏洞）", () => {
    expect(calibrateIntlRisk(ev("high", 5, "某產品漏洞遭利用", "全球受影響", "資安")).riskLevel).toBe("high");
  });

  it("其他類（產業）：低關聯 high → medium（與金融同屬可降級類）", () => {
    expect(calibrateIntlRisk(ev("high", 5, "某新技術問世", "業界關注", "其他")).riskLevel).toBe("medium");
  });
});
