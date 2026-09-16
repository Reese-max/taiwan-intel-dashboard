import type { IntelEvent } from "../types/event";
import { esc } from "../utils/escape";
import { buildTriage, type TriageSortMode } from "../utils/triage";
import { riskBadge } from "./RiskBadge";

export interface TriageInboxOptions {
  acked: Set<string> | string[];
  onFocus: (id: string) => void;
  onAck: (id: string) => void;
  onAckAll: () => void;
  sinceDays?: number;
  sortMode?: TriageSortMode;
  onSortModeChange?: (mode: TriageSortMode) => void;
  storageOk?: boolean;
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

function emptyLabel(sinceDays: number | undefined, mode: TriageSortMode, total: number, unreadCount: number): string {
  if (mode === "unread-only" && total > 0 && unreadCount === 0) {
    return "目前無未讀的高風險事件（可切換「標準」檢視已讀）";
  }
  const range = sinceDays ? `近 ${sinceDays} 天` : "目前";
  return `${range}無危急/高風險待閱`;
}

export function renderTriageInbox(container: HTMLElement, events: IntelEvent[], opts: TriageInboxOptions): void {
  const previousOpen = (container.querySelector?.("details.triage-card") as HTMLDetailsElement | null | undefined)?.open;
  const isMobile = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(max-width: 640px), (max-width: 932px) and (max-height: 500px)").matches
    : false;
  const open = previousOpen ?? !isMobile;
  const currentMode: TriageSortMode = (container.dataset?.triageMode as TriageSortMode) || opts.sortMode || "default";
  const triage = buildTriage(events, opts.acked, Date.now(), { mode: currentMode });
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
    triage.items.length === 0
      ? `<p class="empty">${esc(emptyLabel(opts.sinceDays, currentMode, triage.total, triage.unreadCount))}</p>`
      : `<div class="triage-list">${rows}</div>${capped}`;

  const storageWarningHtml = opts.storageOk === false
    ? `<div class="triage-storage-warning" role="status" aria-live="polite">⚠️ 瀏覽器儲存受限：本次已讀狀態僅暫存於此頁，重新開啟後可能不保留。</div>`
    : "";

  container.innerHTML = `
    <details class="triage-card" aria-label="高風險待閱收件匣" ${open ? "open" : ""}>
      <summary class="triage-head">
        <strong>高風險待閱 · ${triage.unreadCount} 未讀 / ${triage.total} 則</strong>
        <span class="triage-toggle" aria-hidden="true"></span>
      </summary>
      <div class="triage-body">
        <div class="triage-notice" role="note">
          <span class="triage-notice-icon" aria-hidden="true">ℹ️</span>
          <span>已讀記錄僅儲存在此瀏覽器（不跨裝置同步）；標示已讀不代表已查證、已處置或完成交班。</span>
        </div>
        ${storageWarningHtml}
        <div class="triage-actions">
          <div class="triage-filter-group" role="group" aria-label="待閱排序篩選">
            <button type="button" class="triage-filter-btn${currentMode === "default" ? " is-active" : ""}" data-mode="default">標準</button>
            <button type="button" class="triage-filter-btn${currentMode === "unread-first" ? " is-active" : ""}" data-mode="unread-first">未讀優先</button>
            <button type="button" class="triage-filter-btn${currentMode === "unread-only" ? " is-active" : ""}" data-mode="unread-only">只看未讀</button>
          </div>
          <button type="button" class="triage-ack-all" ${triage.unreadCount === 0 ? "disabled" : ""}>全部標為已讀</button>
        </div>
        ${body}
      </div>
    </details>`;

  container.querySelectorAll?.(".triage-filter-btn")?.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetMode = (btn as HTMLElement).dataset?.mode as TriageSortMode;
      if (!targetMode || targetMode === currentMode) return;
      if (container.dataset) container.dataset.triageMode = targetMode;
      if (opts.onSortModeChange) {
        opts.onSortModeChange(targetMode);
      } else {
        renderTriageInbox(container, events, { ...opts, sortMode: targetMode });
      }
    });
  });

  container.querySelector?.(".triage-ack-all")?.addEventListener("click", () => {
    opts.onAckAll();
  });
  container.querySelectorAll?.(".triage-row")?.forEach((row) => {
    row.addEventListener("click", () => {
      const id = (row as HTMLElement).dataset?.id;
      if (!id) return;
      opts.onFocus(id);
      opts.onAck(id);
    });
  });
}
