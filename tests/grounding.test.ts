import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import {
  groundEntities,
  groundEventEnrichment,
  groundRelations,
  normalizeForMatch,
} from "../scripts/lib/nvidia.mjs";

describe("LLM 富化欄位接地過濾", () => {
  it("threatActor 出現在 title 時保留，未出現的杜撰項丟棄", () => {
    const out = groundEntities(["Lazarus Group", "APT29"], "Lazarus Group 攻擊半導體供應鏈");
    expect(out.value).toEqual(["Lazarus Group"]);
    expect(out.kept).toBe(1);
    expect(out.dropped).toBe(1);
  });

  it("relation 兩端都在原文才保留，一端不在就丟棄", () => {
    const out = groundRelations(
      [
        { from: "美國", to: "烏克蘭", type: "軍援" },
        { from: "北約", to: "火星政府", type: "結盟" },
      ],
      "美國宣布對烏克蘭追加軍援，北約表示支持。",
    );
    expect(out.value).toEqual([{ from: "美國", to: "烏克蘭", type: "軍援" }]);
    expect(out.kept).toBe(1);
    expect(out.dropped).toBe(1);
  });

  it("aiEntities 同樣只保留可在原文命中的項目", () => {
    const out = groundEntities(["臺積電", "不存在組織"], "臺積電擴大資安投資");
    expect(out.value).toEqual(["臺積電"]);
    expect(out.kept).toBe(1);
    expect(out.dropped).toBe(1);
  });

  it("全形與大小寫差異仍可命中", () => {
    expect(normalizeForMatch("ＡＰＴ２８, Microsoft")).toBe("apt28microsoft");
    const out = groundEntities(["apt28", "MICROSOFT"], "ＡＰＴ２８攻擊 Microsoft 帳號");
    expect(out.value).toEqual(["apt28", "MICROSOFT"]);
    expect(out.kept).toBe(2);
    expect(out.dropped).toBe(0);
  });

  it("無富化項不 crash，groundedRatio 為 1", () => {
    const out = groundEventEnrichment({}, "只有標題與摘要");
    expect(out).toEqual({
      aiEntities: undefined,
      threatActors: undefined,
      relations: undefined,
      groundedRatio: 1,
      kept: 0,
      dropped: 0,
    });
  });
});
