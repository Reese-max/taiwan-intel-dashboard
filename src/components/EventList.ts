import type { IntelEvent } from "../types/event";
import type { CorroborationResult } from "../utils/corroboration";
import { eventCard, type RelationChip } from "./EventCard";

export interface EventListOptions {
  relatedCount?: (id: string) => number;
  relationOf?: (id: string) => RelationChip | undefined;
  corroboration?: (id: string) => CorroborationResult;
  emptyMessage?: string;
}

// 增量渲染批量：初次只進 DOM 這麼多張，其餘捲到底再分批補上。
const PAGE_SIZE = 50;

// 每個容器對應上一輪的清理函式（重新渲染前先拆掉舊 observer，避免洩漏/重複觸發）。
const teardowns = new WeakMap<HTMLElement, () => void>();

export function resetEventListScroll(container: HTMLElement): void {
  const scrollParent = container.parentElement;
  // 內層捲動容器（桌機 .col-list 的 overflow-y:auto）歸零，焦點清單從第一則顯示。
  if (scrollParent) scrollParent.scrollTop = 0;
  // 整頁(window)也可能被捲動：清單區塊頂端被捲到視窗上方時，焦點結果會落在
  // 視窗外而看不到，故捲回視窗頂端（桌機雙層捲動 / 窄螢幕整頁捲動皆適用）。
  const region = scrollParent ?? container;
  if (typeof region.getBoundingClientRect !== "function") return;
  if (region.getBoundingClientRect().top < 0) region.scrollIntoView({ block: "start" });
}

export function renderEventList(container: HTMLElement, events: IntelEvent[], opts: EventListOptions = {}): void {
  // 拆掉上一輪的 observer（filter/search 改變會重新進來）。
  teardowns.get(container)?.();
  teardowns.delete(container);

  if (!events.length) {
    const emptyMessage = opts.emptyMessage ?? "無符合條件的情報";
    container.innerHTML = `<p class="empty">${emptyMessage}</p>`;
    return;
  }

  const cardHtml = (e: IntelEvent) =>
    eventCard(e, opts.relatedCount?.(e.id) ?? 0, opts.relationOf?.(e.id), opts.corroboration?.(e.id));
  const total = events.length;
  let shown = Math.min(PAGE_SIZE, total);

  // 初次只渲染第一批，DOM 從 N 張降到最多 PAGE_SIZE 張。
  container.innerHTML = events.slice(0, shown).map(cardHtml).join("");
  if (shown >= total) return; // 一批就放完，免頁尾與 observer。

  // 頁尾：狀態文字 + 載入更多按鈕，同時當 IntersectionObserver 哨兵。
  const footer = document.createElement("div");
  footer.className = "list-more";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "load-more-btn";
  const status = document.createElement("span");
  status.className = "list-more-status";
  footer.append(btn, status);
  container.appendChild(footer);

  const updateLabels = (): void => {
    btn.textContent = `載入更多（還有 ${total - shown}）`;
    status.textContent = `已顯示 ${shown} / ${total} 筆`;
  };

  let observer: IntersectionObserver | undefined;
  const loadMore = (): void => {
    const next = events.slice(shown, shown + PAGE_SIZE).map(cardHtml).join("");
    footer.insertAdjacentHTML("beforebegin", next);
    shown = Math.min(shown + PAGE_SIZE, total);
    if (shown >= total) {
      observer?.disconnect();
      footer.remove();
      return;
    }
    updateLabels();
  };

  updateLabels();
  btn.addEventListener("click", loadMore);

  // 捲到接近底部（提前 300px）自動補一批；不支援時退回手動按鈕。
  if (typeof IntersectionObserver === "function") {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "300px 0px" },
    );
    observer.observe(footer);
  }

  teardowns.set(container, () => observer?.disconnect());
}
