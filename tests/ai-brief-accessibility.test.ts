import { describe, expect, it } from "vitest";
import { getActionableDegradedReason, renderAiBrief, type AiSummary } from "../src/components/AiBrief";
import type { IntelEvent } from "../src/types/event";

function mockContainer(): HTMLElement {
  return { innerHTML: "" } as HTMLElement;
}

const sampleSummary: AiSummary = {
  domestic: "這是超過一百一十個字的國內情報情勢摘要，說明治安與交通問題。" + "重點細節。".repeat(25),
  international: "這是超過一百一十個字的國際情報情勢摘要，說明地緣政治與資安威脅。" + "國際細節。".repeat(25),
  recent24h: "近二十四小時重點動態，包含重大事故與交通即時查驗。" + "即時細節。".repeat(15),
  trend: "整體呈微幅下降，前四日維持近一千二，末日驟跌至九百六十七。" + "趨勢細節。".repeat(15),
  byCategory: {
    治安: "治安分類重點態勢摘要，警政全力打詐。" + "治安補充。".repeat(10),
    反詐: "反詐騙成效檢視，攔阻境外詐欺金流。",
    災防: "強降雨特報發布，低窪地區請注意積淹水。",
  },
  model: "test-model",
  generatedAt: "2026-09-16T12:00:00Z",
};

const sampleEvent: IntelEvent = {
  id: "ev-1",
  title: "詐騙逮捕行動",
  region: "臺北市",
  timestamp: "2026-09-16T10:00:00Z",
  category: "反詐",
  scope: "domestic",
  riskLevel: "high",
  summary: "逮捕多名詐欺車手",
  source: { name: "警政署", type: "gov-open-data", fetchedAt: "2026-09-16T10:05:00Z" },
};

describe("AiBrief — Issue #28 全域範圍標示與篩選區分", () => {
  it("國內 scope 標明國內全域與不隨篩選變動，國際 scope 標明國際全域", () => {
    const c1 = mockContainer();
    renderAiBrief(c1, sampleSummary, "domestic", [sampleEvent]);
    expect(c1.innerHTML).toContain("國內全域");
    expect(c1.innerHTML).toContain("不隨目前篩選條件變動");

    const c2 = mockContainer();
    renderAiBrief(c2, sampleSummary, "international", [sampleEvent]);
    expect(c2.innerHTML).toContain("國際全域");
    expect(c2.innerHTML).toContain("不隨目前篩選條件變動");
  });

  it("行動判斷依傳入之目前篩選事件標示範圍，無符合事件時明確提示", () => {
    const cWithEvents = mockContainer();
    renderAiBrief(cWithEvents, sampleSummary, "domestic", [sampleEvent]);
    expect(cWithEvents.innerHTML).toContain("目前篩選 (1 則)");
    expect(cWithEvents.innerHTML).toContain("行動判斷");

    const cEmpty = mockContainer();
    renderAiBrief(cEmpty, sampleSummary, "domestic", []);
    expect(cEmpty.innerHTML).toContain("目前篩選");
    expect(cEmpty.innerHTML).toContain("無符合事件");
  });

  it("明確區分生成時間標籤，不冒充資料涵蓋期間", () => {
    const c = mockContainer();
    renderAiBrief(c, sampleSummary, "domestic", []);
    expect(c.innerHTML).toContain("生成於");
    expect(c.innerHTML).toContain("test-model");
  });
});

describe("AiBrief — Issue #29 可操作全文展開與無障礙", () => {
  it("超過預覽長度時使用 details/summary 提供可操作展開全文，全文存在於 DOM", () => {
    const c = mockContainer();
    renderAiBrief(c, sampleSummary, "domestic", []);
    expect(c.innerHTML).toContain("ai-expandable");
    expect(c.innerHTML).toContain("<summary");
    expect(c.innerHTML).toContain("ai-full-text");
    expect(c.innerHTML).toContain("展開全文 ▾");
    // 全文內容存在於 DOM
    expect(c.innerHTML).toContain(sampleSummary.domestic);
  });

  it("未超過長度之短文不增加冗餘展開按鈕", () => {
    const shortSummary: AiSummary = {
      domestic: "短摘要",
      international: "短國際摘要",
      generatedAt: "2026-09-16T12:00:00Z",
    };
    const c = mockContainer();
    renderAiBrief(c, shortSummary, "domestic", []);
    expect(c.innerHTML).not.toContain("展開全文 ▾");
    expect(c.innerHTML).toContain("短摘要");
  });

  it("近 24 小時與趨勢若超過預覽長度亦提供展開路徑", () => {
    const c = mockContainer();
    renderAiBrief(c, sampleSummary, "domestic", []);
    expect(c.innerHTML).toContain(sampleSummary.recent24h);
    expect(c.innerHTML).toContain(sampleSummary.trend);
  });

  it("其餘分類摘要提供查看入口，不被直接切除", () => {
    const c = mockContainer();
    renderAiBrief(c, sampleSummary, "domestic", []);
    expect(c.innerHTML).toContain("ai-cats-more");
    expect(c.innerHTML).toContain("查看其餘 2 個分類摘要 ▾");
    expect(c.innerHTML).toContain("反詐");
    expect(c.innerHTML).toContain("災防");
  });
});

describe("AiBrief — Issue #18 語意降級與統計備援無障礙渲染", () => {
  it("使用系統統計備援時，顯示非純顏色之提示框、備援標章與明確提示文字", () => {
    const fallbackText = "國內事件共 12 起，以 治安 8 起 為主。（AI 摘要暫時無法生成，事件資料仍可查閱；此為系統統計備援）";
    const degradedSummary: AiSummary = {
      domestic: fallbackText,
      international: "正常國際摘要",
      degraded: { domestic: true, international: false },
      model: "test-model",
      generatedAt: "2026-09-16T12:00:00Z",
    };

    const c = mockContainer();
    renderAiBrief(c, degradedSummary, "domestic", [sampleEvent]);

    expect(c.innerHTML).toContain("ai-brief-fallback-notice");
    expect(c.innerHTML).toContain('role="status"');
    expect(c.innerHTML).toContain("ai-fallback-badge");
    expect(c.innerHTML).toContain("系統統計備援");
    expect(c.innerHTML).toContain("AI 摘要暫時無法生成，事件資料仍可查閱");
    // meta 標示統計備援，不冒充 AI 模型
    expect(c.innerHTML).toContain("系統統計備援");
    expect(c.innerHTML).not.toContain("由 test-model 生成");
    // 無記錄原因時僅顯示「原因未記錄」，杜絕虛構的金鑰或配額推測文案
    expect(c.innerHTML).toContain("原因：原因未記錄");
    expect(c.innerHTML).not.toContain("金鑰");
    expect(c.innerHTML).not.toContain("配額");
    expect(c.innerHTML).not.toContain("AI 服務連線或 API 金鑰驗證異常");
    // 保留全文內容與可展開特性
    expect(c.innerHTML).toContain(fallbackText);
  });

  it("降級且無真實摘要時：提示框呈現精確原因與上次成功生成時間", () => {
    const fallbackText = "國內事件共 10 起，以 治安 6 起 為主。（AI 摘要暫時無法生成，事件資料仍可查閱；此為系統統計備援）";
    const degradedSummary: AiSummary = {
      domestic: fallbackText,
      international: "正常國際摘要",
      degraded: { domestic: true, international: false },
      degradedReason: { domestic: "LLM API 金鑰認證失敗（HTTP 401，請檢查金鑰有效性或權限）" },
      lastSuccessAt: "2026-09-15T08:30:00Z",
      model: "test-model",
      generatedAt: "2026-09-16T12:00:00Z",
    };

    const c = mockContainer();
    renderAiBrief(c, degradedSummary, "domestic", [sampleEvent]);

    expect(c.innerHTML).toContain("ai-brief-fallback-notice");
    expect(c.innerHTML).toContain("LLM API 金鑰認證失敗（HTTP 401，請檢查金鑰有效性或權限）");
    expect(c.innerHTML).toContain("上次成功生成：");
    expect(c.innerHTML).toContain(fallbackText);
  });

  it("降級但存在前期真實摘要時：優先呈現前期真實摘要並標註生成時間，同時保留即時統計備援", () => {
    const fallbackText = "國內事件共 10 起，以 治安 6 起 為主。（AI 摘要暫時無法生成，事件資料仍可查閱；此為系統統計備援）";
    const staleRealText = "昨日國內重點情勢：警政署於臺北查獲重大詐欺機房，整體治安維護良好。";
    const staleSummary: AiSummary = {
      domestic: fallbackText,
      international: "正常國際摘要",
      degraded: { domestic: true, international: false },
      model: "test-model",
      generatedAt: "2026-09-16T12:00:00Z",
      lastSuccessful: {
        domestic: staleRealText,
        international: "前期國際摘要",
        model: "approved-llm-model",
        generatedAt: "2026-09-15T18:00:00Z",
      },
    };

    const c = mockContainer();
    renderAiBrief(c, staleSummary, "domestic", [sampleEvent]);

    // 優先顯示真實摘要
    expect(c.innerHTML).toContain(staleRealText);
    // 標示前期摘要與生成時間
    expect(c.innerHTML).toContain("ai-brief-stale-notice");
    expect(c.innerHTML).toContain("前期摘要");
    expect(c.innerHTML).toContain("approved-llm-model");
    expect(c.innerHTML).toContain("前期摘要生成於");
    // 同時保留最新事件統計備援供查閱與合約驗收
    expect(c.innerHTML).toContain("ai-brief-stat-backup");
    expect(c.innerHTML).toContain(fallbackText);
  });

  it("有事件資料但摘要為佔位字串時，明確警示生成失敗", () => {
    const failedSummary: AiSummary = {
      domestic: "（暫無資料）",
      international: "（暫無資料）",
      generatedAt: "2026-09-16T12:00:00Z",
    };

    const c = mockContainer();
    renderAiBrief(c, failedSummary, "domestic", [sampleEvent]);

    expect(c.innerHTML).toContain("ai-brief-degraded");
    expect(c.innerHTML).toContain('role="alert"');
    expect(c.innerHTML).toContain("AI 摘要生成失敗，請直接檢視下方事件列表");
  });

  it("真正無事件資料時，佔位字串以正常空狀態顯示", () => {
    const emptySummary: AiSummary = {
      domestic: "（暫無資料）",
      international: "（暫無資料）",
      generatedAt: "2026-09-16T12:00:00Z",
    };

    const c = mockContainer();
    renderAiBrief(c, emptySummary, "domestic", []);

    expect(c.innerHTML).toContain("ai-brief-empty");
    expect(c.innerHTML).toContain("暫無事件資料");
    expect(c.innerHTML).not.toContain("生成失敗");
  });
});

describe("AiBrief — 降級原因判定與 pipeline 欄位呈現 (Worker A Round 3)", () => {
  it("當無任何 pipeline 錯誤資訊時，精確顯示「原因未記錄」，且不含金鑰或配額推測文案", () => {
    const degradedSummary: AiSummary = {
      domestic: "國內事件共 5 起。（AI 摘要暫時無法生成；此為系統統計備援）",
      international: "國際事件共 2 起。（AI 摘要暫時無法生成；此為系統統計備援）",
      degraded: true,
      model: "mistral-nemo",
      generatedAt: "2026-09-16T12:00:00Z",
    };

    expect(getActionableDegradedReason(degradedSummary, "domestic")).toBe("原因未記錄");
    expect(getActionableDegradedReason(degradedSummary, "international")).toBe("原因未記錄");

    const c = mockContainer();
    renderAiBrief(c, degradedSummary, "domestic", [sampleEvent]);
    expect(c.innerHTML).toContain("原因：原因未記錄");
    expect(c.innerHTML).not.toContain("金鑰");
    expect(c.innerHTML).not.toContain("配額");
    expect(c.innerHTML).not.toContain("AI 服務連線或 API 金鑰驗證異常");
  });

  it("依序採用 pipeline 寫入之原因：degradedReason 字串優先", () => {
    const summary: AiSummary = {
      domestic: "國內事件...（系統統計備援）",
      international: "國際事件...（系統統計備援）",
      degraded: true,
      degradedReason: "NVIDIA API HTTP 503 服務維護中",
      reason: "次要原因",
      error: "錯誤原因",
      generatedAt: "2026-09-16T12:00:00Z",
    };

    expect(getActionableDegradedReason(summary, "domestic")).toBe("NVIDIA API HTTP 503 服務維護中");
    expect(getActionableDegradedReason(summary, "international")).toBe("NVIDIA API HTTP 503 服務維護中");
  });

  it("依序採用 pipeline 寫入之原因：degradedReason 依 scope 取用對應原因", () => {
    const summary: AiSummary = {
      domestic: "國內事件...（系統統計備援）",
      international: "國際事件...（系統統計備援）",
      degraded: { domestic: true, international: true },
      degradedReason: {
        domestic: "國內 LLM 逾時 (timeout 30s)",
        international: "國際來源模型配額耗盡 (429)",
      },
      reason: "全域備援原因",
      error: "全域錯誤",
      generatedAt: "2026-09-16T12:00:00Z",
    };

    expect(getActionableDegradedReason(summary, "domestic")).toBe("國內 LLM 逾時 (timeout 30s)");
    expect(getActionableDegradedReason(summary, "international")).toBe("國際來源模型配額耗盡 (429)");
  });

  it("degradedReason scope 缺漏時，依序退回 reason 與 error 欄位", () => {
    const summaryWithReason: AiSummary = {
      domestic: "國內...（系統統計備援）",
      international: "國際...（系統統計備援）",
      degraded: true,
      degradedReason: {
        domestic: "僅國內原因",
      },
      reason: "退回之 reason 欄位描述",
      error: "退回之 error 欄位描述",
      generatedAt: "2026-09-16T12:00:00Z",
    };

    // domestic 有 scope reason，使用 domestic reason
    expect(getActionableDegradedReason(summaryWithReason, "domestic")).toBe("僅國內原因");
    // international 缺漏 scope reason，退回 summary.reason
    expect(getActionableDegradedReason(summaryWithReason, "international")).toBe("退回之 reason 欄位描述");

    const summaryWithErrorOnly: AiSummary = {
      domestic: "國內...（系統統計備援）",
      international: "國際...（系統統計備援）",
      degraded: true,
      error: "退回之 error 欄位描述",
      generatedAt: "2026-09-16T12:00:00Z",
    };

    expect(getActionableDegradedReason(summaryWithErrorOnly, "domestic")).toBe("退回之 error 欄位描述");
    expect(getActionableDegradedReason(summaryWithErrorOnly, "international")).toBe("退回之 error 欄位描述");
  });

  it("degradedReason、reason 與 error 皆無效（如空字串或純空白）時，回傳「原因未記錄」", () => {
    const blankSummary: AiSummary = {
      domestic: "國內...（系統統計備援）",
      international: "國際...（系統統計備援）",
      degraded: true,
      degradedReason: "   ",
      reason: "",
      error: "  ",
      generatedAt: "2026-09-16T12:00:00Z",
    };

    expect(getActionableDegradedReason(blankSummary, "domestic")).toBe("原因未記錄");
    expect(getActionableDegradedReason(blankSummary, "international")).toBe("原因未記錄");
  });

  it("pipeline 原因中若含有 HTML 特殊字元，UI 渲染時照字面 (verbatim) 呈現並完整 HTML-escaped", () => {
    const rawReason = "LLM gateway error <502 Bad Gateway> & 'upstream' timeout (check \"proxy\")";
    const summary: AiSummary = {
      domestic: "國內事件...（系統統計備援）",
      international: "國際事件...（系統統計備援）",
      degraded: true,
      degradedReason: rawReason,
      lastSuccessAt: "2026-09-15T08:30:00Z",
      generatedAt: "2026-09-16T12:00:00Z",
    };

    // getActionableDegradedReason 取得原始未竄改之字串
    expect(getActionableDegradedReason(summary, "domestic")).toBe(rawReason);

    // renderAiBrief 渲染到 DOM 時經過 esc() 轉義
    const c = mockContainer();
    renderAiBrief(c, summary, "domestic", [sampleEvent]);

    expect(c.innerHTML).toContain("原因：LLM gateway error &lt;502 Bad Gateway&gt; &amp; &#39;upstream&#39; timeout (check &quot;proxy&quot;)");
    // 確保沒有直接注入未轉義之 HTML 標籤
    expect(c.innerHTML).not.toContain("<502 Bad Gateway>");
    // 保留上次成功時間顯示
    expect(c.innerHTML).toContain("上次成功生成：");
  });

  it("保留前期良好真實摘要 (last-good summary) 與上次成功時間不受影響", () => {
    const staleRealText = "前期國內重點真實情報。";
    const summary: AiSummary = {
      domestic: "國內事件...（系統統計備援）",
      international: "正常國際摘要",
      degraded: { domestic: true, international: false },
      lastSuccessful: {
        domestic: staleRealText,
        international: "前期國際",
        model: "approved-model",
        generatedAt: "2026-09-15T18:00:00Z",
      },
      lastSuccessAt: "2026-09-15T18:00:00Z",
      generatedAt: "2026-09-16T12:00:00Z",
    };

    const c = mockContainer();
    renderAiBrief(c, summary, "domestic", [sampleEvent]);

    // 優先呈現前期真實摘要
    expect(c.innerHTML).toContain(staleRealText);
    expect(c.innerHTML).toContain("前期摘要");
    expect(c.innerHTML).toContain("approved-model");
    // 保留即時統計備援
    expect(c.innerHTML).toContain("ai-brief-stat-backup");
  });
});

