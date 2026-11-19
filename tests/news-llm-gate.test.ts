import { describe, expect, it, vi } from "vitest";

// @ts-expect-error — JS ESM module without types
import { readVerdicts, reviewNewsRelevance, serializeVerdicts } from "../scripts/lib/news-llm-gate.mjs";
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
