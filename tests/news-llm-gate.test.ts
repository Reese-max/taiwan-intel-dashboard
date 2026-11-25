import { describe, expect, it, vi } from "vitest";

// @ts-expect-error — JS ESM module without types
import { readVerdicts, reviewNewsRelevance, serializeVerdicts } from "../scripts/lib/news-llm-gate.mjs";
// @ts-expect-error — JS ESM module without types
import { dedupeTitleKey, titleKey } from "../scripts/lib/title-key.mjs";
// @ts-expect-error — JS ESM module without types
import { buildTwNewsEvents } from "../scripts/fetch-live.mjs";

type Msg = { role: string; content: string };
const titlesOf = (messages: Msg[]) => messages[1].content.split("\n").map((line) => line.replace(/^\d+\.\s*/, "").split("｜")[0]);
// 依標題決定要剔除哪些，回傳該次輸入裡的編號（正序、倒序都適用）。
const chatDropping = (dropTitles: string[]) =>
  vi.fn(async (messages: Msg[]) => JSON.stringify({
    drop: titlesOf(messages).flatMap((title, i) => (dropTitles.includes(title) ? [i + 1] : [])),
  }));
const NOW = Date.parse("2026-11-19T00:00:00.000Z");

describe("國內新聞 LLM 複核", () => {
  it("外國地名開頭的候選即使標題有明確案件字眼也送外國提示詞複核，兩次都剔才剔，鍵加 foreign: 前綴", async () => {
    const items = [
      { title: "日本福岡AEON旁男子遇刺亡！兇嫌疑持刀在逃", hint: "治安", source: "GN 三立綜合治安" },
      { title: "日本腦炎今年首例致死！醫籲高風險族群速接種", hint: "治安", source: "GN 三立綜合治安" },
      { title: "日本籍男子西門町醉酒砍傷路人 警方壓制送辦", hint: "治安", source: "GN 三立綜合治安" },
    ];
    const prompts: string[] = [];
    const chatFn = vi.fn(async (messages: Msg[]) => {
      prompts.push(messages[0].content);
      return JSON.stringify({ drop: titlesOf(messages).flatMap((t, i) => (t.startsWith("日本福岡") ? [i + 1] : [])) });
    });
    const verdicts = new Map();
    const { dropped, stats } = await reviewNewsRelevance(items, { verdicts, chatFn, now: NOW });
    // 西門町有台灣地標不列候選；福岡與腦炎送外國複核，模型只剔福岡。
    const foreignCalls = chatFn.mock.calls.filter((c: Msg[][]) => c[0][0].content.includes("都提到外國地名"));
    expect(foreignCalls).toHaveLength(2);
    expect(titlesOf(foreignCalls[0][0]).sort()).toEqual(["日本福岡AEON旁男子遇刺亡！兇嫌疑持刀在逃", "日本腦炎今年首例致死！醫籲高風險族群速接種"].sort());
    expect([...dropped].map((it: { title: string }) => it.title)).toEqual(["日本福岡AEON旁男子遇刺亡！兇嫌疑持刀在逃"]);
    expect(stats).toMatchObject({ foreignCandidates: 2, foreignDropped: 1, failedBatches: 0 });
    expect(verdicts.get(`foreign:${titleKey(items[0].title)}`)).toMatchObject({ keep: false });
    expect(verdicts.get(`foreign:${titleKey(items[1].title)}`)).toMatchObject({ keep: true });

    // 下一輪快取命中不再呼叫；模型失敗時照規則保留。
    const again = await reviewNewsRelevance(items, { verdicts, chatFn: vi.fn(), now: NOW });
    expect([...again.dropped].map((it: { title: string }) => it.title)).toEqual(["日本福岡AEON旁男子遇刺亡！兇嫌疑持刀在逃"]);
    expect(again.stats).toMatchObject({ foreignCandidates: 2, foreignDropped: 1, calls: 0 });
    const failing = await reviewNewsRelevance(items, { verdicts: new Map(), chatFn: vi.fn(async () => { throw new Error("HTTP 500"); }), now: NOW });
    expect(failing.dropped.size).toBe(0);
  });

  it("LLM verdict cache remains keyed by legacy titleKey, not the new dedupe key", async () => {
    const title = "快訊／某品牌新品上市| 生活焦點| 生活";
    const legacyKey = titleKey(title);
    expect(dedupeTitleKey(title)).not.toBe(legacyKey);
    const verdicts = new Map([[legacyKey, { keep: false, at: new Date(NOW).toISOString() }]]);
    const item = { title };
    const chatFn = vi.fn(async () => JSON.stringify({ drop: [] }));
    const { dropped, stats } = await reviewNewsRelevance([item], { verdicts, chatFn, now: NOW });
    expect(stats).toMatchObject({ candidates: 1, cached: 1, reviewed: 0, calls: 0 });
    expect(dropped.has(item)).toBe(true);
    expect(chatFn).not.toHaveBeenCalled();
  });

  it("只送標題沒有明確案件字眼的媒體新聞，兩次都同意才剔除", async () => {
    const items = [
      { title: "蔣萬安急搶小草票也沒用" },
      { title: "男子持刀砍人遭起訴" },
      { title: "警方宣導搶救知識", official: true },
      { title: "群聯假帳風暴10年未完" },
      { title: "「大旗美勝利大會」1支持者不治 柯志恩親自拈香致意" },
      { title: "Micron跌5.67% 台中廠工安意外壓抑買氣" },
    ];
    let call = 0;
    // 第一次（正序）兩則都說剔除，第二次（倒序）只剔小草票 → 只剔小草票。
    const chatFn = vi.fn(async (messages: Msg[]) => {
      call++;
      const drop = call === 1 ? ["蔣萬安急搶小草票也沒用", "群聯假帳風暴10年未完"] : ["蔣萬安急搶小草票也沒用"];
      return JSON.stringify({ drop: titlesOf(messages).flatMap((t, i) => (drop.includes(t) ? [i + 1] : [])) });
    });
    const verdicts = new Map();
    const { dropped, stats } = await reviewNewsRelevance(items, { verdicts, chatFn, now: NOW });
    expect(chatFn).toHaveBeenCalledTimes(2);
    expect(titlesOf(chatFn.mock.calls[0][0])).toEqual(["蔣萬安急搶小草票也沒用", "群聯假帳風暴10年未完"]);
    expect([...dropped].map((it: { title: string }) => it.title)).toEqual(["蔣萬安急搶小草票也沒用"]);
    expect(stats).toMatchObject({ candidates: 2, reviewed: 2, dropped: 1, failedBatches: 0 });
    expect([...verdicts.values()].map((v: { keep: boolean }) => v.keep).sort()).toEqual([false, true]);
  });

  it("第一次沒有要剔除就不問第二次", async () => {
    const chatFn = chatDropping([]);
    const { stats } = await reviewNewsRelevance([{ title: "演唱會搶票" }, { title: "搶小草票" }], { verdicts: new Map(), chatFn, now: NOW });
    expect(chatFn).toHaveBeenCalledTimes(1);
    expect(stats).toMatchObject({ reviewed: 2, dropped: 0, calls: 1 });
  });

  it("快取命中不再呼叫模型，同標題的轉載一起剔除", async () => {
    const verdicts = new Map();
    await reviewNewsRelevance([{ title: "限時搶 漢堡買一送一" }], { verdicts, chatFn: chatDropping(["限時搶 漢堡買一送一"]), now: NOW });
    const chatFn = chatDropping([]);
    const repost = [{ title: "限時搶 漢堡買一送一" }, { title: "限時搶！漢堡買一送一" }];
    const { dropped, stats } = await reviewNewsRelevance(repost, { verdicts, chatFn, now: NOW });
    expect(chatFn).not.toHaveBeenCalled();
    expect(dropped.size).toBe(2);
    expect(stats.cached).toBe(2);
  });

  it("模型失敗或回應異常時照規則保留，也不寫入判斷", async () => {
    for (const chatFn of [
      vi.fn(async () => { throw new Error("HTTP 529"); }),
      vi.fn(async () => "我覺得都可以"),
      vi.fn(async () => JSON.stringify({ drop: [99] })),
    ]) {
      const verdicts = new Map();
      const { dropped, stats } = await reviewNewsRelevance([{ title: "搶小草票" }], { verdicts, chatFn, now: NOW });
      expect(dropped.size).toBe(0);
      expect(stats.failedBatches).toBe(1);
      expect(verdicts.size).toBe(0);
    }
  });

  it("內容審查擋下時對半拆開重問，單則仍被擋就保留並記住", async () => {
    const items = ["搶小草票A", "敏感標題", "搶小草票B", "搶小草票C"].map((title) => ({ title }));
    const chatFn = vi.fn(async (messages: Msg[]) => {
      const titles = titlesOf(messages);
      if (titles.includes("敏感標題")) throw new Error('LLM HTTP 422: {"message":"input new_sensitive (1026)"}');
      return JSON.stringify({ drop: titles.map((_, i) => i + 1) });
    });
    const verdicts = new Map();
    const { dropped, stats } = await reviewNewsRelevance(items, { verdicts, chatFn, now: NOW });
    expect([...dropped].map((it: { title: string }) => it.title).sort()).toEqual(["搶小草票A", "搶小草票B", "搶小草票C"]);
    expect(stats).toMatchObject({ reviewed: 4, moderated: 1, failedBatches: 0 });
    expect(verdicts.get("敏感標題")).toMatchObject({ keep: true });
  });

  it("預設直接打主端點，MiniMax 審查錯誤不被 fallback 的錯誤蓋掉", async () => {
    vi.stubEnv("LLM_API_KEY", "k");
    vi.stubEnv("LLM_BASE_URL", "https://api.minimax.io/v1");
    vi.stubEnv("LLM_MODEL", "MiniMax-M3");
    vi.stubEnv("LLM_MAX_RETRIES", "0");
    vi.stubEnv("LLM_FALLBACK_API_KEY", "f");
    vi.stubEnv("LLM_FALLBACK_BASE_URL", "https://integrate.api.nvidia.com/v1");
    vi.stubEnv("LLM_FALLBACK_MODEL", "nvidia/retired");
    const fetchMock = vi.fn(async (url: string) => (/minimax/.test(url)
      ? new Response('{"error":{"message":"input new_sensitive (1026)"}}', { status: 422 })
      : new Response("gone", { status: 410 })));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const verdicts = new Map();
      const { stats } = await reviewNewsRelevance([{ title: "某則被審查擋下的標題" }], { verdicts, now: NOW });
      expect(stats).toMatchObject({ moderated: 1, failedBatches: 0 });
      expect(fetchMock.mock.calls.every(([url]) => /minimax/.test(String(url)))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("速率限制（429）時等待後重試，成功就照常判斷", async () => {
    let calls = 0;
    const chatFn = vi.fn(async (messages: Msg[]) => {
      if (++calls === 1) throw new Error("LLM HTTP 429: Token Plan rate limit reached");
      return JSON.stringify({ drop: titlesOf(messages).map((_, i) => i + 1) });
    });
    const sleepFn = vi.fn(async () => {});
    const { dropped, stats } = await reviewNewsRelevance([{ title: "搶小草票" }], { verdicts: new Map(), chatFn, sleepFn, now: NOW });
    expect(sleepFn).toHaveBeenCalledWith(30000);
    expect(dropped.size).toBe(1);
    expect(stats).toMatchObject({ reviewed: 1, failedBatches: 0, rateLimitWaits: 1 });
  });

  it("速率限制持續就放棄該批，照規則保留", async () => {
    const chatFn = vi.fn(async () => { throw new Error("LLM HTTP 429: Token Plan rate limit reached"); });
    const sleepFn = vi.fn(async () => {});
    const { dropped, stats } = await reviewNewsRelevance([{ title: "搶小草票" }], { verdicts: new Map(), chatFn, sleepFn, now: NOW });
    expect(sleepFn.mock.calls.map(([ms]) => ms)).toEqual([30000, 60000]);
    expect(dropped.size).toBe(0);
    expect(stats.failedBatches).toBe(1);
  });

  it("時間預算用完的批次留到下一輪", async () => {
    const chatFn = chatDropping([]);
    const items = Array.from({ length: 5 }, (_, i) => ({ title: `演唱會搶票第${i}場` }));
    const { stats } = await reviewNewsRelevance(items, { verdicts: new Map(), chatFn, batchSize: 2, budgetMs: -1, now: NOW });
    expect(chatFn).not.toHaveBeenCalled();
    expect(stats.skippedBatches).toBe(3);
  });

  it("判斷檔過期項目會丟棄，序列化後可讀回", () => {
    const verdicts = new Map([
      ["new", { keep: false, at: "2026-11-18T00:00:00.000Z" }],
      ["old", { keep: false, at: "2026-10-01T00:00:00.000Z" }],
    ]);
    const restored = readVerdicts(JSON.parse(JSON.stringify(serializeVerdicts(verdicts))), NOW);
    expect([...restored.keys()]).toEqual(["new"]);
    expect(readVerdicts(null, NOW).size).toBe(0);
  });

  it("沿用的舊新聞也套用模型剔除結果", () => {
    const timestamp = "2026-11-18T00:00:00.000Z";
    const oldNews = ["黃金跌入熊市 專家：實體黃金不怕駭客攻擊", "男子持刀砍人遭起訴"].map((title, i) => ({
      id: `n${i}`, title, timestamp, source: { datasetId: "tw-news", recordRef: `https://example.com/${i}` },
    }));
    const base = { oldNews, twnews: [], twnewsStatus: { ok: false }, now: NOW };
    expect(buildTwNewsEvents(base).map((e: { id: string }) => e.id)).toEqual(["n0", "n1"]);
    const result = buildTwNewsEvents({ ...base, llmDropKeys: new Set(["黃金跌入熊市專家實體黃金不怕駭客攻擊"]) });
    expect(result.map((e: { id: string }) => e.id)).toEqual(["n1"]);
  });
});
