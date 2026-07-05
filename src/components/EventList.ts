import type { IntelEvent } from "../types/event";
import type { CollapsedGroup } from "../utils/collapse";
import type { CorroborationResult } from "../utils/corroboration";
import { esc } from "../utils/escape";
import { eventCard, fmtDate, sourceDisplayName, type RelationChip } from "./EventCard";

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
const expandedGroups = new WeakMap<HTMLElement, Set<string>>();

type EventListItem = IntelEvent | CollapsedGroup;

function isCollapsedGroup(item: EventListItem): item is CollapsedGroup {
  return "representative" in item && "members" in item;
}

function sourceLink(e: IntelEvent): string {
  const linkUrl = e.source.url ?? e.source.recordRef;
  if (linkUrl && /^https?:\/\//.test(linkUrl)) {
    return `<a class="collapse-source-link" href="${esc(linkUrl)}" target="_blank" rel="noopener">原文</a>`;
  }
  return `<span class="collapse-source-link collapse-source-none">無原文連結</span>`;
}

function collapsedMembersHtml(group: CollapsedGroup): string {
  return group.members
    .filter((e) => e.id !== group.representative.id)
    .map(
      (e) => `<li class="collapse-source-row" data-id="${esc(e.id)}">
        <span class="collapse-source-name">${esc(sourceDisplayName(e))}</span>
        <time>${esc(fmtDate(e.timestamp))}</time>
        ${sourceLink(e)}
      </li>`,
    )
    .join("");
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

export function renderEventList(container: HTMLElement, items: EventListItem[], opts: EventListOptions = {}): void {
  // 拆掉上一輪的 observer（filter/search 改變會重新進來）。
  teardowns.get(container)?.();
  teardowns.delete(container);

  if (!items.length) {
    const emptyMessage = opts.emptyMessage ?? "無符合條件的情報";
    container.innerHTML = `<p class="empty">${emptyMessage}</p>`;
    return;
  }

  const expanded = expandedGroups.get(container) ?? new Set<string>();
  expandedGroups.set(container, expanded);
  const renderCard = (e: IntelEvent, extraHeaderHtml = "") =>
    eventCard(
      e,
      opts.relatedCount?.(e.id) ?? 0,
      opts.relationOf?.(e.id),
      opts.corroboration?.(e.id),
      extraHeaderHtml,
    );
  const cardHtml = (item: EventListItem) => {
    const group: CollapsedGroup = isCollapsedGroup(item)
      ? item
      : { representative: item, members: [item], sourceCount: 1 };
    const e = group.representative;
    const canExpand = group.members.length > 1 && group.sourceCount >= 2;
    const groupId = e.id;
    const isExpanded = expanded.has(groupId);
    const toggle = canExpand
      ? `<button type="button" class="collapse-toggle" data-collapse="${esc(groupId)}" aria-expanded="${isExpanded}" title="展開同事件的其餘來源">🗂 收合 ${group.sourceCount} 源</button>`
      : "";
    const card = renderCard(e, toggle);
    if (!canExpand) {
      if (isCollapsedGroup(item) && group.members.length > 1) return group.members.map((member) => renderCard(member)).join("");
      return card;
    }
    return `<div class="collapsed-group" data-collapse-group="${esc(groupId)}">
      ${card}
      <ul class="collapse-members" ${isExpanded ? "" : "hidden"} aria-label="同事件其餘來源">
        ${collapsedMembersHtml(group)}
      </ul>
    </div>`;
  };
  const total = items.length;
  let shown = Math.min(PAGE_SIZE, total);
  let observer: IntersectionObserver | undefined;

  const onToggle = (ev: Event): void => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>(".collapse-toggle");
    if (!btn?.dataset.collapse || !container.contains(btn)) return;
    const id = btn.dataset.collapse;
    const nextExpanded = !expanded.has(id);
    if (nextExpanded) expanded.add(id);
    else expanded.delete(id);
    btn.setAttribute("aria-expanded", String(nextExpanded));
    const groupEl = btn.closest<HTMLElement>(".collapsed-group");
    const members = groupEl?.querySelector<HTMLElement>(".collapse-members");
    if (members) members.hidden = !nextExpanded;
  };

  // 初次只渲染第一批，DOM 從 N 張降到最多 PAGE_SIZE 張。
  container.innerHTML = items.slice(0, shown).map(cardHtml).join("");
  container.addEventListener("click", onToggle);
  if (shown >= total) {
    teardowns.set(container, () => container.removeEventListener("click", onToggle));
    return; // 一批就放完，免頁尾與 observer。
  }

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

  const loadMore = (): void => {
    const next = items.slice(shown, shown + PAGE_SIZE).map(cardHtml).join("");
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

  teardowns.set(container, () => {
    observer?.disconnect();
    container.removeEventListener("click", onToggle);
  });
}
