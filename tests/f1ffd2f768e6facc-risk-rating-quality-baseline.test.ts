import { describe, expect, it } from "vitest";

import { RISK_ORDER, type RiskLevel } from "../src/types/event";
// @ts-expect-error — JS ESM 模組無型別宣告
import { validateEventContract } from "../scripts/lib/event-contract.mjs";
// @ts-expect-error — JS ESM 模組無型別宣告
import { mapBulkNews } from "../scripts/lib/news-bulk.mjs";
// @ts-expect-error — JS ESM 模組無型別宣告
import { scoreGroundTruthRows } from "../scripts/ground-truth-score.mjs";

const FETCHED_AT = "2026-08-05T00:00:00.000Z";
const MIN_RISK_AGREEMENT = 0.9;
const MAX_SEVERE_MISS_RATE = 0.05;
const RISK_LEVELS = Object.keys(RISK_ORDER) as RiskLevel[];

type RiskFixture = {
  id: string;
  title: string;
  description: string;
  hint: string;
  expectedRisk: RiskLevel;
  articleUrl: string;
  sourceUrl: string;
  publisher: string;
  publisherUrl: string;
  rationale: string;
};

// 固定標註集：articleUrl 是實際新聞項目頁，sourceUrl 是該發布機構的 RSS feed，兩者刻意分離。
const FIXTURES: readonly RiskFixture[] = [
  {
    id: "pts-traffic-outreach-low",
    title: "交通安全入校教育宣導 結合動畫、桌遊寓教於樂",
    description: "交通安全入校教育宣導，教材以常見車禍與大車內輪差建立交通號誌安全觀念。",
    hint: "交通",
    expectedRisk: "low",
    articleUrl: "https://news.pts.org.tw/article/680631",
    sourceUrl: "https://news.pts.org.tw/xml/newsfeed.xml",
    publisher: "公視新聞",
    publisherUrl: "https://news.pts.org.tw/",
    rationale: "標題是交通安全宣導，命中例行宣導詞且沒有事故、暴力或傷亡訊號，正式入口應判為 low。",
  },
  {
    id: "cna-dui-medium",
    title: "男酒駕台中街頭甩尾　自撞逃逸還違保護令遭羈押",
    description: "台中男子酒駕甩尾、自撞逃逸，並因違反保護令遭羈押。",
    hint: "交通",
    expectedRisk: "medium",
    articleUrl: "https://www.cna.com.tw/news/asoc/202608040196.aspx",
    sourceUrl: "https://feeds.feedburner.com/rsscna/social",
    publisher: "中央社",
    publisherUrl: "https://www.cna.com.tw/",
    rationale: "酒駕與肇逃命中中風險犯罪／交通詞，標題未出現高風險暴力或重大傷亡條件，應判為 medium。",
  },
  {
    id: "ltn-smuggling-medium",
    title: "在中國躲20年 通緝犯駕小艇偷渡回台",
    description: "遭通緝男子在中國躲藏多年後，駕駛小艇偷渡回台。",
    hint: "治安",
    expectedRisk: "medium",
    articleUrl: "https://news.ltn.com.tw/news/society/paper/1765423",
    sourceUrl: "https://news.ltn.com.tw/rss/society.xml",
    publisher: "自由時報",
    publisherUrl: "https://news.ltn.com.tw/",
    rationale: "通緝與偷渡命中中風險處置詞，未描述致命暴力或大規模傷亡，應判為 medium。",
  },
  {
    id: "ithome-vulnerability-medium",
    title: "Hugging Face程式庫Diffusers存在漏洞FaceHugger，恐允許模型儲存庫執行任意程式碼",
    description: "程式庫存在漏洞，可能允許模型儲存庫執行任意程式碼，使用者需留意修補。",
    hint: "資安",
    expectedRisk: "medium",
    articleUrl: "https://www.ithome.com.tw/news/177863",
    sourceUrl: "https://www.ithome.com.tw/rss/security",
    publisher: "iThome",
    publisherUrl: "https://www.ithome.com.tw/",
    rationale: "資安主題的單一漏洞命中中風險詞，尚未描述已發生大規模入侵、勒索或資料外洩，應判為 medium。",
  },
  {
    id: "cna-murder-high",
    title: "屏東鎢業董事長命案　離職員工涉殺人遭檢聲押",
    description: "屏東鎢業董事長命案偵辦中，離職員工涉殺人遭檢方聲押。",
    hint: "治安",
    expectedRisk: "high",
    articleUrl: "https://www.cna.com.tw/news/asoc/202608050003.aspx",
    sourceUrl: "https://feeds.feedburner.com/rsscna/social",
    publisher: "中央社",
    publisherUrl: "https://www.cna.com.tw/",
    rationale: "命案與殺人命中高風險暴力規則，屬單一重大致命暴力事件，應判為 high。",
  },
  {
    id: "cna-stabbing-high",
    title: "洗衣機噪音惹殺機　屏東醉男刺死鄰居二審仍判8年",
    description: "屏東男子因噪音衝突刺死鄰居，案件二審仍判刑。",
    hint: "治安",
    expectedRisk: "high",
    articleUrl: "https://www.cna.com.tw/news/asoc/202608040094.aspx",
    sourceUrl: "https://feeds.feedburner.com/rsscna/social",
    publisher: "中央社",
    publisherUrl: "https://www.cna.com.tw/",
    rationale: "刺死命中高風險致命暴力規則，但標題未達多人或大規模傷亡條件，應判為 high。",
  },
  {
    id: "ithome-ransomware-high",
    title: "聯光通遭勒索病毒攻擊，並表示資訊系統逐步恢復運作",
    description: "聯光通遭勒索病毒攻擊，資訊系統逐步恢復運作。",
    hint: "資安",
    expectedRisk: "high",
    articleUrl: "https://www.ithome.com.tw/news/177841",
    sourceUrl: "https://www.ithome.com.tw/rss/security",
    publisher: "iThome",
    publisherUrl: "https://www.ithome.com.tw/",
    rationale: "勒索病毒攻擊並造成系統受影響，命中資安高風險規則，應判為 high。",
  },
  {
    id: "cna-factory-explosion-critical",
    title: "新埔遠東化纖廠氣爆2死 檢警陸續相驗釐清死因",
    description: "新竹縣工廠氣爆造成2死19傷，檢警陸續相驗並釐清死因。",
    hint: "災防",
    expectedRisk: "critical",
    articleUrl: "https://www.cna.com.tw/news/asoc/202502060196.aspx",
    sourceUrl: "https://feeds.feedburner.com/rsscna/social",
    publisher: "中央社",
    publisherUrl: "https://www.cna.com.tw/",
    rationale: "氣爆與死亡同時命中重大災害複合規則，且有多人傷亡，應判為 critical。",
  },
  {
    id: "pts-gas-explosion-critical",
    title: "台中東海商圈民宅瓦斯氣爆 釀4死1傷",
    description: "台中東海商圈民宅發生瓦斯氣爆，造成4死1傷。",
    hint: "災防",
    expectedRisk: "critical",
    articleUrl: "https://news.pts.org.tw/article/494482",
    sourceUrl: "https://news.pts.org.tw/xml/newsfeed.xml",
    publisher: "公視新聞",
    publisherUrl: "https://news.pts.org.tw/",
    rationale: "瓦斯氣爆造成多人死亡與受傷，命中重大災害複合規則，應判為 critical。",
  },
  {
    id: "cna-mall-explosion-critical",
    title: "台中新光三越氣爆4死 檢方朝過失致死等罪調查",
    description: "台中新光三越發生氣爆，造成4死多傷，檢方朝過失致死等罪調查。",
    hint: "災防",
    expectedRisk: "critical",
    articleUrl: "https://www.cna.com.tw/news/asoc/202502140273.aspx",
    sourceUrl: "https://feeds.feedburner.com/rsscna/social",
    publisher: "中央社",
    publisherUrl: "https://www.cna.com.tw/",
    rationale: "氣爆造成4人死亡及多人受傷，屬明確重大公共安全災害，應判為 critical。",
  },
];

function rateFixture(fixture: RiskFixture) {
  const [event] = mapBulkNews(
    [
      {
        title: fixture.title,
        link: fixture.articleUrl,
        description: fixture.description,
        source: fixture.publisher,
        sourceUrl: fixture.sourceUrl,
        publisherName: fixture.publisher,
        publisherUrl: fixture.publisherUrl,
        hint: fixture.hint,
        pubDate: "2026-08-04T00:00:00.000Z",
      },
    ],
    { fetchedAt: FETCHED_AT },
  );
  if (!event) throw new Error(`正式風險評級入口未產出案例：${fixture.id}`);
  return event;
}

describe("風險評級品質基線", () => {
  it.each(FIXTURES)("$id 逐筆通過正式入口並保留合法等級與完整溯源", (fixture) => {
    const event = rateFixture(fixture);
    const contract = validateEventContract([event]);
    const articleUrl = new URL(fixture.articleUrl);
    const sourceUrl = new URL(fixture.sourceUrl);
    const publisherUrl = new URL(fixture.publisherUrl);

    expect(fixture.articleUrl).not.toBe(fixture.sourceUrl);
    expect(articleUrl.protocol).toBe("https:");
    expect(articleUrl.pathname).toMatch(/\/(?:news|article)\//);
    expect(sourceUrl.protocol).toBe("https:");
    expect(publisherUrl.protocol).toBe("https:");
    expect(fixture.publisher.trim()).not.toBe("");
    expect(fixture.rationale.trim()).not.toBe("");
    expect(contract.invalid).toEqual([]);
    expect(contract.valid).toHaveLength(1);
    expect(RISK_LEVELS).toContain(event.riskLevel);
    expect(event.source).toMatchObject({
      name: fixture.publisher,
      type: "news-rss",
      datasetId: "tw-news",
      recordRef: fixture.articleUrl,
      url: fixture.articleUrl,
      fetchedAt: FETCHED_AT,
      publisherName: fixture.publisher,
      publisherUrl: fixture.publisherUrl,
      feedLabel: fixture.publisher,
      ingestMethod: "direct-rss",
      sourceConfidence: "verified",
    });
    expect(event.source.query).toContain(fixture.sourceUrl);
    expect(event.summary).toContain(fixture.description);
  });

  it("由固定標註集機械計算等級一致率與嚴重風險漏判率", () => {
    const rows = FIXTURES.map((fixture) => {
      const event = rateFixture(fixture);
      return {
        id: fixture.id,
        category: event.category,
        riskLevel: event.riskLevel,
        human_risk: fixture.expectedRisk,
      };
    });
    const score = scoreGroundTruthRows(rows);

    expect(score.risk.total).toBe(FIXTURES.length);
    expect(score.risk.rate).toBeGreaterThanOrEqual(MIN_RISK_AGREEMENT);
    expect(score.severeUnderestimation.rate).toBeLessThanOrEqual(MAX_SEVERE_MISS_RATE);
  });
});
