import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { clampTwRelevance } from "../scripts/lib/nvidia.mjs";

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
});
