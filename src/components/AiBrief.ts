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

function compactParagraph(className: string, text: string, limit: number): string {
  return `<p class="${className}" title="${esc(text)}">${esc(compactText(text, limit))}</p>`;
}

export function renderAiBrief(container: HTMLElement, summary: AiSummary | null, scope: Scope, events: IntelEvent[] = []): void {
  if (!summary) {
    container.innerHTML = `<div class="ai-brief-head">🤖 AI 情勢摘要</div><p class="empty">摘要尚未生成</p>`;
    return;
  }
  const head = `<div class="ai-brief-head">🤖 AI 情勢摘要</div>`;
  const gen = new Date(summary.generatedAt).toLocaleString("zh-TW", { hour12: false });
  const meta = `<p class="ai-brief-meta">${summary.model ? `由 ${esc(summary.model)} 生成` : "AI 生成"} · ${esc(gen)}</p>`;
  const action = actionDecisionBrief(events);
  const actionHtml = action ? `<div class="ai-action">${esc(action)}</div>` : "";

  // 國際 scope：只顯示國際每日摘要（近24h/趨勢/分類為國內資料）。
  if (scope !== "domestic") {
    container.innerHTML = `${head}${compactParagraph("ai-brief-body", summary.international, 110)}${actionHtml}${meta}`;
    return;
  }

  // 國內：每日 + 近 24h 即時 + 趨勢 + 分類別。
  const parts = [compactParagraph("ai-brief-body", summary.domestic, 110)];
  if (actionHtml) parts.push(actionHtml);
  if (summary.recent24h)
    parts.push(`<div class="ai-sub" title="${esc(summary.recent24h)}"><span class="ai-sub-tag">⚡ 近 24 小時</span>${esc(compactText(summary.recent24h, 48))}</div>`);
  if (summary.trend)
    parts.push(`<div class="ai-sub" title="${esc(summary.trend)}"><span class="ai-sub-tag">📈 趨勢</span>${esc(compactText(summary.trend, 48))}</div>`);
  const cats = summary.byCategory ? Object.entries(summary.byCategory) : [];
  if (cats.length) {
    const items = cats
      .slice(0, 1)
      .map(([c, t]) => `<li title="${esc(t)}"><b>${esc(c)}</b>${esc(compactText(t, 42))}</li>`)
      .join("");
    parts.push(`<ul class="ai-cats">${items}</ul>`);
  }
  container.innerHTML = `${head}${parts.join("")}${meta}`;
}
