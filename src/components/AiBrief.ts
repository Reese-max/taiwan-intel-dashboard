import { esc } from "../utils/escape";
import type { IntelEvent, Scope } from "../types/event";
import { RISK_ORDER } from "../types/event";
import { getActionDecision } from "../utils/actionDecision";

export interface AiSummary {
  domestic: string;
  international: string;
  recent24h?: string;
  byCategory?: Record<string, string>;
  trend?: string;
  dailyCounts?: number[];
  clusterSummaries?: Record<string, string>;
  model?: string;
  generatedAt: string;
}

// clusterSummaries 僅針對「國內」群生成（見 scripts/lib/nvidia.mjs：只 summarizeClusters(domesticClusters)）。
// cluster id 是各 scope 網路內的流水號（c0/c1/c2…），跨 scope 會撞號，故國際 scope 若直接套用，
// 國際群會誤掛同號的國內群摘要。此處依 scope 收斂：非國內一律回空，杜絕跨 scope 摘要污染。
export function clusterSummariesForScope(summary: AiSummary | null, scope: Scope): Record<string, string> {
  if (!summary || scope !== "domestic") return {};
  return summary.clusterSummaries ?? {};
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
  const notable = events
    .filter((e) => RISK_ORDER[e.riskLevel] >= RISK_ORDER.medium)
    .slice()
    .sort((a, b) => RISK_ORDER[b.riskLevel] - RISK_ORDER[a.riskLevel] || Date.parse(b.timestamp) - Date.parse(a.timestamp));
  if (!notable.length) return "";
  const decisions = notable.slice(0, 6).map((e) => getActionDecision(e));
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

export function renderAiBrief(container: HTMLElement, summary: AiSummary | null, scope: Scope, events: IntelEvent[] = []): void {
  if (!summary) {
    container.innerHTML = `<div class="ai-brief-head">🤖 AI 情勢摘要</div><p class="empty">摘要尚未生成</p>`;
    return;
  }
  const scopeLabel = scope === "domestic" ? "國內全域" : "國際全域";
  const head = `<div class="ai-brief-head">🤖 AI 情勢摘要 <span class="ai-scope-tag">${esc(scopeLabel)}</span></div>
    <div class="ai-scope-hint">全域情報敘述 · 不隨目前篩選條件變動</div>`;
  const gen = new Date(summary.generatedAt).toLocaleString("zh-TW", { hour12: false });
  const meta = `<p class="ai-brief-meta">${summary.model ? `由 ${esc(summary.model)} 生成` : "AI 生成"} · 生成於 ${esc(gen)}</p>`;

  const action = actionDecisionBrief(events);
  let actionHtml = "";
  if (events.length === 0) {
    actionHtml = `<div class="ai-action ai-action-empty"><span class="ai-action-scope">目前篩選</span> 無符合事件</div>`;
  } else if (action) {
    actionHtml = `<div class="ai-action"><span class="ai-action-scope">目前篩選 (${events.length} 則)</span> ${esc(action)}</div>`;
  }

  // 國際 scope：只顯示國際每日摘要（近24h/趨勢/分類為國內資料）。
  if (scope !== "domestic") {
    container.innerHTML = `${head}${expandableParagraph("ai-brief-body", summary.international, 110)}${actionHtml}${meta}`;
    return;
  }

  // 國內：每日 + 近 24h 即時 + 趨勢 + 分類別。
  const parts = [expandableParagraph("ai-brief-body", summary.domestic, 110)];
  if (actionHtml) parts.push(actionHtml);
  if (summary.recent24h)
    parts.push(expandableSub("⚡ 近 24 小時", summary.recent24h, 48));
  if (summary.trend)
    parts.push(expandableSub("📈 趨勢", summary.trend, 48));

  const cats = summary.byCategory ? Object.entries(summary.byCategory) : [];
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
