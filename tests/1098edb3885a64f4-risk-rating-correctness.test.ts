import { describe, expect, it } from "vitest";

import { RISK_ORDER, type RiskLevel } from "../src/types/event";
// @ts-expect-error — JS ESM modules without types
import { validateEventContract } from "../scripts/lib/event-contract.mjs";
// @ts-expect-error — JS ESM modules without types
import { mapMofaTravelWarningEvent, parseTravelWarning } from "../scripts/lib/fetch-mofa.mjs";

const FETCHED_AT = "2026-08-03T14:15:00.000Z";
const PUBLISHED_AT = "2026-08-03T00:00:00.000Z";
const MOFA_GUIDELINE_URL = "https://www.boca.gov.tw/fp-214-397-cf40a-1.html";

type WarningFixture = {
  officialLevel: 1 | 2 | 3 | 4;
  title: string;
  region: string;
  expectedRisk: RiskLevel;
  publisher: string;
  sourceUrl: string;
  rationale: string;
};

// 外交部領事事務局的公開分級表是此入口的可追溯判定依據；fixture 不連網，避免警示即時變動造成回歸測試不穩。
const FIXTURES: readonly WarningFixture[] = [
  {
    officialLevel: 1,
    title: "第一級：灰色提醒 - 日本 - Japan",
    region: "日本",
    expectedRisk: "low",
    publisher: "外交部領事事務局",
    sourceUrl: MOFA_GUIDELINE_URL,
    rationale: "公開分級表列明「第一級：灰色提醒」；入口以第一級或灰色映射為 low。",
  },
  {
    officialLevel: 2,
    title: "第二級：黃色注意 - 智利 - Chile",
    region: "智利",
    expectedRisk: "medium",
    publisher: "外交部領事事務局",
    sourceUrl: MOFA_GUIDELINE_URL,
    rationale: "公開分級表列明「第二級：黃色注意」；入口以第二級或黃色映射為 medium。",
  },
  {
    officialLevel: 3,
    title: "第三級：橙色避免前往 - 以色列 - Israel",
    region: "以色列",
    expectedRisk: "high",
    publisher: "外交部領事事務局",
    sourceUrl: MOFA_GUIDELINE_URL,
    rationale: "公開分級表列明「第三級：橙色避免前往」；入口以第三級或橙色映射為 high。",
  },
  {
    officialLevel: 4,
    title: "第四級：紅色儘速離境 - 加薩走廊 - Gaza Strip",
    region: "加薩走廊",
    expectedRisk: "critical",
    publisher: "外交部領事事務局",
    sourceUrl: MOFA_GUIDELINE_URL,
    rationale: "公開分級表列明「第四級：紅色儘速離境」；入口以第四級或紅色映射為 critical。",
  },
];

describe("外交部旅遊警示風險評級正確性", () => {
  it("四級列舉、排序與公開分級表一一對應", () => {
    expect(RISK_ORDER).toEqual({ low: 0, medium: 1, high: 2, critical: 3 });
    expect(FIXTURES.map((fixture) => fixture.expectedRisk)).toEqual(["low", "medium", "high", "critical"]);

    for (const fixture of FIXTURES) {
      expect(fixture.publisher).toBe("外交部領事事務局");
      expect(fixture.sourceUrl).toBe(MOFA_GUIDELINE_URL);
      expect(fixture.rationale).toContain(fixture.title.split("：")[0]);
      expect(RISK_ORDER[fixture.expectedRisk]).toBe(fixture.officialLevel - 1);
    }
  });

  it.each(FIXTURES)("第 $officialLevel 級保留公開來源與正確映射：$sourceUrl", (fixture) => {
    const item = {
      title: fixture.title,
      link: fixture.sourceUrl,
      description: `${fixture.publisher}：${fixture.rationale}`,
      pubDate: PUBLISHED_AT,
    };

    expect(parseTravelWarning(item.title)).toEqual({
      region: fixture.region,
      riskLevel: fixture.expectedRisk,
    });

    const event = mapMofaTravelWarningEvent(item, { fetchedAt: FETCHED_AT });
    expect(event).toMatchObject({
      title: fixture.title,
      region: fixture.region,
      timestamp: PUBLISHED_AT,
      scope: "international",
      category: "地緣政治",
      riskLevel: fixture.expectedRisk,
      source: {
        name: "外交部領事事務局 旅遊警示",
        url: fixture.sourceUrl,
        fetchedAt: FETCHED_AT,
        datasetId: "mofa-travel-warning",
      },
    });
    expect(event.summary).toContain(fixture.rationale);
    expect(validateEventContract([event])).toEqual({ valid: [event], invalid: [] });
  });
});
