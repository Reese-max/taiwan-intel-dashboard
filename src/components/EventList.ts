import type { IntelEvent } from "../types/event";
import { eventCard, type RelationChip } from "./EventCard";

export interface EventListOptions {
  relatedCount?: (id: string) => number;
  relationOf?: (id: string) => RelationChip | undefined;
}

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
  container.innerHTML = events.length
    ? events.map((e) => eventCard(e, opts.relatedCount?.(e.id) ?? 0, opts.relationOf?.(e.id))).join("")
    : `<p class="empty">無符合條件的情報</p>`;
}
