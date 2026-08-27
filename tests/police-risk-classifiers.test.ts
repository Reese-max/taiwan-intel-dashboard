import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { isPoliceDomesticEvent } from "../scripts/lib/fetch-police.mjs";

describe("direct police event classification", () => {
  it("recognizes only direct police and missing-person datasets", () => {
    expect(isPoliceDomesticEvent({ source: { datasetId: "13166" } })).toBe(true);
    expect(isPoliceDomesticEvent({ source: { datasetId: "14420" } })).toBe(true);
    expect(isPoliceDomesticEvent({ id: "crime-week-2026" })).toBe(true);
    expect(isPoliceDomesticEvent({ id: "missing-person" })).toBe(true);
    expect(isPoliceDomesticEvent({ source: { datasetId: "tw-news" } })).toBe(false);
    expect(isPoliceDomesticEvent({ source: { datasetId: "retired-source" } })).toBe(false);
  });
});
