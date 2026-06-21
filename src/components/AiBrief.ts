import { esc } from "../utils/escape";
import type { Scope } from "../types/event";

export interface AiSummary {
  domestic: string;
  international: string;
  model?: string;
  generatedAt: string;
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
  const text = scope === "domestic" ? summary.domestic : summary.international;
  const gen = new Date(summary.generatedAt).toLocaleString("zh-TW", { hour12: false });
  const by = summary.model ? `由 ${esc(summary.model)} 生成` : "AI 生成";
  container.innerHTML = `
    <div class="ai-brief-head">🤖 AI 情勢摘要</div>
    <p class="ai-brief-body">${esc(text)}</p>
    <p class="ai-brief-meta">${by} · ${esc(gen)}</p>`;
}
