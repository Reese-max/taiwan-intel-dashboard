export type NormalizationState =
  | "fully-enriched"      // 全數 AI 精修
  | "partial-degraded"     // 部分精修（部分輕量降級）
  | "failed-bulk-fallback" // 精修降級（全量輕量收錄）
  | "skipped-deliberate"   // 略過精修（刻意輕量模式）
  | "no-input"            // 無輸入資料
  | "snapshot-carried";    // 沿用快照

export interface ScopeNormalizationHealth {
  scope: "domestic" | "international";
  scopeLabel: string;
  fetchOk: boolean;
  state: NormalizationState;
  stateLabel: string;
  isDegraded: boolean;
  counts: {
    raw?: number;
    rawUnique?: number;
    delivered: number;
    enriched: number;
    bulk: number;
  };
  diagnostics?: {
    errorType?: string;
    safeErrorMessage?: string;
    skippedBatches?: number;
    fallbackReason?: string;
  };
}

export function sanitizeErrorMessage(msg?: string): string | undefined {
  if (!msg) return undefined;
  // 移除潛在敏感憑證、Authorization 或金鑰，保留安全錯誤描述
  return msg
    .replace(/(bearer\s+)[a-zA-Z0-9_\-\.]+/gi, "$1***")
    .replace(/(api[_-]?key[:=]\s*)[a-zA-Z0-9_\-\.]+/gi, "$1***")
    .replace(/sk-[a-zA-Z0-9_\-\.]+/gi, "sk-***")
    .slice(0, 150);
}

export function evaluateDomesticNormalization(pipelineTwnews: any): ScopeNormalizationHealth {
  const p = pipelineTwnews || {};
  const enriched = Number(p.enriched ?? 0);
  const bulk = Number(p.bulk ?? 0);
  const delivered = Number(p.count ?? (enriched + bulk));
  const rawUnique = typeof p.rawUnique === "number" ? p.rawUnique : undefined;
  const raw = typeof p.sourceContributionTotals?.raw === "number" ? p.sourceContributionTotals.raw : undefined;
  const normalizeFailed = Boolean(p.normalizeFailed);
  const skippedBatches = Number(p.normalizeSkippedBatches ?? 0);

  if (p.skipped) {
    return {
      scope: "domestic",
      scopeLabel: "台灣新聞（國內）",
      fetchOk: true,
      state: "skipped-deliberate",
      stateLabel: "略過精修（本輪未執行）",
      isDegraded: false,
      counts: { raw, rawUnique, delivered: 0, enriched: 0, bulk: 0 },
    };
  }

  if (p.ok === false) {
    return {
      scope: "domestic",
      scopeLabel: "台灣新聞（國內）",
      fetchOk: false,
      state: "snapshot-carried",
      stateLabel: "抓取失敗（沿用舊快照）",
      isDegraded: true,
      counts: { raw, rawUnique, delivered, enriched, bulk },
      diagnostics: {
        errorType: "FetchError",
        safeErrorMessage: sanitizeErrorMessage(p.error) || "抓取失敗",
        fallbackReason: "來源抓取失敗，沿用快照",
      },
    };
  }

  // ok: true 狀況
  let state: NormalizationState;
  let stateLabel: string;
  let isDegraded = false;
  let fallbackReason: string | undefined;

  if (delivered === 0 && (rawUnique === 0 || raw === 0)) {
    state = "no-input";
    stateLabel = "無新聞進線";
  } else if (normalizeFailed && enriched === 0 && bulk > 0) {
    state = "failed-bulk-fallback";
    stateLabel = "AI 精修降級（全量輕量收錄）";
    isDegraded = true;
    fallbackReason = "LLM 精修失敗或未連線，自動由關鍵字與分類規則輕量收錄";
  } else if ((normalizeFailed || skippedBatches > 0 || bulk > 0) && enriched > 0) {
    state = "partial-degraded";
    stateLabel = "部分精修（部分輕量降級）";
    isDegraded = true;
    fallbackReason = `部分批次失敗或跳過（${skippedBatches} 批），部分由輕量收錄補足`;
  } else if (enriched > 0 && bulk === 0 && !normalizeFailed) {
    state = "fully-enriched";
    stateLabel = "全數 AI 精修完成";
    isDegraded = false;
  } else if (bulk > 0 && enriched === 0) {
    state = "failed-bulk-fallback";
    stateLabel = "輕量收錄模式（未執行 AI 精修）";
    isDegraded = true;
    fallbackReason = "未產出精修結果，全數以輕量規則收錄";
  } else {
    state = "no-input";
    stateLabel = "無資料";
  }

  return {
    scope: "domestic",
    scopeLabel: "台灣新聞（國內）",
    fetchOk: true,
    state,
    stateLabel,
    isDegraded,
    counts: { raw, rawUnique, delivered, enriched, bulk },
    diagnostics: isDegraded ? {
      skippedBatches: skippedBatches > 0 ? skippedBatches : undefined,
      fallbackReason,
    } : undefined,
  };
}

export function evaluateInternationalNormalization(
  pipelineIntl: any,
  pipelineGdelt?: any,
): ScopeNormalizationHealth {
  const p = pipelineIntl || {};
  const enriched = Number(p.enriched ?? 0);
  const bulk = Number(p.bulk ?? 0);
  const delivered = Number(p.count ?? (enriched + bulk));
  const raw = typeof p.rawCount === "number" ? p.rawCount : undefined;
  const normalizeFailed = Boolean(p.normalizeFailed);
  const skippedBatches = Number(p.normalizeSkippedBatches ?? 0);
  const normalizeError = sanitizeErrorMessage(p.normalizeError);

  if (p.skipped) {
    return {
      scope: "international",
      scopeLabel: "國際情勢（國際）",
      fetchOk: true,
      state: "skipped-deliberate",
      stateLabel: "略過精修（本輪未執行）",
      isDegraded: false,
      counts: { raw, delivered: 0, enriched: 0, bulk: 0 },
    };
  }

  if (p.ok === false) {
    return {
      scope: "international",
      scopeLabel: "國際情勢（國際）",
      fetchOk: false,
      state: "snapshot-carried",
      stateLabel: "抓取失敗（沿用舊快照）",
      isDegraded: true,
      counts: { raw, delivered, enriched, bulk },
      diagnostics: {
        errorType: "FetchError",
        safeErrorMessage: sanitizeErrorMessage(p.error) || "抓取失敗",
        fallbackReason: "來源抓取失敗，沿用快照",
      },
    };
  }

  let state: NormalizationState;
  let stateLabel: string;
  let isDegraded = false;
  let fallbackReason: string | undefined;

  if (delivered === 0 && raw === 0) {
    state = "no-input";
    stateLabel = "無國際新聞進線";
  } else if (normalizeFailed && enriched === 0 && bulk > 0) {
    state = "failed-bulk-fallback";
    stateLabel = "AI 精修降級（全量輕量收錄）";
    isDegraded = true;
    fallbackReason = normalizeError || "LLM 故障或限流，改由 RSS 規則輕量映射";
  } else if ((normalizeFailed || skippedBatches > 0 || bulk > 0) && enriched > 0) {
    state = "partial-degraded";
    stateLabel = "部分精修（部分輕量降級）";
    isDegraded = true;
    fallbackReason = normalizeError
      ? `部分精修成功，其餘降級：${normalizeError}`
      : `部分批次跳過（${skippedBatches} 批），由輕量規則補足`;
  } else if (enriched > 0 && bulk === 0 && !normalizeFailed) {
    state = "fully-enriched";
    stateLabel = "全數 AI 精修完成";
    isDegraded = false;
  } else if (bulk > 0 && enriched === 0) {
    state = "failed-bulk-fallback";
    stateLabel = "輕量收錄模式（未執行 AI 精修）";
    isDegraded = true;
    fallbackReason = "全數以輕量規則收錄";
  } else {
    state = "no-input";
    stateLabel = "無資料";
  }

  // 補充 GDELT 限流診斷，不阻擋 RSS 主力
  let gdeltNote: string | undefined;
  if (pipelineGdelt && pipelineGdelt.ok === false) {
    gdeltNote = `GDELT 補充源暫時不可用（${sanitizeErrorMessage(pipelineGdelt.error) || "限流 429"}），RSS 主力來源正常運作`;
  }

  return {
    scope: "international",
    scopeLabel: "國際情勢（國際）",
    fetchOk: true,
    state,
    stateLabel,
    isDegraded,
    counts: { raw, delivered, enriched, bulk },
    diagnostics: {
      errorType: normalizeError ? "NormalizeError" : undefined,
      safeErrorMessage: normalizeError,
      skippedBatches: skippedBatches > 0 ? skippedBatches : undefined,
      fallbackReason: gdeltNote ? `${fallbackReason || ""}${fallbackReason ? "；" : ""}${gdeltNote}` : fallbackReason,
    },
  };
}
