import { describe, expect, it } from "vitest";
import { dedupeTitleKey, titleKey } from "../scripts/lib/title-key.mjs";

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

  it("removes repeated outlet/category tails and leading news labels", () => {
    const base = "新店男子墜樓送醫";
    expect(dedupeTitleKey(`${base}| 社會萬象| 社會`)).toBe(dedupeTitleKey(base));
    expect(dedupeTitleKey(`快訊／影／${base} - ETtoday`)).toBe(dedupeTitleKey(base));
    expect(dedupeTitleKey(`獨家：${base}｜自由時報`)).toBe(dedupeTitleKey(base));
    expect(titleKey(`快訊／${base}| 社會萬象| 社會`)).toBe("快訊新店男子墜樓送醫社會萬象");
  });

  it("does not strip hyphenated product names, model numbers, or CVE identifiers", () => {
    expect(dedupeTitleKey("N-able fixes a security flaw")).toBe("nablefixesasecurityflaw");
    expect(dedupeTitleKey("CVE-2026-11111 vulnerability exposed")).not.toBe(dedupeTitleKey("CVE-2026-90436 vulnerability exposed"));
    expect(dedupeTitleKey("F-16 crash investigation")).not.toBe(dedupeTitleKey("F-35 crash investigation"));
  });
});
