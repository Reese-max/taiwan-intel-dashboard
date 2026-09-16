import { describe, expect, it, vi } from "vitest";
import {
  evaluateDomesticNormalization,
  evaluateInternationalNormalization,
  sanitizeErrorMessage,
} from "../src/utils/normalizationHealth";
import { renderSourcePanel } from "../src/components/SourcePanel";

describe("Issue #30 — 新聞 AI 正規化分層健康評估", () => {
  it("固定快照情境（國內精修 0、輕量 2687、normalizeFailed=true）判定為精修降級，不標為全數完成", () => {
    const twnewsSnapshot = {
      ok: true,
      normalizeFailed: true,
      count: 2687,
      enriched: 0,
      bulk: 2687,
      policeRelevant: 2687,
      rawUnique: 3500,
      sourceContributionTotals: { raw: 4200 },
    };
    const health = evaluateDomesticNormalization(twnewsSnapshot);
    expect(health.isDegraded).toBe(true);
    expect(health.state).toBe("failed-bulk-fallback");
    expect(health.stateLabel).toContain("AI 精修降級");
    expect(health.counts.enriched).toBe(0);
    expect(health.counts.bulk).toBe(2687);
    expect(health.counts.delivered).toBe(2687);
    expect(health.diagnostics?.fallbackReason).toContain("LLM 精修失敗或未連線");
  });

  it("國際快照情境（精修 87、輕量 3905、GDELT 429）判定為部分精修，獨立顯示 GDELT 限流", () => {
    const intlSnapshot = {
      ok: true,
      normalizeFailed: true,
      count: 3992,
      enriched: 87,
      bulk: 3905,
      rawCount: 4500,
      okFeeds: 412,
      totalFeeds: 465,
    };
    const gdeltSnapshot = {
      ok: false,
      error: "GDELT HTTP 429 Too Many Requests",
    };
    const health = evaluateInternationalNormalization(intlSnapshot, gdeltSnapshot);
    expect(health.isDegraded).toBe(true);
    expect(health.state).toBe("partial-degraded");
    expect(health.stateLabel).toContain("部分精修");
    expect(health.counts.enriched).toBe(87);
    expect(health.counts.bulk).toBe(3905);
    expect(health.diagnostics?.fallbackReason).toContain("GDELT 補充源暫時不可用");
    expect(health.diagnostics?.fallbackReason).toContain("RSS 主力來源正常運作");
  });

  it("全數 AI 精修完成情境（enriched > 0, bulk === 0, normalizeFailed=false）", () => {
    const healthyTwnews = {
      ok: true,
      normalizeFailed: false,
      count: 500,
      enriched: 500,
      bulk: 0,
    };
    const health = evaluateDomesticNormalization(healthyTwnews);
    expect(health.isDegraded).toBe(false);
    expect(health.state).toBe("fully-enriched");
    expect(health.stateLabel).toBe("全數 AI 精修完成");
  });

  it("略過精修（skipped=true）與無進線（raw=0, delivered=0）情境可清晰區分", () => {
    const skipped = evaluateDomesticNormalization({ skipped: true });
    expect(skipped.state).toBe("skipped-deliberate");
    expect(skipped.isDegraded).toBe(false);

    const empty = evaluateDomesticNormalization({ ok: true, count: 0, rawUnique: 0 });
    expect(empty.state).toBe("no-input");
  });

  it("抓取失敗（ok=false）標明 fetch 失敗與沿用快照", () => {
    const failed = evaluateDomesticNormalization({ ok: false, error: "Network timeout" });
    expect(failed.fetchOk).toBe(false);
    expect(failed.state).toBe("snapshot-carried");
    expect(failed.diagnostics?.errorType).toBe("FetchError");
  });

  it("診斷訊息過濾敏感 token 與金鑰", () => {
    const rawError = "Request failed with Authorization: Bearer sk-ant-api03-secretkey123456 and api_key=mysecretkey!";
    const sanitized = sanitizeErrorMessage(rawError);
    expect(sanitized).not.toContain("sk-ant-api03");
    expect(sanitized).not.toContain("secretkey123456");
    expect(sanitized).toContain("Bearer ***");
  });
});

describe("Issue #30 — SourcePanel 渲染分層健康與分離計數", () => {
  it("SourcePanel 呈現新聞 AI 正規化分層健康卡片，且國際數據不把總交付統稱為正規化", async () => {
    const manifest = {
      generatedAt: "2026-09-16T09:49:53.350Z",
      pipeline: {
        twnews: {
          ok: true,
          normalizeFailed: true,
          count: 2687,
          enriched: 0,
          bulk: 2687,
          policeRelevant: 2687,
          rawUnique: 3500,
          sourceContributionTotals: { raw: 4200 },
        },
        international: {
          ok: true,
          normalizeFailed: true,
          count: 3992,
          enriched: 87,
          bulk: 3905,
          rawCount: 4500,
          okFeeds: 412,
          totalFeeds: 465,
          feeds: [
            { label: "Reuters", ok: true, count: 10, normalizedCount: 0 },
          ],
        },
        gdelt: {
          ok: false,
          error: "GDELT HTTP 429",
        },
      },
      sources: [
        {
          name: "中央通訊社",
          type: "news-rss",
          scope: "domestic",
          count: 50,
          fetchedAt: "2026-09-16T09:00:00Z",
          lastSuccessAt: "2026-09-16T09:00:00Z",
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(manifest), { status: 200 })),
    );

    const container = { innerHTML: "" } as HTMLElement;

    try {
      await renderSourcePanel(container);

      // 分層健康區塊
      expect(container.innerHTML).toContain("新聞處理與 AI 正規化分層健康");
      expect(container.innerHTML).toContain("AI 精修降級（全量輕量收錄）");
      expect(container.innerHTML).toContain("部分精修（部分輕量降級）");
      expect(container.innerHTML).toContain("<b>AI 精修</b> 0 筆");
      expect(container.innerHTML).toContain("<b>輕量收錄</b> 2687 筆");
      expect(container.innerHTML).toContain("<b>AI 精修</b> 87 筆");
      expect(container.innerHTML).toContain("<b>輕量收錄</b> 3905 筆");

      // 修正後的國際交付計數，不冒充「正規化 3992」
      expect(container.innerHTML).toContain("交付 3992（精修 87／輕量 3905）");
      expect(container.innerHTML).not.toContain("正規化 3992");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
