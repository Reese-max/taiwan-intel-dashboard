import { describe, expect, it } from "vitest";
import { titleKey } from "../scripts/lib/title-key.mjs";

describe("titleKey", () => {
  it("keeps long titles distinct when they only differ after the old 40-character prefix", () => {
    const sharedPrefix = "臺北市政府警察局信義分局".repeat(4);
    const fraudAlert = `${sharedPrefix}解除分期付款詐騙`;
    const investmentAlert = `${sharedPrefix}假投資詐騙`;

    expect(titleKey(fraudAlert).slice(0, 40)).toBe(titleKey(investmentAlert).slice(0, 40));
    expect(titleKey(fraudAlert)).not.toBe(titleKey(investmentAlert));
  });

  it("returns the same key for identical titles", () => {
    const title = "高雄街頭砍人 男子背部受傷送醫 - 自由時報";

    expect(titleKey(title)).toBe(titleKey(title));
  });

  it("preserves existing case, full-width punctuation, and media-suffix normalization", () => {
    expect(titleKey("TaIPEI詐騙！｜自由時報")).toBe(titleKey("taipei詐騙 - ETtoday"));
  });
});
