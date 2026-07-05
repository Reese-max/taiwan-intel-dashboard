import type { IntelEvent } from "../types/event";
import { esc } from "../utils/escape";
import { buildTriage } from "../utils/triage";
import { riskBadge } from "./RiskBadge";

export interface TriageInboxOptions {
  acked: Set<string> | string[];
  onFocus: (id: string) => void;
  onAck: (id: string) => void;
  onAckAll: () => void;
  sinceDays?: number;
}

function fmtDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("zh-TW", { hour12: false });
}

function sourceDisplayName(e: IntelEvent): string {
  if (e.source.publisherName) return e.source.publisherName;
  if (e.source.aggregatorName) return `${e.source.aggregatorName} 聚合`;
  return e.source.name;
}

function emptyLabel(sinceDays: number | undefined): string {
  const range = sinceDays ? `近 ${sinceDays} 天` : "目前";
  return `${range}無危急/高風險待處置`;
}

export function renderTriageInbox(container: HTMLElement, events: IntelEvent[], opts: TriageInboxOptions): void {
  const triage = buildTriage(events, opts.acked, Date.now());
  const rows = triage.items
    .map((e) => {
      const unreadClass = e.unread ? " is-unread" : "";
      return `<button type="button" class="triage-row${unreadClass}" data-id="${esc(e.id)}">
        <span class="triage-risk">${riskBadge(e.riskLevel)}</span>
        <span class="triage-main">
          <span class="triage-title">${esc(e.title)}</span>
          <span class="triage-meta">${esc(e.region)} · ${esc(fmtDate(e.timestamp))} · ${esc(sourceDisplayName(e))}</span>
        </span>
      </button>`;
    })
    .join("");
  const capped =
    triage.capped > 0 ? `<p class="triage-capped">還有 ${triage.capped} 則（可用篩選查看）</p>` : "";
  const body =
    triage.total === 0
      ? `<p class="empty">${esc(emptyLabel(opts.sinceDays))}</p>`
      : `<div class="triage-list">${rows}</div>${capped}`;

  container.innerHTML = `
    <section class="triage-card" aria-label="危急待處置收件匣">
      <header class="triage-head">
        <strong>⚠ 待處置 · ${triage.unreadCount} 未讀 / ${triage.total} 則</strong>
        <button type="button" class="triage-ack-all" ${triage.unreadCount === 0 ? "disabled" : ""}>全部標為已讀</button>
      </header>
      ${body}
    </section>`;

  container.querySelector<HTMLButtonElement>(".triage-ack-all")?.addEventListener("click", () => {
    opts.onAckAll();
  });
  container.querySelectorAll<HTMLButtonElement>(".triage-row").forEach((row) => {
    row.addEventListener("click", () => {
      const id = row.dataset.id;
      if (!id) return;
      opts.onFocus(id);
      opts.onAck(id);
    });
  });
}
