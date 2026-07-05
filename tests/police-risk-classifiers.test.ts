import { describe, it, expect } from "vitest";
// @ts-expect-error — JS ESM 模組無型別宣告
import {
  policeNewsRisk,
  drugCrimeRisk,
  assemblyRisk,
  enforcementRisk,
  coordOrCounty,
} from "../scripts/lib/fetch-police.mjs";
import { riskByPrice } from "../scripts/lib/police-mappers.mjs";

describe("riskByPrice", () => {
  it("低於 1000萬 → low", () => {
    expect(riskByPrice(9_999_999)).toBe("low");
  });

  it("剛好 1000萬 → medium", () => {
    expect(riskByPrice(10_000_000)).toBe("medium");
  });

  it("剛好 1億 → high；剛好 10億 → critical", () => {
    expect(riskByPrice(100_000_000)).toBe("high");
    expect(riskByPrice(1_000_000_000)).toBe("critical");
  });

  it("非數值金額仍回傳 low", () => {
    expect(riskByPrice("abc")).toBe("low");
  });
});

describe("policeNewsRisk", () => {
  it("重詞命中（高風險）→ high", () => {
    expect(policeNewsRisk("警方通報疑有爆裂物", "市民通報事件")).toBe("high");
  });

  it("中高風險詞彙（例如酒駕）→ medium", () => {
    expect(policeNewsRisk("最新消息", "疑似酒駕連續作案")).toBe("medium");
  });

  it("高詞彙優先於中詞彙 → high", () => {
    expect(policeNewsRisk("警方查緝", "疑似炸彈疑似搶奪")).toBe("high");
  });

  it("未命中關鍵字 → low", () => {
    expect(policeNewsRisk("治安公告", "警政單位提醒夜間行車")).toBe("low");
  });
});

describe("drugCrimeRisk", () => {
  it("1000g（含 5 人）以上 → high", () => {
    expect(drugCrimeRisk(1000, 1)).toBe("high");
    expect(drugCrimeRisk(800, 5)).toBe("high");
  });

  it("1000g 以下但 50g 以上或 2 人以上 → medium", () => {
    expect(drugCrimeRisk(50, 1)).toBe("medium");
    expect(drugCrimeRisk(49, 2)).toBe("medium");
  });

  it("數值不足 → low", () => {
    expect(drugCrimeRisk(10, 1)).toBe("low");
  });
});

describe("assemblyRisk", () => {
  it("命中組件關鍵詞（道路、封閉等）→ medium", () => {
    expect(assemblyRisk("示威遊行", "府前路封閉管制")).toBe("medium");
  });

  it("未命中關鍵詞 → low", () => {
    expect(assemblyRisk("路權宣導", "正常社區活動")).toBe("low");
  });
});

describe("enforcementRisk", () => {
  it("命中關鍵詞（闖紅燈／危險等）→ medium", () => {
    expect(enforcementRisk("闖紅燈取締", "40")).toBe("medium");
  });

  it("未命中關鍵詞但限速達 80 以上 → medium", () => {
    expect(enforcementRisk("一般巡邏紀錄", "90 km/h")).toBe("medium");
  });

  it("條件不足 → low", () => {
    expect(enforcementRisk("一般巡邏紀錄", "79")).toBe("low");
  });
});

describe("coordOrCounty", () => {
  it("有可用座標時，直接回傳原座標與縣市 region", () => {
    expect(coordOrCounty("台北市", { lat: 25.01, lng: 121.5 })).toEqual({
      lat: 25.01,
      lng: 121.5,
      region: "臺北市",
    });
  });

  it("座標無效時 fallback 到 county 中心", () => {
    expect(coordOrCounty("台北市", { lat: "not-a-number", lng: null, text: "外環道路" })).toMatchObject({
      lat: 25.0375,
      lng: 121.5637,
      region: "臺北市",
    });
  });
});
