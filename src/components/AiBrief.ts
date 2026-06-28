import { esc } from "../utils/escape";
import type { Scope } from "../types/event";

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

export function renderAiBrief(container: HTMLElement, summary: AiSummary | null, scope: Scope): void {
  if (!summary) {
    container.innerHTML = `<div class="ai-brief-head">🤖 AI 情勢摘要</div><p class="empty">摘要尚未生成</p>`;
    return;
  }
  const head = `<div class="ai-brief-head">🤖 AI 情勢摘要</div>`;
  const gen = new Date(summary.generatedAt).toLocaleString("zh-TW", { hour12: false });
  const meta = `<p class="ai-brief-meta">${summary.model ? `由 ${esc(summary.model)} 生成` : "AI 生成"} · ${esc(gen)}</p>`;

  // 國際 scope：只顯示國際每日摘要（近24h/趨勢/分類為國內資料）。
  if (scope !== "domestic") {
    container.innerHTML = `${head}<p class="ai-brief-body">${esc(summary.international)}</p>${meta}`;
    return;
  }

  // 國內：每日 + 近 24h 即時 + 趨勢 + 分類別。
  const parts = [`<p class="ai-brief-body">${esc(summary.domestic)}</p>`];
  if (summary.recent24h)
    parts.push(`<div class="ai-sub"><span class="ai-sub-tag">⚡ 近 24 小時</span>${esc(summary.recent24h)}</div>`);
  if (summary.trend)
    parts.push(`<div class="ai-sub"><span class="ai-sub-tag">📈 趨勢</span>${esc(summary.trend)}</div>`);
  const cats = summary.byCategory ? Object.entries(summary.byCategory) : [];
  if (cats.length) {
    const items = cats.map(([c, t]) => `<li><b>${esc(c)}</b>${esc(t)}</li>`).join("");
    parts.push(`<ul class="ai-cats">${items}</ul>`);
  }
  container.innerHTML = `${head}${parts.join("")}${meta}`;
}
