import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { buildCategoryBasisDistribution, buildTwNewsEvents } from "../scripts/fetch-live.mjs";
// @ts-expect-error — JS ESM module without types
import { titleKey } from "../scripts/lib/title-key.mjs";
// @ts-expect-error — JS ESM module without types
import { isPoliceDomesticEvent } from "../scripts/lib/fetch-police.mjs";
// @ts-expect-error — JS ESM module without types
import { eventIdFor, normalizeDomesticNews, partitionByCache } from "../scripts/lib/nvidia.mjs";

const news = (id: string, timestamp: string, source: Record<string, unknown> = {}) => ({
  id,
  title: id,
  timestamp,
  source: { datasetId: "tw-news", recordRef: `https://example.com/${id}`, ...source },
});

describe("twnews carry-over retention", () => {
  // figurative-overseas regression start
  it.each([{ ok: false }, { skipped: true }, { ok: true }])("沿用時清除比喻與境外當地新聞：%j", (twnewsStatus) => {
    const timestamp = "2026-11-17T00:00:00.000Z";
    const oldNews = [
      { ...news("figurative", timestamp), title: "外資殺人不眨眼 連兩日狠砍0050近17萬張", summary: "外資殺人不眨眼 連兩日狠砍0050近17萬張", categoryBasis: "hint:治安" },
      { ...news("summary-only", timestamp), title: "產業焦點", summary: "搶攻AI商機", categoryBasis: "hint:反詐" },
      { ...news("overseas", timestamp, { name: "香港01" }), title: "羅湖口岸海關查獲體內藏毒案", summary: "越南籍外籍移工涉案" },
      { ...news("taiwan", timestamp, { name: "香港01" }), title: "歌手遭槍擊恐嚇", summary: "台灣歌手急報警" },
      { ...news("food", timestamp, { name: "Singtaousa" }), title: "高雄校園午餐食安連環爆 三杯雞驚見完整青蛙", categoryBasis: "hint:食安" },
      { ...news("crime", timestamp), title: "外資大砍持股 公司涉詐遭搜索" },
      { ...news("llm-food", timestamp), title: "搶購潮後爆食安疑慮 業者宣布回收雞蛋", summary: "搶購潮後爆食安疑慮 業者宣布回收雞蛋", category: "食安", categoryBasis: "llm" },
      { ...news("tvbs", timestamp, { name: "TVBS新聞網" }), title: "超市偷竊案" },
      { ...news("official", timestamp, { authority: "official" }), title: "搶先體驗新設施" },
      { ...news("other-dataset", timestamp, { datasetId: "13166", name: "香港01" }), title: "搶攻新市場" },
      { ...news("international", timestamp, { name: "香港01" }), title: "超市偷竊案", scope: "international" },
    ];
    const result = buildTwNewsEvents({ oldNews, twnews: "ok" in twnewsStatus && twnewsStatus.ok ? oldNews : [], twnewsStatus, now: Date.parse("2026-11-18T00:00:00.000Z") });
    expect(result.map((e: { id: string }) => e.id)).toEqual(["taiwan", "food", "crime", "llm-food", "tvbs", "official", "other-dataset", "international"]);
  });
  // figurative-overseas regression end

  it("外國複核的剔除只套用在同樣是外國候選的事件，同標題的食安、官方與台灣摘要事件保留", () => {
    const timestamp = "2026-11-25T10:00:00.000Z";
    const title = "日本青森蘋果農藥超標遭裁罰";
    const events = [
      { ...news("media", timestamp, { name: "GN 綜合治安" }), title, categoryBasis: "hint:治安", category: "治安" },
      { ...news("food", timestamp, { name: "GN 食安" }), title, categoryBasis: "hint:食安", category: "食安" },
      { ...news("official", timestamp, { authority: "official" }), title, categoryBasis: "hint:治安", category: "治安" },
      { ...news("tw-summary", timestamp, { name: "GN 綜合治安" }), title, summary: "台灣代理商已預防性下架", categoryBasis: "hint:治安", category: "治安" },
    ];
    const llmForeignDropKeys = new Set([titleKey(title)]);
    // 同標題會被去重，逐則各跑一次。
    const kept = events.filter((event) => buildTwNewsEvents({
      oldNews: [event], twnews: [], twnewsStatus: { ok: false }, llmForeignDropKeys, now: Date.parse("2026-11-25T12:00:00.000Z"),
    }).length === 1).map((e) => e.id);
    expect(kept).toEqual(["food", "official", "tw-summary"]);
  });

  it.each([{ ok: false }, { skipped: true }, { ok: true }])("沿用時清除央廣[國際]欄目與移民署全文誤收：%j", (twnewsStatus) => {
    const timestamp = "2026-11-24T00:00:00.000Z";
    const oldNews = [
      { ...news("rti-intl", timestamp, { name: "中央廣播電臺 RSS" }), title: "[國際] 塞爾維亞校園槍擊案釀2傷 17歲犯案少年遭逮", categoryBasis: "hint:治安" },
      { ...news("rti-cross-strait", timestamp, { name: "中央廣播電臺 RSS" }), title: "[兩岸] 共諜案起訴 退役軍官遭求刑", categoryBasis: "hint:治安" },
      { ...news("imm-econ", timestamp, { name: "移民署 新聞" }), title: "10月進口物價漲幅創近50年最大 主計總處：無輸入性通膨",
        summary: "主計總處近日公布10月消費者物價指數（CPI）年增2.33%，漲幅收斂。", categoryBasis: "hint:治安" },
      { ...news("imm-case", timestamp, { name: "移民署 新聞" }), title: "移民署查獲非法仲介藏匿18名失聯移工 全案移送", categoryBasis: "hint:治安" },
    ];
    const result = buildTwNewsEvents({ oldNews, twnews: "ok" in twnewsStatus && twnewsStatus.ok ? oldNews : [], twnewsStatus, now: Date.parse("2026-11-25T00:00:00.000Z") });
    expect(result.map((e: { id: string }) => e.id)).toEqual(["rti-cross-strait", "imm-case"]);
  });

  it.each([{ ok: false }, { skipped: true }, { ok: true }])("重用新聞重算規則分類，保留官方、LLM 與人工來源：%j", (twnewsStatus) => {
    const timestamp = "2026-07-09T00:00:00.000Z";
    const oldNews = ["rule:交通", "hint:交通", "default", "official-feed-hint", "llm", "curation:reviewed"].map((basis) => ({
      ...news(basis, timestamp), scope: "domestic", title: `騎士車內藏安非他命${basis}遭逮起訴`,
      category: "交通", categoryBasis: basis,
    }));
    // 人工審核事件與一般事件同標題時仍各自保留。
    const curated = { ...oldNews[0], ...news("curated", timestamp), title: oldNews[0].title, curated: { id: "review-1" } };
    const result = buildTwNewsEvents({
      oldNews: [...oldNews, curated],
      twnews: "ok" in twnewsStatus && twnewsStatus.ok ? [oldNews[0]] : [],
      twnewsStatus, now: Date.parse("2026-07-10T00:00:00.000Z"),
    });
    expect(result).toHaveLength(7);
    for (const event of result.slice(0, 3)) {
      expect(event).toMatchObject({ category: "治安", categoryBasis: "rule:治安" });
    }
    for (const event of result.slice(3)) expect(event.category).toBe("交通");
    expect(oldNews[0].category).toBe("交通"); // 不修改輸入快照
  });

  it("快取與正規化重用路徑重算已失效規則，保留受保護的分類來源", async () => {
    const bases = ["rule:交通", "hint:交通", "default", "official-feed-hint", "llm", "curation:reviewed"];
    const items = bases.map((_, i) => ({ title: i < 3 ? `韭菜翻車 違約交割${i}千萬元` : `騎士車內藏安非他命${i}百顆`, link: `https://example.com/cache-${i}`, hint: "治安" }));
    const prior = new Map(items.map((item, i) => {
      const id = eventIdFor("domestic", item.link);
      return [id, { ...news(id, "2026-07-09T00:00:00.000Z"), title: item.title, scope: "domestic", category: "交通", categoryBasis: bases[i] }];
    }));
    const cached = partitionByCache(items, "domestic", prior);
    expect(cached.fresh).toEqual([]);
    const normalized = await normalizeDomesticNews(items, { priorById: prior }); // 全部命中，不呼叫 LLM
    for (const event of cached.reused.slice(0, 3)) expect(event).toMatchObject({ category: "治安", categoryBasis: "hint:治安" });
    for (const event of cached.reused.slice(3)) expect(event).toMatchObject({ category: "交通", categoryBasis: bases[cached.reused.indexOf(event)] });
    // 正規化路徑沿用既有設計：高信心規則命中時覆寫任何重用分類（見 normalize-cache.test.ts）。
    for (const event of normalized.slice(0, 3)) expect(event).toMatchObject({ category: "治安", categoryBasis: "hint:治安" });
    for (const event of normalized.slice(3)) expect(event).toMatchObject({ category: "治安", categoryBasis: "rule:治安" });
  });

  it("twnews 失敗沿用 oldNews 時也會套 NEWS_RETENTION_DAYS 保留窗", () => {
    const now = Date.parse("2026-07-10T00:00:00.000Z");
    const oldNews = [
      news("keep", "2026-07-09T00:00:00.000Z"),
      news("expired", "2026-06-30T00:00:00.000Z"),
    ];

    const result = buildTwNewsEvents({
      twnews: [],
      oldNews,
      twnewsStatus: { ok: false },
      dropStaleNews: false,
      retentionDays: 5,
      now,
    });

    expect(result.map((e: { id: string }) => e.id)).toEqual(["keep"]);
  });

  it("twnews 失敗沿用 oldNews 時仍會依 recordRef 去重", () => {
    const now = Date.parse("2026-07-10T00:00:00.000Z");
    const duplicated = news("duplicate", "2026-07-09T00:00:00.000Z");

    const result = buildTwNewsEvents({
      oldNews: [duplicated, { ...duplicated, id: "duplicate-copy" }],
      twnewsStatus: { ok: false },
      retentionDays: 5,
      now,
    });

    expect(result.map((e: { id: string }) => e.id)).toEqual(["duplicate"]);
  });

  it("本輪與舊快照以正規化同標題合併轉載變體", () => {
    const now = Date.parse("2026-07-10T00:00:00.000Z");
    const old = { ...news("old", "2026-07-09T00:00:00.000Z"), title: "高雄街頭砍人送醫| 社會萬象| 社會" };
    const fresh = { ...news("fresh", "2026-07-09T01:00:00.000Z"), title: "快訊／高雄街頭砍人送醫 - ETtoday" };
    const result = buildTwNewsEvents({
      twnews: [fresh], oldNews: [old], twnewsStatus: { ok: true }, retentionDays: 5, now,
    });
    expect(result.map((e: { id: string }) => e.id)).toEqual(["fresh"]);
  });

  it("沒有本輪同標題時也合併舊快照中的轉載變體", () => {
    const now = Date.parse("2026-07-10T00:00:00.000Z");
    const old = [
      { ...news("old", "2026-07-09T00:00:00.000Z"), title: "高雄街頭砍人送醫| 社會萬象| 社會" },
      { ...news("old-copy", "2026-07-09T00:30:00.000Z"), title: "快訊／高雄街頭砍人送醫 - ETtoday" },
    ];
    const result = buildTwNewsEvents({ oldNews: old, twnewsStatus: { ok: false }, now });
    expect(result.map((e: { id: string }) => e.id)).toEqual(["old"]);
  });

  it("沿用舊快照時同步清掉新規則判定的移民生活雜訊", () => {
    const now = Date.parse("2026-07-10T00:00:00.000Z");
    const oldNews = [
      news("移民署攜手企業 助新住民子女探索職涯", "2026-07-09T00:00:00.000Z", { name: "移民署 新聞" }),
      news("移民署查獲非法仲介藏匿失聯移工", "2026-07-09T01:00:00.000Z", { name: "移民署 新聞" }),
    ];

    const result = buildTwNewsEvents({
      oldNews,
      twnewsStatus: { ok: false },
      retentionDays: 5,
      now,
    });

    expect(result.map((e: { id: string }) => e.id)).toEqual(["移民署查獲非法仲介藏匿失聯移工"]);
  });

  it("沿用正規化舊新聞時以 summary 清掉反詐宣導與影劇雜訊", () => {
    const now = Date.parse("2026-07-10T00:00:00.000Z");
    const oldNews = [
      {
        ...news("outreach", "2026-07-09T00:00:00.000Z"),
        title: "東勢地政守護長者財產",
        summary: "結合高齡換照講習，宣導不動產防詐。",
      },
      {
        ...news("drama", "2026-07-09T01:00:00.000Z"),
        title: "成毅新劇演警察狂練胸肌 拍攝現場粉絲圍觀",
      },
      {
        ...news("enforcement", "2026-07-09T02:00:00.000Z"),
        title: "警方反詐宣導現場查獲車手並移送",
      },
    ];

    const result = buildTwNewsEvents({ oldNews, twnewsStatus: { ok: false }, retentionDays: 5, now });

    expect(result.map((e: { id: string }) => e.id)).toEqual(["enforcement"]);
  });

  it("媒體與已移除的舊資料集不會混入直接警政 carry-over", () => {
    expect(isPoliceDomesticEvent({ category: "反詐", source: { datasetId: "tw-news", query: "警政新聞" } })).toBe(false);
    expect(isPoliceDomesticEvent({ category: "反詐", source: { datasetId: "176455" } })).toBe(false);
    expect(isPoliceDomesticEvent({ category: "治安", source: { datasetId: "13166" } })).toBe(true);
  });

  it("依事件來源套 advisory 長保留窗，但一般新聞維持短窗", () => {
    const now = Date.parse("2026-07-31T00:00:00.000Z");
    const twnews = [
      news("advisory-20d", "2026-07-11T00:00:00.000Z", { advisory: true }),
      news("general-6d", "2026-07-25T00:00:00.000Z"),
    ];

    const result = buildTwNewsEvents({
      twnews,
      oldNews: [],
      twnewsStatus: { ok: true },
      retentionDays: 5,
      advisoryRetentionDays: 30,
      now,
    });

    expect(result.map((e: { id: string }) => e.id)).toEqual(["advisory-20d"]);
  });

  it("advisory 仍受時間窗限制，不做無界保留", () => {
    const now = Date.parse("2026-07-31T00:00:00.000Z");
    const twnews = [news("advisory-40d", "2026-06-21T00:00:00.000Z", { advisory: true })];

    const result = buildTwNewsEvents({
      twnews,
      oldNews: [],
      twnewsStatus: { ok: true },
      retentionDays: 5,
      advisoryRetentionDays: 30,
      now,
    });

    expect(result.map((e: { id: string }) => e.id)).toEqual([]);
  });

  it("未傳 advisoryRetentionDays 時維持舊單一 retentionDays 行為", () => {
    const now = Date.parse("2026-07-31T00:00:00.000Z");
    const twnews = [news("advisory-20d", "2026-07-11T00:00:00.000Z", { advisory: true })];

    const result = buildTwNewsEvents({
      twnews,
      oldNews: [],
      twnewsStatus: { ok: true },
      retentionDays: 5,
      now,
    });

    expect(result.map((e: { id: string }) => e.id)).toEqual([]);
  });
});

describe("categoryBasis provenance distribution", () => {
  it("彙總帶 categoryBasis 的 twnews 事件，未標者不計入", () => {
    expect(
      buildCategoryBasisDistribution([
        { id: "a", categoryBasis: "llm" },
        { id: "b", categoryBasis: "default" },
        { id: "c", categoryBasis: "default" },
        { id: "d", categoryBasis: "rule:反詐" },
        { id: "e", categoryBasis: "hint:資安" },
        { id: "structured" },
      ]),
    ).toEqual({
      default: 2,
      "hint:資安": 1,
      llm: 1,
      "rule:反詐": 1,
    });
  });
});
