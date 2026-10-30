import { esc } from "../utils/escape";
import type { IntelEvent, Scope } from "../types/event";
import { RISK_ORDER } from "../types/event";
import { getActionDecision } from "../utils/actionDecision";

export interface LastSuccessfulSummary {
  domestic?: string;
  international?: string;
  recent24h?: string;
  byCategory?: Record<string, string>;
  trend?: string;
  clusterSummaries?: Record<string, string>;
  model?: string;
  generatedAt: string;
}

export interface AiSummary {
  domestic: string;
  international: string;
  recent24h?: string;
  byCategory?: Record<string, string>;
  trend?: string;
  dailyCounts?: number[];
  clusterSummaries?: Record<string, string>;
  degraded?: boolean | { domestic?: boolean; international?: boolean };
  degradedReason?: string | { domestic?: string; international?: string };
  reason?: string;
  error?: string;
  lastSuccessAt?: string | { domestic?: string; international?: string };
  lastSuccessful?: LastSuccessfulSummary;
  model?: string;
  generatedAt: string;
}

export function isScopeDegraded(summary: AiSummary | null, scope: Scope): boolean {
  if (!summary || !summary.degraded) return false;
  if (typeof summary.degraded === "boolean") return summary.degraded;
  return Boolean(summary.degraded[scope]);
}

export function isBriefPlaceholder(text: string): boolean {
  const trimmed = (text || "").trim();
  return !trimmed || trimmed === "（暫無資料）";
}

export function isDeterministicFallback(text: string): boolean {
  if (!text) return false;
  return text.includes("系統統計備援") || text.includes("AI 摘要暫時無法生成");
}

export function getActionableDegradedReason(summary: AiSummary, scope: Scope): string {
  if (!summary) return "原因未記錄";
  const reasonObj = summary.degradedReason;
  if (reasonObj) {
    if (typeof reasonObj === "string" && reasonObj.trim()) return reasonObj;
    if (typeof reasonObj === "object" && reasonObj[scope] && reasonObj[scope]!.trim()) {
      return reasonObj[scope]!;
    }
  }
  if (summary.reason && summary.reason.trim()) return summary.reason;
  if (summary.error && summary.error.trim()) return summary.error;
  return "原因未記錄";
}

export function getLastSuccessTimeString(summary: AiSummary, scope: Scope): string {
  const t = typeof summary.lastSuccessAt === "object"
    ? summary.lastSuccessAt?.[scope]
    : (summary.lastSuccessAt || summary.lastSuccessful?.generatedAt);
  if (t && Number.isFinite(Date.parse(t))) {
    return new Date(t).toLocaleString("zh-TW", { hour12: false });
  }
  return "無歷史紀錄";
}

export function getRealSummaryForScope(
  summary: AiSummary | null,
  scope: Scope
): { text: string; generatedAt: string; model?: string; isStale: boolean } | null {
  if (!summary) return null;
  const currentText = scope === "domestic" ? summary.domestic : summary.international;
  const degradedThisScope = isScopeDegraded(summary, scope) || isDeterministicFallback(currentText);

  if (!degradedThisScope && !isBriefPlaceholder(currentText)) {
    return {
      text: currentText,
      generatedAt: summary.generatedAt,
      model: summary.model,
      isStale: false,
    };
  }

  const lastSucc = summary.lastSuccessful;
  if (lastSucc) {
    const lastText = scope === "domestic" ? lastSucc.domestic : lastSucc.international;
    if (lastText && !isBriefPlaceholder(lastText) && !isDeterministicFallback(lastText)) {
      return {
        text: lastText,
        generatedAt: lastSucc.generatedAt,
        model: lastSucc.model || summary.model,
        isStale: true,
      };
    }
  }

  return null;
}

// clusterSummaries 僅針對「國內」群生成（見 scripts/lib/nvidia.mjs：只 summarizeClusters(domesticClusters)）。
// cluster id 是各 scope 網路內的流水號（c0/c1/c2…），跨 scope 會撞號，故國際 scope 若直接套用，
// 國際群會誤掛同號的國內群摘要。此處依 scope 收斂：非國內一律回空，杜絕跨 scope 摘要污染。
export function clusterSummariesForScope(summary: AiSummary | null, scope: Scope): Record<string, string> {
  if (!summary || scope !== "domestic") return {};
  if (summary.clusterSummaries && Object.keys(summary.clusterSummaries).length) {
    return summary.clusterSummaries;
  }
  return summary.lastSuccessful?.clusterSummaries ?? {};
}

export async function loadSummary(): Promise<AiSummary | null> {
  try {
    const res = await fetch("./data/summary.json");
    if (!res.ok) return null;
    return (await res.json()) as AiSummary;
  } catch {
    return null;
  }
}

export function actionDecisionBrief(events: IntelEvent[]): string {
  const notable = events.filter((e) => RISK_ORDER[e.riskLevel] >= RISK_ORDER.medium);
  if (!notable.length) return "";
  const withTime = notable.map((e) => ({
    event: e,
    riskRank: RISK_ORDER[e.riskLevel],
    timeMs: Date.parse(e.timestamp) || 0,
  }));
  withTime.sort((a, b) => b.riskRank - a.riskRank || b.timeMs - a.timeMs);
  const decisions = withTime.slice(0, 6).map((item) => getActionDecision(item.event));
  const domains = [...new Set(decisions.map((d) => d.domain))].slice(0, 3).join("、");
  const recommendations = [...new Set(decisions.map((d) => d.recommendation))].slice(0, 2).join("；");
  return `行動判斷：${notable.length} 則｜${domains}｜${recommendations}`;
}

function compactText(text: string, limit: number): string {
  const chars = Array.from(text.trim());
  if (chars.length <= limit) return text;
  return `${chars.slice(0, limit).join("")}…`;
}

function expandableParagraph(className: string, text: string, limit: number): string {
  if (!text) return "";
  const chars = Array.from(text.trim());
  if (chars.length <= limit) {
    return `<p class="${className}" title="${esc(text)}">${esc(text)}</p>`;
  }
  const preview = `${chars.slice(0, limit).join("")}…`;
  return `<details class="ai-expandable ${className}-expandable">
    <summary class="${className}" title="${esc(text)}">${esc(preview)} <span class="ai-expand-trigger" aria-label="展開全文">展開全文 ▾</span></summary>
    <div class="ai-full-text" aria-label="完整內容">${esc(text)}</div>
  </details>`.trim();
}

function expandableSub(tag: string, text: string, limit: number): string {
  if (!text) return "";
  const chars = Array.from(text.trim());
  if (chars.length <= limit) {
    return `<div class="ai-sub" title="${esc(text)}"><span class="ai-sub-tag">${tag}</span>${esc(text)}</div>`;
  }
  const preview = `${chars.slice(0, limit).join("")}…`;
  return `<details class="ai-expandable ai-sub-expandable">
    <summary class="ai-sub" title="${esc(text)}"><span class="ai-sub-tag">${tag}</span>${esc(preview)} <span class="ai-expand-trigger" aria-label="展開文字">展開 ▾</span></summary>
    <div class="ai-full-text"><span class="ai-sub-tag">${tag}</span>${esc(text)}</div>
  </details>`.trim();
}

function renderBriefBody(summary: AiSummary, scope: Scope, degraded: boolean, hasEvidence: boolean): string {
  const currentText = scope === "domestic" ? summary.domestic : summary.international;
  if (isBriefPlaceholder(currentText)) {
    if (hasEvidence) {
      return `<p class="ai-brief-body ai-brief-degraded" role="alert">⚠ AI 摘要生成失敗，請直接檢視下方事件列表</p>`;
    }
    return `<p class="ai-brief-body ai-brief-empty">暫無事件資料</p>`;
  }

  const realSummary = getRealSummaryForScope(summary, scope);
  if (realSummary && realSummary.isStale) {
    const staleGen = new Date(realSummary.generatedAt).toLocaleString("zh-TW", { hour12: false });
    const modelTag = realSummary.model ? `由 ${esc(realSummary.model)} 生成` : "AI 生成";
    const notice = `<div class="ai-brief-stale-notice" role="status"><span class="ai-fallback-badge ai-stale-badge">前期摘要</span> ${modelTag} · 生成於 ${esc(staleGen)}（即時更新暫採統計備援）</div>`;
    const body = expandableParagraph("ai-brief-body", realSummary.text, 110);
    const statBackup = `<details class="ai-brief-stat-backup"><summary class="ai-stat-toggle">檢視即時統計備援 ▾</summary><div class="ai-full-text">${esc(currentText)}</div></details>`;
    return `${notice}${body}${statBackup}`;
  }

  const isFallback = degraded || isDeterministicFallback(currentText);
  if (isFallback) {
    const reason = getActionableDegradedReason(summary, scope);
    const lastSuccess = getLastSuccessTimeString(summary, scope);
    const notice = `<div class="ai-brief-fallback-notice" role="status"><span class="ai-fallback-badge">系統統計備援</span> <span class="ai-fallback-reason">原因：${esc(reason)}</span> · <span class="ai-last-success">上次成功生成：${esc(lastSuccess)}</span></div>`;
    return `${notice}${expandableParagraph("ai-brief-body ai-brief-degraded-body", currentText, 110)}`;
  }

  return expandableParagraph("ai-brief-body", currentText, 110);
}

export function renderAiBrief(container: HTMLElement, summary: AiSummary | null, scope: Scope, events: IntelEvent[] = []): void {
  if (!summary) {
    container.innerHTML = `<div class="ai-brief-head">🤖 AI 情勢摘要</div><p class="empty">摘要尚未生成</p>`;
    return;
  }
  const scopeLabel = scope === "domestic" ? "國內全域" : "國際全域";
  const head = `<div class="ai-brief-head">🤖 AI 情勢摘要 <span class="ai-scope-tag">${esc(scopeLabel)}</span></div>
    <div class="ai-scope-hint">全域情報敘述 · 不隨目前篩選條件變動</div>`;
  const gen = new Date(summary.generatedAt).toLocaleString("zh-TW", { hour12: false });

  const hasEvidence = events.length > 0 || Boolean(summary.dailyCounts?.some((c) => c > 0));
  const currentText = scope === "domestic" ? summary.domestic : summary.international;
  const degradedThisScope = isScopeDegraded(summary, scope) || isDeterministicFallback(currentText);
  const realSummary = getRealSummaryForScope(summary, scope);

  let meta: string;
  if (realSummary && realSummary.isStale) {
    const staleGen = new Date(realSummary.generatedAt).toLocaleString("zh-TW", { hour12: false });
    meta = `<p class="ai-brief-meta">前期摘要生成於 ${esc(staleGen)} · 快照時間 ${esc(gen)}</p>`;
  } else if (degradedThisScope) {
    const lastSuccess = getLastSuccessTimeString(summary, scope);
    meta = `<p class="ai-brief-meta">系統統計備援 · 上次成功生成：${esc(lastSuccess)} · 快照時間 ${esc(gen)}</p>`;
  } else {
    const modelLabel = summary.model ? `由 ${esc(summary.model)} 生成` : "AI 生成";
    meta = `<p class="ai-brief-meta">${modelLabel} · 生成於 ${esc(gen)}</p>`;
  }

  const action = actionDecisionBrief(events);
  let actionHtml = "";
  if (events.length === 0) {
    actionHtml = `<div class="ai-action ai-action-empty"><span class="ai-action-scope">目前篩選</span> 無符合事件</div>`;
  } else if (action) {
    actionHtml = `<div class="ai-action"><span class="ai-action-scope">目前篩選 (${events.length} 則)</span> ${esc(action)}</div>`;
  }

  // 國際 scope：只顯示國際每日摘要（近24h/趨勢/分類為國內資料）。
  if (scope !== "domestic") {
    container.innerHTML = `${head}${renderBriefBody(summary, scope, degradedThisScope, hasEvidence)}${actionHtml}${meta}`;
    return;
  }

  // 國內：每日 + 近 24h 即時 + 趨勢 + 分類別。
  const parts = [renderBriefBody(summary, scope, degradedThisScope, hasEvidence)];
  if (actionHtml) parts.push(actionHtml);

  const effectiveRecent24h = summary.recent24h || (realSummary?.isStale ? summary.lastSuccessful?.recent24h : "");
  if (effectiveRecent24h)
    parts.push(expandableSub("⚡ 近 24 小時", effectiveRecent24h, 48));

  const effectiveTrend = summary.trend || (realSummary?.isStale ? summary.lastSuccessful?.trend : "");
  if (effectiveTrend)
    parts.push(expandableSub("📈 趨勢", effectiveTrend, 48));

  const rawCats = summary.byCategory && Object.keys(summary.byCategory).length
    ? summary.byCategory
    : (realSummary?.isStale ? summary.lastSuccessful?.byCategory : undefined);
  const cats = rawCats ? Object.entries(rawCats) : [];
  if (cats.length) {
    const [first, ...rest] = cats;
    const firstPreview = compactText(first[1], 42);
    const firstFull = first[1];
    const firstHtml = Array.from(firstFull.trim()).length > 42
      ? `<li title="${esc(firstFull)}"><details class="ai-cat-expandable"><summary><b>${esc(first[0])}</b>${esc(firstPreview)} <span class="ai-expand-trigger">展開 ▾</span></summary><div class="ai-full-text"><b>${esc(first[0])}</b>${esc(firstFull)}</div></details></li>`
      : `<li title="${esc(firstFull)}"><b>${esc(first[0])}</b>${esc(firstFull)}</li>`;
    parts.push(`<ul class="ai-cats">${firstHtml}</ul>`);

    if (rest.length > 0) {
      const restRows = rest.map(([c, t]) => {
        const preview = compactText(t, 42);
        return `<div class="ai-cat-row" title="${esc(t)}"><b>${esc(c)}</b>${esc(preview)}</div>`;
      }).join("");
      parts.push(`<details class="ai-cats-more"><summary class="ai-cats-more-toggle">查看其餘 ${rest.length} 個分類摘要 ▾</summary><div class="ai-cats-more-list">${restRows}</div></details>`);
    }
  }
  container.innerHTML = `${head}${parts.join("")}${meta}`;
}
