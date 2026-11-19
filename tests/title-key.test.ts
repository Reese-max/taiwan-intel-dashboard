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
    expect(dedupeTitleKey(`獨家》${base}`)).toBe(dedupeTitleKey(base));
    expect(titleKey(`快訊／${base}| 社會萬象| 社會`)).toBe("快訊新店男子墜樓送醫社會萬象");
  });

  it("does not strip hyphenated product names, model numbers, or CVE identifiers", () => {
    expect(dedupeTitleKey("N-able fixes a security flaw")).toBe("nablefixesasecurityflaw");
    expect(dedupeTitleKey("CVE-2026-11111 vulnerability exposed")).not.toBe(dedupeTitleKey("CVE-2026-90436 vulnerability exposed"));
    expect(dedupeTitleKey("F-16 crash investigation")).not.toBe(dedupeTitleKey("F-35 crash investigation"));
  });

  it("only strips recognized category/media tails and known leading labels", () => {
    expect(dedupeTitleKey("即時｜花蓮外海規模5.8強震")).not.toBe(dedupeTitleKey("即時｜台積電法說會登場"));
    expect(dedupeTitleKey("美–中貿易談判破局")).not.toBe(dedupeTitleKey("美–日安保會議登場"));
    expect(dedupeTitleKey("F-16 - 空軍嘉義基地夜訓")).not.toBe(dedupeTitleKey("F-16 - 花蓮外海例行訓練"));
    expect(dedupeTitleKey("快訊 - 台積電法說會登場")).toBe(dedupeTitleKey("台積電法說會登場"));
    expect(dedupeTitleKey("標題|社會萬象|社會")).toBe(dedupeTitleKey("標題"));
    expect(dedupeTitleKey("女星用藥過量陳屍Airbnb 命案現場- 股市爆料同學會"))
      .toBe(dedupeTitleKey("女星用藥過量陳屍Airbnb 命案現場"));
  });
});
