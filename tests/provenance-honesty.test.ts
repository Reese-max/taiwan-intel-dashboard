import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error — JS ESM module without types
import { snapshotEventsForSource, buildNewsProcessingNote, newsNormalizationDescription, carriedInternationalSourceFlags } from "../scripts/lib/provenance.mjs";
// @ts-expect-error — JS ESM module without types
import { auditSourceHealth } from "../scripts/lib/source-health.mjs";
// @ts-expect-error — JS ESM module without types
import { validateEventContract } from "../scripts/lib/event-contract.mjs";
// @ts-expect-error — JS ESM module without types
import { accumulateInternational } from "../scripts/lib/intl-accumulate.mjs";
import { renderSourcePanel } from "../src/components/SourcePanel";

const now = Date.parse("2026-11-06T09:12:30.476Z");
const source = { name: "台灣新聞：測試來源", type: "news-rss", datasetId: "tw-news", scope: "domestic", category: "治安" };
const event = (id: string, extra = {}) => ({
  id, title: "警方偵破詐騙案件", summary: "警方逮捕嫌犯", region: "臺北市",
  scope: "domestic", category: "治安", riskLevel: "low", timestamp: new Date(now).toISOString(),
  source: { name: "測試來源", feedLabel: "測試來源", datasetId: "tw-news", fetchedAt: new Date(now).toISOString(), normalizationMethod: "bulk" },
  ...extra,
});

afterEach(() => vi.unstubAllGlobals());

describe("provenance 計數與處理宣告", () => {
  it("重現契約剔除 25 筆後，舊陣列超算；來源改計最終快照", () => {
    const candidates = [event("valid"), ...Array.from({ length: 25 }, (_, n) => event(`invalid-${n}`, { summary: "" }))];
    const { valid, invalid } = validateEventContract(candidates);
    expect(invalid).toHaveLength(25);
    expect(candidates.length - valid.length).toBe(25);
    expect(snapshotEventsForSource(source, valid).length).toBe(valid.length);
    expect(snapshotEventsForSource(source, valid)).toHaveLength(1);
  });

  it("國際本輪候選與快照因去重、保留窗、上限而不同，MOFA 狀態不佔新聞上限", () => {
    const intl = (id: string, extra = {}) => event(id, { scope: "international", source: { ...event(id).source, datasetId: "international-news" }, ...extra });
    const fresh = [intl("a"), intl("a"), intl("b"), intl("c"), intl("expired", { timestamp: "2026-10-01T00:00:00Z" })];
    const mofa = intl("state", { source: { ...event("state").source, datasetId: "mofa-travel-warning", retentionPolicy: "stateful" } });
    const snapshot = accumulateInternational([...fresh, mofa], [], { cap: 2, retentionDays: 5, now });
    const row = { ...source, name: "國際新聞：測試來源", scope: "international", datasetId: "international-news" };
    expect(fresh).toHaveLength(5);
    expect(snapshot).toHaveLength(3);
    expect(snapshotEventsForSource(row, snapshot)).toHaveLength(2);
  });

  it("全失敗且仍有官方備援／舊精修時，不宣稱本輪曾 LLM 精修", () => {
    const events = [event("bulk"), event("official", { source: { normalizationMethod: "official-police-fallback" } }), event("cached", { source: { model: "old-model", normalizationMethod: "llm" } })];
    const note = buildNewsProcessingNote(events, new Set(), "nvidia/nemotron-3-super-120b-a12b");
    expect(note).toContain("本輪無 LLM 新聞精修結果落地");
    expect(note).toContain("設定模型：nvidia/nemotron-3-super-120b-a12b");
    expect(note).not.toContain("agnes-3.0-flash");
    expect(note).not.toMatch(/LLM 精修 \d+ 筆/);
    expect(newsNormalizationDescription(events.slice(0, 2))).toBe("官方原文規則備援＋輕量收錄");
  });

  it("成功只計本輪落地輸出，排除快取、備援與被剔除的輸出，列出實際模型", () => {
    const fresh = event("new", { source: { model: "response-model", normalizationMethod: "llm" } });
    const removed = event("removed", { source: { model: "removed-model", normalizationMethod: "llm" } });
    const cache = event("cached", { source: { model: "old-model", normalizationMethod: "llm" } });
    const note = buildNewsProcessingNote([fresh, cache, event("bulk")], new Set([fresh.source, removed.source]), "configured-model");
    expect(note).toContain("LLM 精修 1 筆（模型：response-model）");
    expect(note).not.toContain("removed-model");
    expect(note).not.toContain("old-model");
    expect(note).not.toContain("configured-model");
    expect(buildNewsProcessingNote([fresh], new Set([fresh.source]))).not.toContain("agnes");
    const unspecified = event("no-model", { source: { normalizationMethod: "llm" } });
    expect(buildNewsProcessingNote([unspecified], new Set([unspecified.source]), "configured-model")).toContain("模型：configured-model");
  });

  it("前端明確區分映射候選量與快照量，不把備援當作本輪精修", async () => {
    const pipeline = { ok: true, count: 4325, snapshotCount: 3000, enriched: 92, bulk: 4233, refinedSnapshotCount: 0, normalizeFailed: true, feeds: [{ label: "測試來源", ok: true, count: 10 }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ generatedAt: new Date(now).toISOString(), sources: [], pipeline: { international: pipeline } }))));
    const container = { innerHTML: "" } as HTMLElement;
    await renderSourcePanel(container);
    expect(container.innerHTML).toContain("本輪映射候選 4325");
    expect(container.innerHTML).toContain("快照新聞 3000");
    expect(container.innerHTML).toContain("<b>本輪 LLM 精修落地</b> 0 筆");
    expect(container.innerHTML).toContain("本輪無 LLM 精修落地");
    expect(container.innerHTML).not.toContain("交付 4325");
    expect(container.innerHTML).not.toContain("<b>AI 精修</b> 92 筆");
  });
});

describe("國際累積池沿用來源的健康標記", () => {
  const carried = (status: unknown) => ({ name: "國際新聞：Example", type: "news-rss", datasetId: "international-news", scope: "international", count: 3, stale: true, ...carriedInternationalSourceFlags(status) });
  const findings = (status: unknown) => auditSourceHealth({ provenance: { sources: [carried(status)] }, requiredSources: ["國際新聞：Example"] });
  const requestFailures = (status: unknown) => { const r = findings(status); return [...r.failures, ...r.warnings].filter((f: { code: string }) => f.code === "request-failed"); };

  it("本輪抓取成功或未排國際：只是沒輪到，不報請求失敗", () => {
    expect(carriedInternationalSourceFlags({ ok: true })).toEqual({ skippedThisRun: true });
    expect(carriedInternationalSourceFlags({ skipped: true })).toEqual({ skippedThisRun: true });
    expect(requestFailures({ ok: true })).toEqual([]);
  });

  it("整輪失敗：保留失敗原因，必要來源照常判 fail（codex bot P2）", () => {
    expect(carriedInternationalSourceFlags({ ok: false, error: "全部國際 RSS 失敗" })).toEqual({ error: "全部國際 RSS 失敗" });
    expect(carriedInternationalSourceFlags(undefined)).toHaveProperty("error");
    expect(requestFailures({ ok: false, error: "全部國際 RSS 失敗" })).toEqual([expect.objectContaining({ severity: "fail" })]);
  });
});
