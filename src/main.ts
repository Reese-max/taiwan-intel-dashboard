import "./styles/global.css";
import { t } from "./i18n/zh-TW";
import { getState, setState, subscribe } from "./store";
import { loadEvents, filterEvents, loadMapEvents } from "./data/loader";
import { edgeTypeLabel, loadNetwork, type NetworkIndex, type RelatedRef } from "./data/network";
import { renderEventList, resetEventListScroll } from "./components/EventList";
import { renderKpiStrip } from "./components/KpiStrip";
import { renderRelationGraph, type RelationNode } from "./components/RelationGraph";
import { createRelationGraphController } from "./components/RelationGraphController";
import { esc } from "./utils/escape";
import { debounce } from "./utils/debounce";
import { renderFilterBar } from "./components/FilterBar";
import { renderTimeline } from "./components/TimelineView";
import { renderSourcePanel } from "./components/SourcePanel";
import { clusterSummariesForScope, loadSummary, renderAiBrief, type AiSummary } from "./components/AiBrief";
import { renderPoliceHealthPanel } from "./components/PoliceHealthPanel";
import { renderTopClusters } from "./components/TopClusters";
import { renderTriageInbox } from "./components/TriageInbox";
import { MapView } from "./components/MapView";
import type { IntelEvent, RiskLevel, Scope } from "./types/event";
import { emptyListHint } from "./utils/emptyHint";
import { applySearchSubnet } from "./search";
import { loadTriageAcked, saveTriageAcked } from "./utils/triage";
import { corroborationOf } from "./utils/corroboration";
import { collapseSameIncident } from "./utils/collapse";
import { stalenessNotice } from "./utils/staleness";

const DEFAULT_SINCE_DAYS = 3;
const REFRESH_MS = 300000;
const TIP_KEY = "taiwan-intel-link-tip-dismissed";
const COMPACT_LAYOUT_KEY = "taiwan-intel-compact-layout";
const SIDE_PANEL_STATE_KEY = "taiwan-intel-side-panel-state";
const MOBILE_VIEW_KEY = "taiwan-intel-mobile-view";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <h1>${t.appTitle}</h1>
      <p class="subtitle">${t.subtitle}</p>
    </div>
    <nav class="tabs" role="tablist">
      <button type="button" data-scope="domestic" class="active" role="tab" aria-selected="true">${t.tabDomestic}</button>
      <button type="button" data-scope="international" role="tab" aria-selected="false">${t.tabInternational}</button>
    </nav>
    <button id="compact-layout-toggle" class="layout-toggle" type="button" aria-pressed="false" aria-label="切換簡潔版面">
      收合側欄
    </button>
    <div id="data-freshness" class="data-freshness" aria-live="polite"></div>
  </header>
  <div id="usage-tip" class="usage-tip" hidden>
    <span>🔗＝點我看關聯；點事件可追整張情報網。</span>
    <button type="button" id="close-tip">我知道了</button>
  </div>
  <div id="filterbar" class="filterbar"></div>
  <div id="filter-summary" class="filter-summary" hidden></div>
  <nav id="mobile-view-switcher" class="mobile-view-switcher" aria-label="行動版視圖切換">
    <button type="button" data-mobile-view="map">地圖</button>
    <button type="button" data-mobile-view="list">列表</button>
    <button type="button" data-mobile-view="insights">重點</button>
  </nav>
  <section id="kpistrip" class="kpi-strip" aria-label="關鍵指標"></section>
  <main class="layout">
    <section class="col-map">
      <h2>${t.map}</h2>
      <div id="map" class="map"></div>
      <h2>${t.timeline}</h2>
      <div id="timeline"></div>
    </section>
    <section class="col-list">
      <h2>${t.events} <span id="count" class="count-pill"></span></h2>
      <div id="triageinbox" class="triage-inbox"></div>
      <div id="focusbar" class="focusbar" hidden></div>
      <div id="relationgraph" class="relation-graph" hidden></div>
      <div id="eventlist"></div>
    </section>
    <aside class="col-side">
      <details class="side-section" data-side-section="topclusters" open>
        <summary>今日最大情報群</summary>
        <div id="topclusters"></div>
      </details>
      <details class="side-section" data-side-section="aibrief" open>
        <summary>AI 情勢摘要</summary>
        <div id="aibrief" class="ai-brief"></div>
      </details>
      <details class="side-section" data-side-section="policehealth">
        <summary>警政健康檢查</summary>
        <div id="policehealth"></div>
      </details>
      <details class="side-section" data-side-section="sourcepanel">
        <summary>來源總覽</summary>
        <div id="sourcepanel"></div>
      </details>
    </aside>
  </main>
  <nav class="mobile-quickbar" aria-label="快捷操作">
    <div class="search-box mq-search">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="16.5" y1="16.5" x2="21" y2="21"></line></svg>
      <input id="mq-query" type="search" aria-label="搜尋情報" placeholder="搜尋情報…">
    </div>
    <button id="mq-filter" type="button">篩選</button>
  </nav>`;

const mapView = new MapView(document.getElementById("map")!, { onFocus: focusEvent });

// 手機底部快捷列：搜尋同步寫入 store；篩選鈕捲到頂並聚焦篩選器。
const mqQuery = document.getElementById("mq-query") as HTMLInputElement | null;
const compactToggle = document.getElementById("compact-layout-toggle") as HTMLButtonElement | null;
type MobileView = "map" | "list" | "insights";

function isMobileView(value: string | null | undefined): value is MobileView {
  return value === "map" || value === "list" || value === "insights";
}

function mobileViewTarget(view: MobileView): HTMLElement | null {
  if (view === "map") return document.querySelector<HTMLElement>(".col-map");
  if (view === "list") return document.querySelector<HTMLElement>(".col-list");
  return document.querySelector<HTMLElement>(".col-side");
}

function setMobileView(view: MobileView, options: { scroll?: boolean } = {}): void {
  document.body.classList.toggle("mobile-view-map", view === "map");
  document.body.classList.toggle("mobile-view-list", view === "list");
  document.body.classList.toggle("mobile-view-insights", view === "insights");
  document.querySelectorAll<HTMLButtonElement>("[data-mobile-view]").forEach((btn) => {
    const active = btn.dataset.mobileView === view;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
  try {
    localStorage.setItem(MOBILE_VIEW_KEY, view);
  } catch {
    // localStorage 不可用時略過保存
  }
  if (view === "map") void mapView.resize().catch(() => {});
  if (options.scroll) {
    window.requestAnimationFrame(() => {
      mobileViewTarget(view)?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (view === "map") void mapView.resize().catch(() => {});
    });
  }
}

function initMobileView(): void {
  let view: MobileView = "list";
  try {
    const saved = localStorage.getItem(MOBILE_VIEW_KEY);
    if (isMobileView(saved)) view = saved;
  } catch {
    view = "list";
  }
  setMobileView(view);
  document.querySelectorAll<HTMLButtonElement>("[data-mobile-view]").forEach((btn) => {
    btn.onclick = () => {
      const next = btn.dataset.mobileView;
      if (isMobileView(next)) setMobileView(next, { scroll: true });
    };
  });
}

function setCompactLayout(enabled: boolean): void {
  document.body.classList.toggle("layout-compact", enabled);
  if (compactToggle) {
    compactToggle.setAttribute("aria-pressed", String(enabled));
    compactToggle.textContent = enabled ? "顯示側欄" : "收合側欄";
    compactToggle.setAttribute("title", enabled ? "顯示右側欄與右側卡片" : "收合右側欄以縮減版面");
    compactToggle.setAttribute("aria-label", enabled ? "顯示右側欄" : "收合右側欄");
  }
  try {
    if (enabled) localStorage.setItem(COMPACT_LAYOUT_KEY, "1");
    else localStorage.removeItem(COMPACT_LAYOUT_KEY);
  } catch {
    // localStorage 可能不可用時，僅保持目前畫面狀態，不中斷操作
  }
  void mapView.resize().catch(() => {});
}

let compactMode = false;
try {
  compactMode = localStorage.getItem(COMPACT_LAYOUT_KEY) === "1";
} catch {
  compactMode = false;
}
setCompactLayout(compactMode);

if (compactToggle) {
  compactToggle.onclick = () => {
    setCompactLayout(!document.body.classList.contains("layout-compact"));
  };
}

function loadSidePanelState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SIDE_PANEL_STATE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function saveSidePanelState(): void {
  const state: Record<string, boolean> = {};
  document.querySelectorAll<HTMLDetailsElement>(".side-section[data-side-section]").forEach((detail) => {
    if (detail.dataset.sideSection) state[detail.dataset.sideSection] = detail.open;
  });
  try {
    localStorage.setItem(SIDE_PANEL_STATE_KEY, JSON.stringify(state));
  } catch {
    // localStorage 不可用時略過保存，不影響互動
  }
}

function initSidePanelState(): void {
  const saved = loadSidePanelState();
  document.querySelectorAll<HTMLDetailsElement>(".side-section[data-side-section]").forEach((detail) => {
    const key = detail.dataset.sideSection;
    if (key && Object.prototype.hasOwnProperty.call(saved, key)) detail.open = saved[key];
    detail.addEventListener("toggle", saveSidePanelState);
  });
}

initSidePanelState();
initMobileView();

if (mqQuery)
  mqQuery.oninput = debounce((ev: unknown) => {
    const input = (ev as Event).target as HTMLInputElement;
    setState({ query: input.value.trim() || undefined });
  }, 200);

window.addEventListener(
  "resize",
  debounce(() => {
    void mapView.resize();
  }, 150),
);
const mqFilter = document.getElementById("mq-filter");
if (mqFilter)
  mqFilter.onclick = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.getElementById("f-cat")?.focus();
  };
const cache: Partial<Record<Scope, IntelEvent[]>> = {};
const netCache: Partial<Record<Scope, NetworkIndex>> = {};
const triageAcked = loadTriageAcked();
// 地圖 first-paint：先用精簡 map.json 即時繪出標點，不必等完整事件（給清單用）載入；
// refresh() 隨後以完整集重繪校正。slim 載入失敗則無早繪、行為不變。
void loadMapEvents(getState().scope).then((pts) => {
  if (pts && !cache[getState().scope]) void mapView.render(filterEvents(pts, getState()), getState().scope);
});
let summary: AiSummary | null = null;
// 情報網聚焦：可選單一事件，或選一個 cluster 展開整群。
let focusId: string | null = null;
let focusCluster: string | null = null;
let applyingHash = false;
let lastQuery = "";
let lastViewKey = "";
let lastMapKey = "";
let lastGeneratedAt: string | null = null;

function isScope(v: string | null): v is Scope {
  return v === "domestic" || v === "international";
}

function isRisk(v: string | null): v is RiskLevel {
  return v === "low" || v === "medium" || v === "high" || v === "critical";
}

function setActiveScopeTab(scope: Scope): void {
  document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((btn) => {
    const active = btn.dataset.scope === scope;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
}

function writeHash(mode: "replace" | "push" = "replace"): void {
  if (applyingHash) return;
  const s = getState();
  const params = new URLSearchParams();
  params.set("scope", s.scope);
  if (s.category) params.set("category", s.category);
  if (s.minRisk) params.set("risk", s.minRisk);
  if (s.sinceDays) params.set("since", String(s.sinceDays));
  if (s.query) params.set("q", s.query);
  if (focusCluster) params.set("cluster", focusCluster);
  else if (focusId) params.set("focus", focusId);
  const hash = `#${params.toString()}`;
  if (location.hash === hash) return;
  const url = `${location.pathname}${location.search}${hash}`;
  if (mode === "push") history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

function applyHash(): void {
  applyingHash = true;
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const scopeRaw = params.get("scope");
  const riskRaw = params.get("risk");
  const scope: Scope = isScope(scopeRaw) ? scopeRaw : "domestic";
  const risk: RiskLevel | undefined = isRisk(riskRaw) ? riskRaw : undefined;
  const sinceRaw = params.get("since");
  const sinceDays = sinceRaw && Number.isFinite(Number(sinceRaw)) ? Number(sinceRaw) : DEFAULT_SINCE_DAYS;
  focusCluster = params.get("cluster") || null;
  focusId = focusCluster ? null : params.get("focus") || null;
  setState({
    scope,
    category: params.get("category") || undefined,
    minRisk: risk,
    sinceDays,
    query: params.get("q") || undefined,
  });
  setActiveScopeTab(scope);
  renderFilterBar(document.getElementById("filterbar")!, scope);
  applyingHash = false;
}

function relationChip(ref: RelatedRef): { label: string; why: string } {
  const label = edgeTypeLabel(ref.type);
  return { label, why: ref.why.replace(new RegExp(`^${label}[:：]\\s*`), "") };
}

function byTimeDesc(a: IntelEvent, b: IntelEvent): number {
  return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
}

function riskFilterLabel(risk?: RiskLevel): string {
  if (risk === "medium") return "中以上";
  if (risk === "high") return "高以上";
  if (risk === "critical") return "僅危急";
  return "";
}

function renderFilterSummary(displayCount: number, totalCount: number, focusLabel = ""): void {
  const el = document.getElementById("filter-summary")!;
  const s = getState();
  const chips: string[] = [];
  chips.push(`<span class="filter-chip is-base">${s.scope === "domestic" ? "國內" : "國際"}</span>`);
  if (s.category) chips.push(`<button type="button" class="filter-chip" data-clear-filter="category">分類：${esc(s.category)} ✕</button>`);
  if (s.minRisk)
    chips.push(`<button type="button" class="filter-chip" data-clear-filter="risk">風險：${esc(riskFilterLabel(s.minRisk))} ✕</button>`);
  if (s.sinceDays)
    chips.push(`<button type="button" class="filter-chip" data-clear-filter="since">時間：近 ${s.sinceDays} 天 ✕</button>`);
  if (s.query) chips.push(`<button type="button" class="filter-chip" data-clear-filter="query">搜尋：${esc(s.query)} ✕</button>`);
  if (focusLabel) chips.push(`<button type="button" class="filter-chip is-focus" data-clear-filter="focus">焦點：${esc(focusLabel)} ✕</button>`);

  el.hidden = false;
  el.innerHTML = `
    <div class="filter-summary-main">
      <span class="filter-summary-label">目前視圖</span>
      <div class="filter-chips">${chips.join("")}</div>
      <span class="filter-summary-count">${displayCount} / ${totalCount} 則</span>
    </div>
    <button type="button" class="filter-clear-all" data-clear-filter="all">清除條件</button>`;
}

function renderFocusBar(events: IntelEvent[], net: NetworkIndex): void {
  const bar = document.getElementById("focusbar")!;
  if (!focusId && !focusCluster) {
    bar.hidden = true;
    bar.innerHTML = "";
    return;
  }
  let label = "";
  let count = events.length;
  if (focusCluster) {
    const c = net.cluster(focusCluster);
    label = `情報群：${esc(c?.representativeTitle || focusCluster)}`;
    count = c?.size ?? events.length;
  } else if (focusId) {
    const center = events.find((e) => e.id === focusId);
    label = `關聯網：${esc(center ? center.title : focusId)}`;
    count = net.count(focusId);
  }
  bar.hidden = false;
  bar.innerHTML = `<span class="focus-label">🔗 <strong>${label}</strong>（${count} 則）</span>
    <button type="button" id="clear-focus" class="clear-focus">✕ 返回全部</button>`;
  document.getElementById("clear-focus")!.onclick = () => {
    focusId = null;
    focusCluster = null;
    writeHash("push");
    void refresh();
  };
}

async function refresh(): Promise<void> {
  const s = getState();
  const eventList = document.getElementById("eventlist")!;
  // 事件與情報網兩支 fetch 並行（原本串行，第二支要等第一支完成才開始）。
  if (!cache[s.scope] || !netCache[s.scope]) {
    // 首載/切換 scope 時主資料尚未快取：顯示載入佔位（篩選變更走快取、不會閃爍）。
    if (!cache[s.scope]) eventList.innerHTML = `<p class="empty">情報載入中…</p>`;
    try {
      const [ev, net] = await Promise.all([
        cache[s.scope] ?? loadEvents(s.scope),
        netCache[s.scope] ?? loadNetwork(s.scope),
      ]);
      cache[s.scope] = ev;
      netCache[s.scope] = net;
    } catch (err) {
      // 主資料 fetch 失敗：無既有快取時顯示可重試錯誤卡，不留白、不中斷（不 throw）。
      if (!cache[s.scope]) {
        const msg = err instanceof Error ? err.message : String(err);
        eventList.innerHTML = `<div class="empty load-error">情報載入失敗（${esc(msg)}）<button type="button" id="retry-load" class="retry-load">重試</button></div>`;
        document.getElementById("retry-load")?.addEventListener("click", () => void refresh());
        return;
      }
      // 有舊快取則沿用，靜默續繪
    }
  }
  const all = cache[s.scope]!;
  const net = netCache[s.scope]!;
  const byId = new Map(all.map((e) => [e.id, e] as const));
  renderKpiStrip(document.getElementById("kpistrip")!, all, s.scope, () => setState({ minRisk: "high" }));
  const triageEvents = filterEvents(all, { scope: s.scope, sinceDays: s.sinceDays });
  const renderInbox = (): void => {
    renderTriageInbox(document.getElementById("triageinbox")!, triageEvents, {
      acked: triageAcked,
      sinceDays: s.sinceDays,
      onFocus: focusEvent,
      onAck: (id) => {
        triageAcked.add(id);
        saveTriageAcked(triageAcked);
        renderInbox();
      },
      onAckAll: () => {
        triageEvents.forEach((e) => {
          if (e.riskLevel === "critical" || e.riskLevel === "high") triageAcked.add(e.id);
        });
        saveTriageAcked(triageAcked);
        renderInbox();
      },
    });
  };
  renderInbox();

  let display: IntelEvent[];
  let listGroups: ReturnType<typeof collapseSameIncident> | null = null;
  let collapsedGroupCount = 0;
  const viewKey = focusCluster
    ? `cluster:${focusCluster}`
    : focusId
      ? `focus:${focusId}`
      : `list:${s.scope}:${s.category ?? ""}:${s.minRisk ?? ""}:${s.sinceDays ?? ""}:${s.query ?? ""}`;
  const relationById = new Map<string, { label: string; why: string }>();
  if (focusCluster && net.cluster(focusCluster)) {
    const members = new Set(net.cluster(focusCluster)!.members);
    display = all.filter((e) => members.has(e.id)).sort(byTimeDesc);
  } else if (focusId && all.some((e) => e.id === focusId)) {
    const order = new Map<string, number>([[focusId, Number.POSITIVE_INFINITY]]);
    for (const r of net.related(focusId)) {
      order.set(r.id, r.weight);
      relationById.set(r.id, relationChip(r));
    }
    display = all.filter((e) => order.has(e.id)).sort((a, b) => order.get(b.id)! - order.get(a.id)!);
  } else {
    focusId = null;
    focusCluster = null;
    display = applySearchSubnet(filterEvents(all, s), net, s.query);
    listGroups = collapseSameIncident(display, net);
    collapsedGroupCount = listGroups.filter((g) => g.members.length > 1 && g.sourceCount >= 2).length;
  }

  const emptyMessage = display.length === 0 ? emptyListHint(all, s, Date.now()) : null;
  let focusSummaryLabel = "";
  if (focusCluster) {
    const c = net.cluster(focusCluster);
    focusSummaryLabel = c?.representativeTitle || focusCluster;
  } else if (focusId) {
    focusSummaryLabel = byId.get(focusId)?.title || focusId;
  }

  renderEventList(eventList, listGroups ?? display, {
    relatedCount: (id) => net.count(id),
    relationOf: (id) => relationById.get(id),
    corroboration: (id) => corroborationOf(id, byId, net),
    ...(emptyMessage ? { emptyMessage } : {}),
  });
  // 聚焦時於清單上方畫關聯網圖：單一事件＝放射狀；情報群＝以核心成員展開（一般清單不畫）。
  if (focusId && all.some((e) => e.id === focusId)) {
    const center = byId.get(focusId)!;
    const neighbors = net
      .related(focusId)
      .map((r): RelationNode | null => {
        const ev = byId.get(r.id);
        return ev ? { event: ev, rel: r } : null;
      })
      .filter((n): n is RelationNode => n !== null);
    relationGraph.reset();
    relationGraph.draw({ center, neighbors, net, byId });
  } else if (focusCluster && net.cluster(focusCluster)) {
    const c = net.cluster(focusCluster)!;
    const memberIds = c.members.filter((id) => byId.has(id));
    const memberSet = new Set(memberIds);
    let hub = memberIds[0];
    let hubDeg = -1;
    for (const id of memberIds) {
      const d = net.count(id);
      if (d > hubDeg) {
        hubDeg = d;
        hub = id;
      }
    }
    const hubEvent = hub ? byId.get(hub) : undefined;
    if (hubEvent) {
      const neighbors = net
        .related(hub)
        .filter((r) => memberSet.has(r.id))
        .map((r): RelationNode | null => {
          const ev = byId.get(r.id);
          return ev ? { event: ev, rel: r } : null;
        })
        .filter((n): n is RelationNode => n !== null);
      const clusterAi = clusterSummariesForScope(summary, s.scope)[focusCluster];
      const head = `🕸 情報群網絡　<b>${c.size ?? memberIds.length}</b> 則 · 圖示核心成員的群內關聯${
        clusterAi ? `<span class="rg-ai-summary">🤖 ${esc(clusterAi)}</span>` : ""
      }`;
      relationGraph.reset();
      relationGraph.draw({ center: hubEvent, neighbors, net, byId, headHtml: head });
    } else {
      relationGraph.clear();
    }
  } else {
    relationGraph.clear();
  }
  if (viewKey !== lastViewKey) {
    resetEventListScroll(eventList);
    lastViewKey = viewKey;
  }
  renderFocusBar(display, net);
  renderFilterSummary(display.length, all.length, focusSummaryLabel);
  renderTopClusters(document.getElementById("topclusters")!, net.clusters(), clusterSummariesForScope(summary, s.scope));
  const mapKey = `${viewKey}:${display.length}:${display[0]?.id ?? ""}:${display[display.length - 1]?.id ?? ""}`;
  if (mapKey !== lastMapKey) {
    lastMapKey = mapKey;
    void mapView.render(display, s.scope, { fit: !focusId && !focusCluster });
  }
  renderTimeline(document.getElementById("timeline")!, display);
  renderAiBrief(document.getElementById("aibrief")!, summary, s.scope, display);
  document.getElementById("count")!.textContent = listGroups ? `${display.length} 則 · 收合 ${collapsedGroupCount} 組` : `${display.length}`;
}

function focusEvent(id: string): void {
  focusId = id;
  focusCluster = null;
  writeHash("push");
  void refresh().then(() => relationGraph.reveal());
}

function focusClusterById(id: string): void {
  focusCluster = id;
  focusId = null;
  writeHash("push");
  void refresh().then(() => relationGraph.reveal());
}

function renderUsageTip(): void {
  const tip = document.getElementById("usage-tip")!;
  if (localStorage.getItem(TIP_KEY)) return;
  tip.hidden = false;
  document.getElementById("close-tip")!.onclick = () => {
    localStorage.setItem(TIP_KEY, "1");
    tip.hidden = true;
  };
}

// 點「🔗 關聯 N」→ 聚焦該事件的關聯網（事件委派，列表重繪後仍有效）。
document.getElementById("eventlist")!.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>(".rel-link");
  if (!btn?.dataset.rel) return;
  focusEvent(btn.dataset.rel);
});

document.getElementById("filter-summary")!.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-clear-filter]");
  if (!btn?.dataset.clearFilter) return;
  const scope = getState().scope;
  switch (btn.dataset.clearFilter) {
    case "category":
      setState({ category: undefined });
      break;
    case "risk":
      setState({ minRisk: undefined });
      break;
    case "since":
      setState({ sinceDays: undefined });
      break;
    case "query":
      setState({ query: undefined });
      break;
    case "focus":
      focusId = null;
      focusCluster = null;
      writeHash("push");
      void refresh();
      break;
    case "all":
      focusId = null;
      focusCluster = null;
      setState({ category: undefined, minRisk: undefined, query: undefined, sinceDays: DEFAULT_SINCE_DAYS });
      break;
  }
  renderFilterBar(document.getElementById("filterbar")!, scope);
});

// 關聯網互動控制器：點節點預覽／前往、hover/tap 高亮、圖例篩選型別。
const relationGraph = createRelationGraphController({
  relGraphEl: document.getElementById("relationgraph")!,
  renderRelationGraph,
  onFocusEvent: focusEvent,
});

// 「/」鍵快速聚焦搜尋框（非輸入/選單狀態時）。
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "/" || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const tag = (document.activeElement as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  const q = document.getElementById("f-query") as HTMLInputElement | null;
  if (q) {
    ev.preventDefault();
    q.focus();
  }
});

document.getElementById("topclusters")!.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>(".cluster-link");
  if (!btn?.dataset.cluster) return;
  focusClusterById(btn.dataset.cluster);
});

document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((btn) => {
  btn.onclick = () => {
    const scope = btn.dataset.scope as Scope;
    focusId = null;
    focusCluster = null;
    setActiveScopeTab(scope);
    setState({ scope, category: undefined, minRisk: undefined, query: undefined, sinceDays: DEFAULT_SINCE_DAYS });
    renderFilterBar(document.getElementById("filterbar")!, scope);
  };
});

subscribe((s) => {
  const nextQuery = s.query ?? "";
  if (!applyingHash && nextQuery && nextQuery !== lastQuery) {
    focusId = null;
    focusCluster = null;
  }
  lastQuery = nextQuery;
  if (!applyingHash) writeHash("replace");
  void refresh();
  setActiveScopeTab(s.scope);
  // 桌面搜尋與手機快捷搜尋雙向同步（不覆蓋正在輸入的那個）。
  const qv = s.query ?? "";
  const mqEl = document.getElementById("mq-query") as HTMLInputElement | null;
  const fqEl = document.getElementById("f-query") as HTMLInputElement | null;
  if (mqEl && document.activeElement !== mqEl) mqEl.value = qv;
  if (fqEl && document.activeElement !== fqEl) fqEl.value = qv;
});

window.addEventListener("hashchange", () => {
  applyHash();
  void refresh();
});
window.addEventListener("popstate", () => {
  applyHash();
  void refresh();
});

applyHash();
renderUsageTip();
// 側欄警政健康面板只用尾端趨勢、且多在首屏摺線下：捲入視窗才抓 police-hourly-history.json（數 MB），
// 讓它離開首屏關鍵載入窗，不與 domestic 主資料搶頻寬（IntersectionObserver 不支援時退回立即渲染）。
{
  const policeHealthEl = document.getElementById("policehealth")!;
  const policeHealthSection = policeHealthEl.closest<HTMLDetailsElement>('[data-side-section="policehealth"]');
  let policeHealthRendered = false;
  const renderPoliceHealthOnce = (): void => {
    if (policeHealthRendered) return;
    policeHealthRendered = true;
    void renderPoliceHealthPanel(policeHealthEl);
  };
  policeHealthSection?.addEventListener("toggle", () => {
    if (policeHealthSection.open) renderPoliceHealthOnce();
  });
  if (policeHealthSection?.open) {
    renderPoliceHealthOnce();
  } else if (typeof IntersectionObserver === "undefined") {
    renderPoliceHealthOnce();
  } else {
    const io = new IntersectionObserver(
      (entries, obs) => {
        if (entries.some((e) => e.isIntersecting)) {
          obs.disconnect();
          renderPoliceHealthOnce();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(policeHealthSection ?? policeHealthEl);
  }
}
void renderSourcePanel(document.getElementById("sourcepanel")!);
// 資料新鮮度徽章（topbar）：吃已載入的 summary（含 generatedAt + model），免額外 fetch。
function renderDataFreshness(s: AiSummary | null): void {
  const el = document.getElementById("data-freshness");
  if (!el || !s?.generatedAt) return;
  const d = new Date(s.generatedAt);
  const when = d.toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const model = s.model ? ` · ${esc(s.model)}` : "";
  el.innerHTML = `<span class="df-dot" aria-hidden="true"></span>資料更新於 ${esc(when)}${model}`;
  el.title = `資料管線最後生成時間：${d.toLocaleString("zh-TW", { hour12: false })}`;
}

function renderStalenessBanner(generatedAt: string | undefined): void {
  const existing = document.querySelector<HTMLDivElement>(".stale-banner");
  const notice = stalenessNotice(generatedAt, Date.now());
  if (!notice) {
    existing?.remove();
    return;
  }
  const banner = existing ?? document.createElement("div");
  banner.className = "stale-banner";
  banner.setAttribute("role", "status");
  banner.innerHTML = `⚠️ ${esc(notice)}`;
  if (!existing) document.querySelector(".topbar")?.after(banner);
}

void loadSummary().then((s) => {
  summary = s;
  renderAiBrief(document.getElementById("aibrief")!, summary, getState().scope);
  renderDataFreshness(s);
  renderStalenessBanner(s?.generatedAt);
  // 摘要含 clusterSummaries → 重渲染一次讓 TopClusters/聚焦群標題帶上群摘要。
  void refresh();
});
void refresh();
setInterval(() => {
  void fetch("./data/summary.json")
    .then((res) => (res.ok ? (res.json() as Promise<AiSummary>) : null))
    .then((data) => {
      renderStalenessBanner(data?.generatedAt);
      if (!data?.generatedAt || data.generatedAt === lastGeneratedAt) return;
      lastGeneratedAt = data.generatedAt;
      const scope = getState().scope;
      delete cache[scope];
      delete netCache[scope];
      void refresh();
    })
    .catch(() => {});
}, REFRESH_MS);
