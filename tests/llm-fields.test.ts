import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { clampTwRelevance, clampSentiment, cleanActors, cleanRelations, buildDeepAnalysisPrompt } from "../scripts/lib/nvidia.mjs";

describe("LLM optional field clamps", () => {
  it("clampTwRelevance: clamp 0-100, round, non-number/null -> undefined", () => {
    expect(clampTwRelevance(150)).toBe(100);
    expect(clampTwRelevance(-5)).toBe(0);
    expect(clampTwRelevance(0)).toBe(0);
    expect(clampTwRelevance(100)).toBe(100);
    expect(clampTwRelevance(73.6)).toBe(74);
    expect(clampTwRelevance("85")).toBe(85);
    expect(clampTwRelevance("abc")).toBe(undefined);
    expect(clampTwRelevance(undefined)).toBe(undefined);
    expect(clampTwRelevance(null)).toBe(undefined);
    expect(clampTwRelevance("")).toBe(undefined);
  });

  it("clampSentiment: only the four enum values, else undefined", () => {
    expect(clampSentiment("negative")).toBe("negative");
    expect(clampSentiment("neutral")).toBe("neutral");
    expect(clampSentiment("positive")).toBe("positive");
    expect(clampSentiment("mixed")).toBe("mixed");
    expect(clampSentiment("angry")).toBe(undefined);
    expect(clampSentiment("")).toBe(undefined);
    expect(clampSentiment(undefined)).toBe(undefined);
    expect(clampSentiment(null)).toBe(undefined);
  });

  it("cleanActors: trims, dedupes, caps 5, drops too-short/long, non-array -> undefined", () => {
    expect(cleanActors(["Lazarus Group", " APT28 ", "APT28", "x"])).toEqual(["Lazarus Group", "APT28"]);
    expect(cleanActors(["柬埔寨詐騙集團", "竹聯幫"])).toEqual(["柬埔寨詐騙集團", "竹聯幫"]);
    expect(cleanActors(["a".repeat(30)])).toBe(undefined); // too long dropped
    expect(cleanActors(["A", "B"])).toBe(undefined); // single chars (len<2) all dropped -> undefined
    expect(cleanActors(["集團甲", "集團乙", "集團丙", "集團丁", "集團戊", "集團己"]).length).toBe(5); // caps at 5
    expect(cleanActors([])).toBe(undefined);
    expect(cleanActors("not-array")).toBe(undefined);
    expect(cleanActors(undefined)).toBe(undefined);
  });

  it("cleanRelations: keeps valid {from,to,type}, drops malformed, dedupes, caps 8", () => {
    expect(cleanRelations([{ from: "美國", to: "烏克蘭", type: "軍援" }, { from: " 美國 ", to: "烏克蘭", type: "軍援" }])).toEqual([
      { from: "美國", to: "烏克蘭", type: "軍援" },
    ]);
    expect(cleanRelations([{ from: "A", to: "", type: "x" }, { from: "A", to: "B" }])).toBe(undefined); // missing/empty fields
    expect(cleanRelations([{ from: "a".repeat(30), to: "B", type: "t" }])).toBe(undefined); // too long
    expect(
      cleanRelations(Array.from({ length: 12 }, (_, i) => ({ from: `甲${i}`, to: `乙${i}`, type: "關" }))).length,
    ).toBe(8); // caps at 8
    expect(cleanRelations("not-array")).toBe(undefined);
    expect(cleanRelations([])).toBe(undefined);
  });

  it("buildDeepAnalysisPrompt: 2-message prompt embedding the event fields", () => {
    const msgs = buildDeepAnalysisPrompt({
      title: "南海對峙升溫",
      region: "南海",
      category: "地緣政治",
      riskLevel: "critical",
      summary: "兩國艦艇對峙",
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
    expect(msgs[1].content).toContain("南海對峙升溫");
    expect(msgs[1].content).toContain("兩國艦艇對峙");
    expect(msgs[1].content).toContain("影響評估");
  });
});
