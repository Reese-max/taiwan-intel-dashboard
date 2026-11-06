import "./styles/global.css";
import { t } from "./i18n/zh-TW";
import { DEFAULT_SINCE_DAYS, getState, setState, subscribe } from "./store";
import { loadEvents, filterEvents, loadFirstPaintMapEvents, loadFirstPaintHeadEvents, explainOutOfFilter } from "./data/loader";
import { edgeTypeLabel, loadNetwork, NetworkIndex, type RelatedRef } from "./data/network";
import { renderEventList, resetEventListScroll } from "./components/EventList";
import { computeKpiKey, renderKpiStrip, invalidateProvenanceCache, cancelKpiRender } from "./components/KpiStrip";
import { renderRelationGraph, type RelationNode } from "./components/RelationGraph";
import { createRelationGraphController } from "./components/RelationGraphController";
import { esc } from "./utils/escape";
import { debounce } from "./utils/debounce";
import { safeStorage } from "./utils/storage";
import { syncFilterBar, CATS } from "./components/FilterBar";
import { renderTimeline } from "./components/TimelineView";
import { renderSourcePanel } from "./components/SourcePanel";
import { clusterSummariesForScope, loadSummary, renderAiBrief, type AiSummary } from "./components/AiBrief";
import { renderPoliceHealthPanel } from "./components/PoliceHealthPanel";
import { renderTopClusters } from "./components/TopClusters";
import { renderTriageInbox } from "./components/TriageInbox";
import { MapView, isMapDisplayable } from "./components/MapView";
import type { IntelEvent, NewsAuthority, RiskLevel, Scope } from "./types/event";
import { emptyListHint } from "./utils/emptyHint";
import { applySearchSubnet } from "./search";
import { filterTriageEvents, loadTriageAcked, saveTriageAcked, type TriageSortMode } from "./utils/triage";
import { corroborationOf } from "./utils/corroboration";
import { collapseSameIncident } from "./utils/collapse";
import { stalenessNotice } from "./utils/staleness";
import { loadManifest, createManifestLoader, scopeDataVersion, type CohortManifest } from "./data/manifest";

const REFRESH_MS = 300000;
const TIP_KEY = "taiwan-intel-link-tip-dismissed";
const COMPACT_LAYOUT_KEY = "taiwan-intel-compact-layout";
const SIDE_PANEL_STATE_KEY = "taiwan-intel-side-panel-state";
const MOBILE_VIEW_KEY = "taiwan-intel-mobile-view";
const MOBILE_LAYOUT_QUERY = "(max-width: 640px), (max-width: 932px) and (max-height: 500px)";

let cohortManifest: CohortManifest | null = null;
// 啟動期 first-paint 與 refresh 共用同一次 manifest 抓取（settled 後不留存，重試仍可重抓）。
const fetchManifestOnce = createManifestLoader();
let refreshRequestId = 0;
const netAutoRetried: Record<string, number> = {};
const manifestAutoRetried: Record<string, number> = {};
// 記錄各 scope 快取事件是用哪一份 manifest 驗證的（null = 未驗證的獨立新聞備援）。
// 關聯單獨重試只能沿用同一份 manifest；全域 cohortManifest 升版後不得拿新版關聯硬拼舊版事件。
const cohortByScope: Partial<Record<Scope, CohortManifest | null>> = {};
const invalidateSidePanels: (() => void)[] = [];
let provenanceVersion = "";

function snapshotLoaded(manifest: CohortManifest | null): void {
  if (!manifest) return;
  const version = JSON.stringify([manifest.snapshotId, manifest.files]);
  if (version === provenanceVersion) return;
  provenanceVersion = version;
  invalidateProvenanceCache();
  lastKpiKey = "";
  invalidateSidePanels.forEach((invalidate) => invalidate());
}

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
  <div class="mobile-searchbar">
    <div class="search-box">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="16.5" y1="16.5" x2="21" y2="21"></line></svg>
      <input id="mq-query" type="search" aria-label="搜尋情報" placeholder="搜尋情報…">
    </div>
  </div>
  <section id="filter-panel" class="filter-panel" aria-label="情報篩選">
    <button type="button" class="filter-scrim" aria-label="關閉篩選" tabindex="-1"></button>
    <div class="filter-surface">
      <header class="filter-sheet-head">
        <div>
          <strong id="filter-sheet-title">篩選情報</strong>
          <span>調整分類、來源、風險與時間</span>
        </div>
        <button id="filter-sheet-close" type="button" aria-label="關閉篩選">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>
        </button>
      </header>
      <div id="filterbar" class="filterbar"></div>
      <button id="filter-sheet-done" class="filter-sheet-done" type="button">套用篩選</button>
    </div>
  </section>
  <div id="filter-summary" class="filter-summary" hidden></div>
  <section id="kpistrip" class="kpi-strip" aria-label="關鍵指標"></section>
  <main class="layout">
    <section class="col-map">
      <h2>${t.map}</h2>
      <div id="map" class="map"></div>
      <p id="map-focus-notice" role="status" hidden></p>
      <h2>${t.timeline}</h2>
      <div id="timeline"></div>
    </section>
    <section class="col-list">
      <h2>${t.events} <span id="count" class="count-pill"></span></h2>
      <div id="triageinbox" class="triage-inbox"></div>
      <div id="focusbar" class="focusbar" hidden></div>
      <div id="relation-notice" class="relation-notice" role="status" aria-live="polite" hidden></div>
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
  <nav class="mobile-tabbar" aria-label="主要視圖">
    <button type="button" data-mobile-view="list" aria-label="列表視圖">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="8" y1="6" x2="20" y2="6"></line><line x1="8" y1="12" x2="20" y2="12"></line><line x1="8" y1="18" x2="20" y2="18"></line><circle cx="4" cy="6" r="1"></circle><circle cx="4" cy="12" r="1"></circle><circle cx="4" cy="18" r="1"></circle></svg>
      <span>列表</span>
    </button>
    <button type="button" data-mobile-view="map" aria-label="地圖視圖">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6"></polygon><line x1="9" y1="3" x2="9" y2="18"></line><line x1="15" y1="6" x2="15" y2="21"></line></svg>
      <span>地圖</span>
    </button>
    <button type="button" data-mobile-view="insights" aria-label="重點視圖">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="19" x2="5" y2="12"></line><line x1="12" y1="19" x2="12" y2="5"></line><line x1="19" y1="19" x2="19" y2="9"></line></svg>
      <span>重點</span>
    </button>
    <button id="mobile-filter-trigger" type="button" aria-label="開啟篩選" aria-controls="filter-panel" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6"></line><circle cx="9" cy="6" r="2"></circle><line x1="4" y1="12" x2="20" y2="12"></line><circle cx="15" cy="12" r="2"></circle><line x1="4" y1="18" x2="20" y2="18"></line><circle cx="11" cy="18" r="2"></circle></svg>
      <span>篩選</span><span id="mobile-filter-count" class="mobile-filter-count" hidden></span>
    </button>
  </nav>`;

const mobileMedia = window.matchMedia(MOBILE_LAYOUT_QUERY);

function revealListFromMapHint(): void {
  if (mobileMedia.matches) {
    setMobileView("list", { scroll: true });
    return;
  }
  document.querySelector<HTMLElement>(".col-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const mapView = new MapView(document.getElementById("map")!, {
  onFocus: focusEvent,
  onShowList: revealListFromMapHint,
});

// 手機搜尋同步寫入 store；底部導覽沿用既有三種視圖狀態。
const mqQuery = document.getElementById("mq-query") as HTMLInputElement | null;
const compactToggle = document.getElementById("compact-layout-toggle") as HTMLButtonElement | null;
const filterPanel = document.getElementById("filter-panel") as HTMLElement | null;
const filterSurface = filterPanel?.querySelector<HTMLElement>(".filter-surface") ?? null;
const mobileFilterTrigger = document.getElementById("mobile-filter-trigger") as HTMLButtonElement | null;
let lastFilterTrigger: HTMLElement | null = null;
type MobileView = "map" | "list" | "insights";

function setMobileFilters(open: boolean, restoreFocus = true): void {
  if (!filterPanel) return;
  const wasOpen = filterPanel.classList.contains("is-open");
  const nextOpen = mobileMedia.matches && open;
  filterPanel.classList.toggle("is-open", nextOpen);
  filterPanel.setAttribute("aria-hidden", String(mobileMedia.matches && !nextOpen));
  for (const sibling of Array.from(filterPanel.parentElement?.children ?? [])) {
    if (sibling instanceof HTMLElement && sibling !== filterPanel) sibling.inert = nextOpen;
  }
  filterSurface?.toggleAttribute("role", nextOpen);
  if (nextOpen) {
    filterSurface?.setAttribute("role", "dialog");
    filterSurface?.setAttribute("aria-modal", "true");
    filterSurface?.setAttribute("aria-labelledby", "filter-sheet-title");
  } else {
    filterSurface?.removeAttribute("aria-modal");
    filterSurface?.removeAttribute("aria-labelledby");
  }
  document.body.classList.toggle("mobile-filter-open", nextOpen);
  mobileFilterTrigger?.setAttribute("aria-expanded", String(nextOpen));
  mobileFilterTrigger?.classList.toggle("active", nextOpen);
  if (nextOpen) {
    window.requestAnimationFrame(() => document.getElementById("filter-sheet-close")?.focus());
  } else if (wasOpen && restoreFocus) {
    lastFilterTrigger?.focus();
  }
}

function syncMobileShell(): void {
  if (mobileMedia.matches) {
    setMobileFilters(filterPanel?.classList.contains("is-open") ?? false, false);
    return;
  }
  setMobileFilters(false, false);
  filterPanel?.setAttribute("aria-hidden", "false");
  filterSurface?.removeAttribute("role");
}

function isMobileView(value: string | null | undefined): value is MobileView {
  return value === "map" || value === "list" || value === "insights";
}

function mobileViewTarget(view: MobileView): HTMLElement | null {
  if (view === "map") return document.querySelector<HTMLElement>(".col-map");
  if (view === "list") return document.querySelector<HTMLElement>(".col-list");
  return document.getElementById("kpistrip");
}

function setMobileView(view: MobileView, options: { scroll?: boolean; reveal?: boolean } = {}): void {
  setMobileFilters(false, false);
  document.body.classList.toggle("mobile-view-map", view === "map");
  document.body.classList.toggle("mobile-view-list", view === "list");
  document.body.classList.toggle("mobile-view-insights", view === "insights");
  document.querySelectorAll<HTMLButtonElement>("[data-mobile-view]").forEach((btn) => {
    const active = btn.dataset.mobileView === view;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
  try {
    safeStorage.setItem(MOBILE_VIEW_KEY, view);
  } catch {
    // localStorage 不可用時略過保存
  }
  if (view === "map" && !options.scroll && options.reveal !== false) void mapView.reveal().catch(() => {});
  else if (view !== "map") void mapView.closePopup().catch(() => {});
  if (options.scroll) {
    window.requestAnimationFrame(() => {
      const target = mobileViewTarget(view);
      if (view !== "map") {
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      const root = document.documentElement;
      const previousScrollBehavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      target?.scrollIntoView({ behavior: "auto", block: "start" });
      window.requestAnimationFrame(() => {
        root.style.scrollBehavior = previousScrollBehavior;
        void mapView.reveal().catch(() => {});
      });
    });
  }
}

function currentMobileView(): MobileView {
  if (document.body.classList.contains("mobile-view-map")) return "map";
  if (document.body.classList.contains("mobile-view-insights")) return "insights";
  return "list";
}

function revealScopeChangeOnMobile(): void {
  if (!mobileMedia.matches) return;
  const view = currentMobileView();
  setMobileView(view === "insights" ? "list" : view, { scroll: true });
}

function initMobileView(): void {
  let view: MobileView = "list";
  try {
    const saved = safeStorage.getItem(MOBILE_VIEW_KEY);
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

function showFocusedListOnMobile(): void {
  if (!mobileMedia.matches) return;
  setMobileView("list");
}

function revealListFallbackOnMobile(): void {
  if (!mobileMedia.matches) return;
  window.requestAnimationFrame(() => {
    mobileViewTarget("list")?.scrollIntoView({ behavior: "auto", block: "start" });
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
    if (enabled) safeStorage.setItem(COMPACT_LAYOUT_KEY, "1");
    else safeStorage.removeItem(COMPACT_LAYOUT_KEY);
  } catch {
    // localStorage 可能不可用時，僅保持目前畫面狀態，不中斷操作
  }
  void mapView.resize().catch(() => {});
}

let compactMode = false;
try {
  compactMode = safeStorage.getItem(COMPACT_LAYOUT_KEY) === "1";
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
    const raw = safeStorage.getItem(SIDE_PANEL_STATE_KEY);
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
    safeStorage.setItem(SIDE_PANEL_STATE_KEY, JSON.stringify(state));
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
syncMobileShell();

if (mqQuery)
  mqQuery.oninput = debounce((ev: unknown) => {
    const input = (ev as Event).target as HTMLInputElement;
    setState({ query: input.value.trim() || undefined });
  }, 200);

window.addEventListener(
  "resize",
  debounce(() => {
    void mapView.resize();
    syncMobileShell();
  }, 150),
);
if (mobileFilterTrigger)
  mobileFilterTrigger.onclick = () => {
    lastFilterTrigger = mobileFilterTrigger;
    setMobileFilters(true);
  };
filterSurface?.addEventListener("keydown", (event) => {
  if (event.key !== "Tab" || !filterPanel?.classList.contains("is-open")) return;
  const focusable = Array.from(
    filterSurface.querySelectorAll<HTMLElement>(
      'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getClientRects().length > 0);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
document.querySelector<HTMLButtonElement>(".filter-scrim")?.addEventListener("click", () => setMobileFilters(false));
document.getElementById("filter-sheet-close")?.addEventListener("click", () => setMobileFilters(false));
document.getElementById("filter-sheet-done")?.addEventListener("click", () => setMobileFilters(false));
const cache: Partial<Record<Scope, IntelEvent[]>> = {};
const netCache: Partial<Record<Scope, NetworkIndex>> = {};
const headCache: Partial<Record<Scope, IntelEvent[]>> = {};
const isHeadActive: Partial<Record<Scope, boolean>> = {};
type CohortPair = [IntelEvent[], NetworkIndex];
const cohortPairInflight: Partial<Record<Scope, { key: string; promise: Promise<CohortPair> }>> = {};

function fetchCohortPair(scope: Scope, manifest: CohortManifest | null): Promise<CohortPair> {
  const manifestEvents = manifest?.scopes?.[scope]?.events;
  const eventsPath = manifestEvents ? `./data/${manifestEvents}` : `./data/${scope}.json`;
  const expectedEventsHash =
    manifest?.files?.[manifestEvents || ""]?.sha256 || manifest?.scopes?.[scope]?.sha256;
  const manifestNetwork = manifest?.scopes?.[scope]?.network;
  const networkPath = manifestNetwork ? `./data/${manifestNetwork}` : "./data/network.json";
  const expectedNetworkHash = manifest?.files?.[manifestNetwork || "network.json"]?.sha256;
  const key = JSON.stringify({ scope, snapshotId: manifest?.snapshotId ?? null, eventsPath, expectedEventsHash, networkPath, expectedNetworkHash });
  const existing = cohortPairInflight[scope];
  if (existing?.key === key) return existing.promise;

  // 完整 pair 的快取由 refresh 使用；重載時兩份都須依本次 manifest 驗證。
  const promise: Promise<CohortPair> = Promise.all([
    loadEvents(scope, { manifest }),
    loadNetwork(scope, { manifest }),
  ]);
  const entry = { key, promise };
  cohortPairInflight[scope] = entry;
  void promise.then(
    () => {
      if (cohortPairInflight[scope] === entry) delete cohortPairInflight[scope];
    },
    () => {
      if (cohortPairInflight[scope] === entry) delete cohortPairInflight[scope];
    },
  );
  return promise;
}

const triageAcked = loadTriageAcked();
let triageStorageOk = safeStorage.isAvailable();
let triageSortMode: TriageSortMode = "default";
let summary: AiSummary | null = null;
// 情報網聚焦：可選單一事件，或選一個 cluster 展開整群。
let focusId: string | null = null;
let focusCluster: string | null = null;
let missingFocus = false;
let showOutOfFilterRelated = false;
let applyingHash = false;
let lastQuery = "";
let lastViewKey = "";
let lastMapKey = "";
let lastMapViewKey = "";
let lastKpiKey = "";
let lastTopClustersNet: NetworkIndex | null = null;
let lastTopClustersScope: Scope | null = null;
let lastTopClustersSummary: AiSummary | null = null;
let lastDisplayedEvents: IntelEvent[] = [];
let lastDisplayedScope: Scope | null = null;
let lastGeneratedAt: string | null = null;

function renderTopClustersIfChanged(net: NetworkIndex, scope: Scope): void {
  if (net === lastTopClustersNet && scope === lastTopClustersScope && summary === lastTopClustersSummary) return;
  lastTopClustersNet = net;
  lastTopClustersScope = scope;
  lastTopClustersSummary = summary;
  renderTopClusters(document.getElementById("topclusters")!, net.clusters(), clusterSummariesForScope(summary, scope, net.generatedAt ?? "", net.clusters()), 3,
    { netState: net.state, netError: net.error });
}

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

function isNewsAuthority(v: string | null): v is NewsAuthority {
  return v === "official" || v === "media";
}

function writeHash(mode: "replace" | "push" = "replace"): void {
  if (applyingHash) return;
  const s = getState();
  const params = new URLSearchParams();
  params.set("scope", s.scope);
  if (s.category) params.set("category", s.category);
  if (s.region) params.set("region", s.region);
  if (s.minRisk) params.set("risk", s.minRisk);
  if (s.newsAuthority) params.set("news", s.newsAuthority);
  params.set("since", s.sinceDays == null ? "all" : String(s.sinceDays));
  if (s.day) params.set("day", s.day);
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
  missingFocus = false;
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const scopeRaw = params.get("scope");
  const riskRaw = params.get("risk");
  const newsRaw = params.get("news");
  const scope: Scope = isScope(scopeRaw) ? scopeRaw : "domestic";
  const risk: RiskLevel | undefined = isRisk(riskRaw) ? riskRaw : undefined;
  const sinceRaw = params.get("since");
  const sinceDays = sinceRaw === "all" ? undefined : sinceRaw && Number.isFinite(Number(sinceRaw)) && Number(sinceRaw) > 0 ? Number(sinceRaw) : DEFAULT_SINCE_DAYS;
  const category = params.get("category");
  const dayRaw = params.get("day") ?? "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayRaw) && Number.isFinite(Date.parse(dayRaw)) && new Date(dayRaw).toISOString().slice(0, 10) === dayRaw ? dayRaw : undefined;
  focusCluster = params.get("cluster") || null;
  focusId = focusCluster ? null : params.get("focus") || null;
  setState({
    scope,
    category: category && CATS[scope].includes(category) ? category : undefined,
    region: params.get("region") || undefined,
    minRisk: risk,
    newsAuthority: scope === "domestic" && isNewsAuthority(newsRaw) ? newsRaw : undefined,
    sinceDays,
    day,
    query: params.get("q") || undefined,
  });
  setActiveScopeTab(scope);
  syncFilterBar(document.getElementById("filterbar")!, getState(), cache[scope] ?? []);
  applyingHash = false;
  writeHash();
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

function renderFilterSummary(displayCount: number, totalCount: number, focusLabel = "", isLoadingHead = false): void {
  const el = document.getElementById("filter-summary")!;
  const s = getState();
  const chips: string[] = [];
  chips.push(`<span class="filter-chip is-base">${s.scope === "domestic" ? "國內" : "國際"}</span>`);
  if (s.category) chips.push(`<button type="button" class="filter-chip" data-clear-filter="category">分類：${esc(s.category)} ✕</button>`);
  if (s.region) chips.push(`<button type="button" class="filter-chip" data-clear-filter="region">地區：${esc(s.region)} ✕</button>`);
  if (s.newsAuthority)
    chips.push(`<button type="button" class="filter-chip" data-clear-filter="newsAuthority">來源：${s.newsAuthority === "official" ? "官方警政新聞" : "媒體警政新聞"} ✕</button>`);
  if (s.minRisk)
    chips.push(`<button type="button" class="filter-chip" data-clear-filter="risk">風險：${esc(riskFilterLabel(s.minRisk))} ✕</button>`);
  if (s.sinceDays)
    chips.push(`<button type="button" class="filter-chip" data-clear-filter="since">時間：近 ${s.sinceDays} 天（${s.sinceDays * 24}h） ✕</button>`);
  if (s.day) chips.push(`<button type="button" class="filter-chip" data-clear-filter="day">日期：${esc(s.day)} ✕</button>`);
  if (s.query) chips.push(`<button type="button" class="filter-chip" data-clear-filter="query">搜尋：${esc(s.query)} ✕</button>`);
  if (focusLabel) chips.push(`<button type="button" class="filter-chip is-focus" data-clear-filter="focus">焦點：${esc(focusLabel)} ✕</button>`);

  const activeFilterCount =
    Number(Boolean(s.category)) +
    Number(Boolean(s.region)) +
    Number(Boolean(s.newsAuthority)) +
    Number(Boolean(s.minRisk)) +
    Number(Boolean(s.sinceDays)) +
    Number(Boolean(s.day)) +
    Number(Boolean(s.query));
  const mobileCount = document.getElementById("mobile-filter-count");
  if (mobileCount) {
    mobileCount.textContent = String(activeFilterCount);
    mobileCount.hidden = activeFilterCount === 0;
  }

  const countText = isLoadingHead
    ? `${displayCount} / ${totalCount} 則（載入中…）`
    : `${displayCount} / ${totalCount} 則`;

  el.hidden = false;
  el.innerHTML = `
    <div class="filter-summary-main">
      <span class="filter-summary-label">目前視圖</span>
      <div class="filter-chips">${chips.join("")}</div>
      <span class="filter-summary-count">${countText}</span>
    </div>
    <button type="button" class="filter-clear-all" data-clear-filter="all">清除條件</button>`;
}

function toggleElevatedRisk(): void {
  setState({ minRisk: getState().minRisk === "high" ? undefined : "high" });
}

function renderHeadFirstPaint(scope: Scope, headEvents: IntelEvent[]): void {
  if (cache[scope] || getState().scope !== scope) return;
  const s = getState();
  const eventListEl = document.getElementById("eventlist");
  if (!eventListEl) return;

  const display = filterEvents(headEvents, s);
  const totalCount = cohortManifest?.scopes?.[scope]?.eventCount ?? headEvents.length;

  renderEventList(eventListEl, display, {
    relatedCount: () => 0,
  });
  renderKpiStrip(document.getElementById("kpistrip")!, headEvents, scope, toggleElevatedRisk);
  renderTimeline(document.getElementById("timeline")!, display);
  const countEl = document.getElementById("count");
  if (countEl) {
    countEl.textContent = typeof totalCount === "number" && totalCount > 0
      ? `${display.length} / ${totalCount} 則（載入中…）`
      : `${display.length} 則（載入中…）`;
  }
  renderFilterSummary(display.length, totalCount, undefined, true);
}

interface FocusBarDetails {
  centerOutOfFilterReasons?: string[];
  inFilterCount?: number;
  outFilterCount?: number;
}

function renderFocusBar(events: IntelEvent[], net: NetworkIndex, details?: FocusBarDetails): void {
  const bar = document.getElementById("focusbar")!;
  if (missingFocus) {
    bar.hidden = false;
    bar.innerHTML = `<p role="status">此事件不在目前快照或時間範圍內</p><button type="button" id="clear-focus">返回清單</button>`;
    document.getElementById("clear-focus")!.onclick = () => {
      missingFocus = false;
      void refresh();
    };
    return;
  }
  if (!focusId && !focusCluster) {
    bar.hidden = true;
    bar.innerHTML = "";
    return;
  }
  let label = "";
  let count = events.length;
  let statusSuffix = "";
  if (net.state === "error") {
    statusSuffix = " · 關聯載入失敗";
  } else if (net.state === "stale") {
    statusSuffix = " · 快照備援中";
  }
  if (focusCluster) {
    const c = net.cluster(focusCluster);
    label = `情報群：${esc(c?.representativeTitle || focusCluster)}`;
    count = c?.size ?? events.length;
  } else if (focusId) {
    const center = events.find((e) => e.id === focusId);
    label = `關聯網：${esc(center ? center.title : focusId)}`;
    count = net.count(focusId);
  }

  let extraHtml = "";
  if (focusId && !isMapDisplayable(events.find((e) => e.id === focusId)!)) {
    extraHtml += `<p class="focus-notice-warn focus-coordinate-notice" role="status">此事件沒有可標示的座標</p>`;
  }
  if (focusCluster && events.length === 0) {
    extraHtml += `<p role="status">此情報群沒有符合目前篩選條件的事件。 <button type="button" id="clear-cluster-filters">清除篩選</button></p>`;
  }
  if (details?.centerOutOfFilterReasons && details.centerOutOfFilterReasons.length > 0) {
    extraHtml += `<div class="focus-notice-warn">⚠️ 中心事件超出目前篩選條件（${esc(details.centerOutOfFilterReasons.join("、"))}），保留作為關聯核心</div>`;
  }
  if (focusId && typeof details?.outFilterCount === "number" && details.outFilterCount > 0) {
    const inCount = details.inFilterCount ?? 0;
    const outCount = details.outFilterCount;
    extraHtml += `<div class="focus-related-split">
      <span class="focus-split-text">篩選內相關報導：${inCount} 則 ｜ 篩選外相關報導：${outCount} 則</span>
      <button type="button" id="toggle-out-filter-btn" class="toggle-out-filter-btn">
        ${showOutOfFilterRelated ? "收合篩選外相關報導" : `展開篩選外相關報導（+${outCount} 則）`}
      </button>
    </div>`;
  }

  bar.hidden = false;
  bar.innerHTML = `
    <div class="focus-header-row">
      <span class="focus-label">🔗 <strong>${label}</strong>（${count} 則${statusSuffix}）</span>
      <button type="button" id="clear-focus" class="clear-focus">✕ 返回全部</button>
    </div>
    ${extraHtml}`;

  document.getElementById("clear-focus")!.onclick = () => {
    focusId = null;
    focusCluster = null;
    showOutOfFilterRelated = false;
    writeHash("push");
    void refresh();
  };
  document.getElementById("clear-cluster-filters")?.addEventListener("click", () => {
    setState({ category: undefined, region: undefined, minRisk: undefined, source: undefined,
      newsAuthority: undefined, query: undefined, sinceDays: undefined, day: undefined });
  });
  const toggleBtn = document.getElementById("toggle-out-filter-btn");
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      showOutOfFilterRelated = !showOutOfFilterRelated;
      void refresh();
    };
  }
}

async function refresh(): Promise<void> {
  const requestId = ++refreshRequestId;
  const s = getState();
  const eventList = document.getElementById("eventlist")!;
  const relationNoticeEl = document.getElementById("relation-notice");

  // 同步載入小型靜態 manifest（僅首載或重新整理時），鎖定同版快照；
  // 與地圖 first-paint 共用同一次 inflight 抓取，避免開機重複請求。
  if (!cohortManifest) {
    const manifest = await fetchManifestOnce();
    if (requestId !== refreshRequestId) return;
    cohortManifest = manifest;
  }

  // 事件與情報網兩支 fetch 並行（原本串行，第二支要等第一支完成才開始）。
  if (!cache[s.scope] || !netCache[s.scope] || scopeDataVersion(cohortByScope[s.scope], s.scope) !== scopeDataVersion(cohortManifest, s.scope)) {
    // 首載/切換 scope 時主資料尚未快取：若已由 head first-paint 先行繪出則不留白閃爍。
    if (!cache[s.scope] && !headCache[s.scope]) eventList.innerHTML = `<p class="empty">情報載入中…</p>`;
    else if (!cache[s.scope] && headCache[s.scope]) {
      renderHeadFirstPaint(s.scope, headCache[s.scope]!);
    }
    try {
      let verifiedBy: CohortManifest | null = cohortManifest;
      let [ev, net] = await fetchCohortPair(s.scope, cohortManifest);
      if (requestId !== refreshRequestId) return;

      // 快照版本不符，或本次根本沒有 manifest 可用：各允許一次有界重讀 manifest
      // （跨部署暫態：manifest 晚幾秒才上線、或舊頁面撞上新版產物）。
      const isMismatch = net.error && /不符|缺少快照版本/i.test(net.error);
      if ((isMismatch || !cohortManifest) && (manifestAutoRetried[s.scope] ?? 0) < 1) {
        manifestAutoRetried[s.scope] = 1;
        const refreshedManifest = await loadManifest();
        if (requestId !== refreshRequestId) return;
        if (refreshedManifest) {
          try {
            const pair = await fetchCohortPair(s.scope, refreshedManifest);
            if (requestId !== refreshRequestId) return;
            [ev, net] = pair;
            // 事件驗證完成才換鎖；失敗後的關聯重試仍須使用舊事件的 manifest。
            cohortManifest = refreshedManifest;
            verifiedBy = refreshedManifest;
          } catch {
            // 保持現狀
          }
        }
      }
      if (requestId !== refreshRequestId) return;

      if (net.error && /不符|缺少快照版本/i.test(net.error)) {
        if (cache[s.scope] && netCache[s.scope] && netCache[s.scope]?.state !== "error") {
          // 保留先前一致快取
        } else {
          cache[s.scope] = ev;
          cohortByScope[s.scope] = verifiedBy;
          netCache[s.scope] = NetworkIndex.createError(
            "情報網與事件快照版本不一致，已停用關聯網以維護資料正確性",
            { snapshotId: cohortManifest?.snapshotId },
          );
        }
      } else {
        delete headCache[s.scope];
        delete isHeadActive[s.scope];
        cache[s.scope] = ev;
        cohortByScope[s.scope] = verifiedBy;
        netCache[s.scope] = net;
        // 有界重讀／重試以「每次失敗至多一次」計：驗證成功即歸還額度，
        // 但同一次 refresh 不會重複觸發（失敗時額度已先扣除）。
        manifestAutoRetried[s.scope] = 0;
      }
    } catch (err) {
      if (requestId !== refreshRequestId) return;
      const isHashMismatch = err instanceof Error && /SHA-256 不符/i.test(err.message);
      if (isHashMismatch && (manifestAutoRetried[s.scope] ?? 0) < 1) {
        manifestAutoRetried[s.scope] = 1;
        const refreshedManifest = await loadManifest();
        if (requestId !== refreshRequestId) return;
        if (refreshedManifest) {
          try {
            const [ev, net] = await fetchCohortPair(s.scope, refreshedManifest);
            if (requestId !== refreshRequestId) return;
            cohortManifest = refreshedManifest;
            delete headCache[s.scope];
            delete isHeadActive[s.scope];
            cache[s.scope] = ev;
            cohortByScope[s.scope] = refreshedManifest;
            netCache[s.scope] = net;
            manifestAutoRetried[s.scope] = 0;
          } catch {
            // 仍失敗
          }
        }
      }
      if (requestId !== refreshRequestId) return;

      // 主資料 fetch 失敗：無既有快取時顯示可重試錯誤卡，不留白、不中斷（不 throw）。
      if (!cache[s.scope]) {
        delete headCache[s.scope];
        delete isHeadActive[s.scope];
        // 切換失敗時清除前一範圍的畫面與渲染快取；切回原範圍仍需完整重繪。
        lastMapKey = lastMapViewKey = lastKpiKey = "";
        lastTopClustersNet = null;
        lastDisplayedEvents = [];
        lastDisplayedScope = s.scope;
        cancelKpiRender(document.getElementById("kpistrip")!);
        relationGraph.clear();
        void mapView.render([], s.scope, { closePopup: true });
        for (const id of ["kpistrip", "topclusters", "aibrief", "timeline", "triageinbox"]) {
          document.getElementById(id)!.innerHTML = '<p class="empty" role="status">情報載入失敗，請重試。</p>';
        }
        for (const id of ["focusbar", "map-focus-notice", "relation-notice"]) {
          const el = document.getElementById(id)!;
          el.hidden = true;
          el.innerHTML = "";
        }
        const countEl = document.getElementById("count");
        if (countEl) countEl.textContent = "";
        const filterSummaryEl = document.getElementById("filter-summary");
        if (filterSummaryEl) filterSummaryEl.hidden = true;
        const msg = err instanceof Error ? err.message : String(err);
        eventList.innerHTML = `<div class="empty load-error">情報載入失敗（${esc(msg)}）<button type="button" id="retry-load" class="retry-load">重試</button></div>`;
        document.getElementById("retry-load")?.addEventListener("click", () => {
          cohortManifest = null;
          manifestAutoRetried[s.scope] = 0;
          void refresh();
        });
        return;
      }
      // 有舊快取則沿用，靜默續繪
      if (!netCache[s.scope]) {
        netCache[s.scope] = NetworkIndex.createError("事件快照更新失敗，已停用關聯並保留先前新聞");
        // 舊事件尚未通過目前 manifest 驗證；後續篩選也不能單獨晉級新版關聯。
        netAutoRetried[s.scope] = 1;
      }
    }
  }

  // 若關聯發生錯誤，至多允許一次自動有界重試，不無限迴圈。
  // 只能用「驗證目前這批事件的同一份 manifest」重試：全域 manifest 升版後
  // 不得拿新版關聯硬拼舊版事件；事件未驗證（null）時重試必然失敗，直接略過。
  const verifiedManifest = cohortByScope[s.scope];
  if (netCache[s.scope]?.state === "error" && verifiedManifest && (netAutoRetried[s.scope] ?? 0) < 1) {
    netAutoRetried[s.scope] = 1;
    try {
      const retriedNet = await loadNetwork(s.scope, {
        manifest: verifiedManifest,
      });
      if (requestId !== refreshRequestId) return;
      netCache[s.scope] = retriedNet;
      if (retriedNet.state !== "error") netAutoRetried[s.scope] = 0;
    } catch {
      // 保持 error 狀態，等待使用者手動重試
    }
  }

  if (requestId !== refreshRequestId) return;
  const all = cache[s.scope]!;
  const net = netCache[s.scope]!;
  snapshotLoaded(cohortByScope[s.scope] ?? null);
  syncFilterBar(document.getElementById("filterbar")!, s, all);
  const byId = new Map(all.map((e) => [e.id, e] as const));
  if (focusId && !byId.has(focusId)) {
    missingFocus = true;
    focusId = null;
    writeHash();
  }
  if (focusId && s.sinceDays && filterEvents([byId.get(focusId)!], { sinceDays: s.sinceDays }).length === 0) {
    setState({ sinceDays: undefined });
    return;
  }
  const mapFocusNotice = document.getElementById("map-focus-notice")!;
  const noFocusCoordinates = !!focusId && !isMapDisplayable(byId.get(focusId)!);
  mapFocusNotice.hidden = !noFocusCoordinates;
  mapFocusNotice.textContent = noFocusCoordinates ? "此事件沒有可標示的座標" : "";
  const dataVersion = scopeDataVersion(cohortByScope[s.scope], s.scope);
  const kpiKey = `${dataVersion}:${computeKpiKey(s.scope, all)}`;
  if (kpiKey !== lastKpiKey) {
    lastKpiKey = kpiKey;
    renderKpiStrip(document.getElementById("kpistrip")!, all, s.scope, toggleElevatedRisk);
  }
  const triageEvents = filterTriageEvents(all, s, net);
  const renderInbox = (): void => {
    renderTriageInbox(document.getElementById("triageinbox")!, triageEvents, {
      acked: triageAcked,
      sinceDays: s.sinceDays,
      sortMode: triageSortMode,
      storageOk: triageStorageOk,
      onSortModeChange: (mode) => {
        triageSortMode = mode;
        renderInbox();
      },
      onFocus: focusEvent,
      onAck: (id) => {
        triageAcked.add(id);
        const res = saveTriageAcked(triageAcked);
        if (!res.ok) triageStorageOk = false;
        renderInbox();
      },
      onAckAll: () => {
        triageEvents.forEach((e) => {
          if (e.riskLevel === "critical" || e.riskLevel === "high") triageAcked.add(e.id);
        });
        const res = saveTriageAcked(triageAcked);
        if (!res.ok) triageStorageOk = false;
        renderInbox();
      },
    });
  };
  renderInbox();

  let display: IntelEvent[];
  let listGroups: ReturnType<typeof collapseSameIncident> | null = null;
  let collapsedGroupCount = 0;
  let focusBarDetails: FocusBarDetails | undefined;
  const filterKey = JSON.stringify(s);
  const viewKey = filterKey + (missingFocus ? ":missing-focus" : focusCluster
    ? `cluster:${focusCluster}`
    : focusId
      ? `focus:${focusId}:${showOutOfFilterRelated ? "all" : "in"}`
      : "list");
  const relationById = new Map<string, { label: string; why: string }>();
  if (missingFocus) {
    display = [];
  } else if (focusCluster && net.cluster(focusCluster)) {
    const members = new Set(net.cluster(focusCluster)!.members);
    display = filterEvents(all.filter((e) => members.has(e.id)), s).filter((e) => explainOutOfFilter(e, s).length === 0).sort(byTimeDesc);
  } else if (focusId && all.some((e) => e.id === focusId)) {
    const center = byId.get(focusId)!;
    const centerReasons = explainOutOfFilter(center, s);
    const relatedRefs = net.related(focusId);
    const inFilterRelated: { ref: RelatedRef; event: IntelEvent }[] = [];
    const outFilterRelated: { ref: RelatedRef; event: IntelEvent }[] = [];

    for (const r of relatedRefs) {
      const ev = byId.get(r.id);
      if (!ev) continue;
      const reasons = explainOutOfFilter(ev, s);
      if (reasons.length === 0) {
        inFilterRelated.push({ ref: r, event: ev });
      } else {
        outFilterRelated.push({ ref: r, event: ev });
      }
    }

    inFilterRelated.sort((a, b) => b.ref.weight - a.ref.weight);
    outFilterRelated.sort((a, b) => b.ref.weight - a.ref.weight);

    const activeRelated = showOutOfFilterRelated
      ? [...inFilterRelated, ...outFilterRelated]
      : inFilterRelated;

    for (const item of activeRelated) {
      const chip = relationChip(item.ref);
      const reasons = explainOutOfFilter(item.event, s);
      if (reasons.length > 0) {
        chip.why += `（超出篩選：${reasons.join("、")}）`;
      }
      relationById.set(item.ref.id, chip);
    }

    display = [center, ...activeRelated.map((x) => x.event)];
    focusBarDetails = {
      centerOutOfFilterReasons: centerReasons.length > 0 ? centerReasons : undefined,
      inFilterCount: inFilterRelated.length,
      outFilterCount: outFilterRelated.length,
    };
  } else {
    focusId = null;
    focusCluster = null;
    showOutOfFilterRelated = false;
    display = applySearchSubnet(filterEvents(all, s), net, s.query);
    listGroups = collapseSameIncident(display, net);
    collapsedGroupCount = listGroups.filter((g) => g.members.length > 1 && g.sourceCount >= 2).length;
  }

  const emptyMessage =
    display.length === 0
      ? missingFocus ? "此事件不在目前快照或時間範圍內" : focusCluster && net.state !== "error" ? "此情報群沒有符合目前篩選條件的事件，請清除篩選。" : (focusId || focusCluster) && net.state === "error"
        ? "關聯資料載入失敗，無法顯示延伸事件；請點擊重試或返回全部。"
        : emptyListHint(all, s, Date.now())
      : null;
  let focusSummaryLabel = "";
  if (focusCluster) {
    const c = net.cluster(focusCluster);
    focusSummaryLabel = c?.representativeTitle || focusCluster;
  } else if (focusId) {
    focusSummaryLabel = byId.get(focusId)?.title || focusId;
  }

  renderEventList(eventList, listGroups ?? display, {
    viewKey,
    relatedCount: (id) => net.count(id),
    relationOf: (id) => relationById.get(id),
    corroboration: (id) => corroborationOf(id, byId, net),
    ...(emptyMessage ? { emptyMessage } : {}),
  });
  // 聚焦時於清單上方畫關聯網圖：單一事件＝放射狀；情報群＝以核心成員展開（一般清單不畫；錯誤時清空）。
  if (net.state === "error") {
    relationGraph.clear();
  } else if (focusId && all.some((e) => e.id === focusId)) {
    const center = byId.get(focusId)!;
    const neighbors = net
      .related(focusId)
      .map((r): RelationNode | null => {
        const ev = byId.get(r.id);
        return ev ? { event: ev, rel: r } : null;
      })
      .filter((n): n is RelationNode => n !== null);
    if (viewKey !== lastViewKey) relationGraph.reset();
    relationGraph.draw({ center, neighbors, net, byId });
  } else if (focusCluster && net.cluster(focusCluster)) {
    const c = net.cluster(focusCluster)!;
    const memberIds = display.map((event) => event.id);
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
      const clusterAi = clusterSummariesForScope(summary, s.scope, net.generatedAt ?? "", net.clusters())[focusCluster];
      const head = `🕸 情報群網絡　<b>${c.size ?? memberIds.length}</b> 則 · 圖示核心成員的群內關聯${
        clusterAi ? `<span class="rg-ai-summary">🤖 ${esc(clusterAi)}</span>` : ""
      }`;
      if (viewKey !== lastViewKey) relationGraph.reset();
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
  renderFocusBar(display, net, focusBarDetails);
  if (relationNoticeEl) {
    if (net.state === "error") {
      relationNoticeEl.hidden = false;
      relationNoticeEl.innerHTML = `
        <div class="relation-status-notice relation-status-error">
          <span>⚠️ 情報網關聯資料載入失敗（${esc(net.error || "檔案或連線異常")}）。普通新聞、原文與地點查詢仍可正常使用。</span>
          <button type="button" id="retry-network-btn" class="btn-retry-network">重試載入關聯</button>
        </div>`;
      document.getElementById("retry-network-btn")?.addEventListener("click", () => {
        delete netCache[s.scope];
        netAutoRetried[s.scope] = 0;
        manifestAutoRetried[s.scope] = 0;
        cohortManifest = null;
        void refresh();
      });
    } else if (net.state === "stale") {
      relationNoticeEl.hidden = false;
      relationNoticeEl.innerHTML = `
        <div class="relation-status-notice relation-status-stale">
          <span>ℹ️ 情報網關聯使用先前快照備援（更新失敗：${esc(net.error || "連線逾時")}）。</span>
          <button type="button" id="retry-network-btn" class="btn-retry-network">重新整理關聯</button>
        </div>`;
      document.getElementById("retry-network-btn")?.addEventListener("click", () => {
        delete netCache[s.scope];
        netAutoRetried[s.scope] = 0;
        manifestAutoRetried[s.scope] = 0;
        cohortManifest = null;
        void refresh();
      });
    } else {
      relationNoticeEl.hidden = true;
      relationNoticeEl.innerHTML = "";
    }
  }
  renderFilterSummary(display.length, all.length, focusSummaryLabel);
  renderTopClustersIfChanged(net, s.scope);
  const mapKey = `${dataVersion}:${viewKey}:${display.map((event) => event.id).join(",")}`;
  if (mapKey !== lastMapKey) {
    lastMapKey = mapKey;
    // 聚焦/情報群切換後也重新 fit：避免從 popup 進關聯網時，焦點事件落在舊視口外，
    // 地圖看起來像「被清空」。一般清單與聚焦狀態都以目前 display 作為地圖真相。
    const viewChanged = viewKey !== lastMapViewKey;
    lastMapViewKey = viewKey;
    void mapView.render(display, s.scope, { closePopup: viewChanged });
  }
  renderTimeline(document.getElementById("timeline")!, display);
  lastDisplayedEvents = display;
  lastDisplayedScope = s.scope;
  renderAiBrief(document.getElementById("aibrief")!, summary, s.scope, display);
  document.getElementById("count")!.textContent = listGroups ? `${display.length} 則 · 收合 ${collapsedGroupCount} 組` : `${display.length}`;
}

function commitPendingSearch(): void {
  const input = mobileMedia.matches ? mqQuery : document.getElementById("f-query") as HTMLInputElement | null;
  const query = input?.value.trim() || undefined;
  if (input && query !== getState().query) setState({ query });
}

function focusEvent(id: string): void {
  // 先套用仍在 debounce 等待中的搜尋，避免稍後的 query 更新清掉剛選取的焦點。
  commitPendingSearch();
  missingFocus = false;
  focusId = id;
  focusCluster = null;
  showOutOfFilterRelated = false;
  writeHash("push");
  void refresh().then(() => {
    showFocusedListOnMobile();
    const graph = document.getElementById("relationgraph");
    if (graph && !graph.hidden) relationGraph.reveal();
    else revealListFallbackOnMobile();
  });
}

function focusClusterById(id: string): void {
  commitPendingSearch();
  missingFocus = false;
  focusCluster = id;
  focusId = null;
  showOutOfFilterRelated = false;
  writeHash("push");
  void refresh().then(() => {
    showFocusedListOnMobile();
    const graph = document.getElementById("relationgraph");
    if (graph && !graph.hidden) relationGraph.reveal();
    else revealListFallbackOnMobile();
  });
}

function renderUsageTip(): void {
  const tip = document.getElementById("usage-tip")!;
  if (safeStorage.getItem(TIP_KEY)) return;
  tip.hidden = false;
  document.getElementById("close-tip")!.onclick = () => {
    safeStorage.setItem(TIP_KEY, "1");
    tip.hidden = true;
  };
}

// 點「📍 本頁定位」、「🔍 查看此區新聞」或「🔗 關聯 N」
document.getElementById("eventlist")!.addEventListener("click", (ev) => {
  const locateBtn = (ev.target as HTMLElement).closest<HTMLButtonElement>(".locate-on-page-btn");
  if (locateBtn?.dataset.locate) {
    const id = locateBtn.dataset.locate;
    if (mobileMedia.matches) setMobileView("map", { reveal: false });
    void new Promise<void>((resolve) => requestAnimationFrame(() => resolve())).then(() => mapView.locateEvent(id)).then((ok) => {
      if (ok) {
        document.getElementById("map")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
    return;
  }
  const regionBtn = (ev.target as HTMLElement).closest<HTMLButtonElement>(".filter-region-btn");
  if (regionBtn?.dataset.filterRegion) {
    const reg = regionBtn.dataset.filterRegion;
    setState({ region: reg });
    return;
  }
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
    case "region":
      setState({ region: undefined });
      break;
    case "risk":
      setState({ minRisk: undefined });
      break;
    case "newsAuthority":
      setState({ newsAuthority: undefined });
      break;
    case "since":
      setState({ sinceDays: undefined });
      break;
    case "day":
      setState({ day: undefined });
      break;
    case "query":
      setState({ query: undefined });
      break;
    case "focus":
      focusId = null;
      focusCluster = null;
      showOutOfFilterRelated = false;
      writeHash("push");
      void refresh();
      break;
    case "all":
      missingFocus = false;
      focusId = null;
      focusCluster = null;
      showOutOfFilterRelated = false;
      setState({
        category: undefined,
        region: undefined,
        newsAuthority: undefined,
        minRisk: undefined,
        query: undefined,
        sinceDays: DEFAULT_SINCE_DAYS,
        day: undefined,
      });
      break;
  }
  syncFilterBar(document.getElementById("filterbar")!, getState(), cache[scope] ?? []);
});

// 關聯網互動控制器：點節點預覽／前往、hover/tap 高亮、圖例篩選型別。
const relationGraph = createRelationGraphController({
  relGraphEl: document.getElementById("relationgraph")!,
  renderRelationGraph,
  onFocusEvent: focusEvent,
});

// 「/」鍵快速聚焦搜尋框（非輸入/選單狀態時）。
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && filterPanel?.classList.contains("is-open")) {
    ev.preventDefault();
    setMobileFilters(false);
    return;
  }
  if (ev.key !== "/" || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const tag = (document.activeElement as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  const q =
    mobileMedia.matches && !filterPanel?.classList.contains("is-open")
      ? mqQuery
      : (document.getElementById("f-query") as HTMLInputElement | null);
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
    missingFocus = false;
    focusId = null;
    focusCluster = null;
    showOutOfFilterRelated = false;
    setActiveScopeTab(scope);
    // 舊 scope 的 popup 不該留在新 scope 的地圖上；關閉後 render 才會照常重繪並 fit。
    void mapView.closePopup().catch(() => {});
    setState({
      scope,
      category: undefined,
      region: undefined,
      newsAuthority: undefined,
      minRisk: undefined,
      query: undefined,
      sinceDays: DEFAULT_SINCE_DAYS,
      day: undefined,
    });
    syncFilterBar(document.getElementById("filterbar")!, getState(), cache[scope] ?? []);
    revealScopeChangeOnMobile();
  };
});

subscribe((s) => {
  const nextQuery = s.query ?? "";
  if (!applyingHash && nextQuery && nextQuery !== lastQuery) {
    focusId = null;
    focusCluster = null;
  }
  lastQuery = nextQuery;
  if (!applyingHash) missingFocus = false;
  // applyHash 的呼叫端會在還原完成後 refresh；此時重入會讓自動放寬時間的 hash 寫入被抑制。
  if (!applyingHash) {
    writeHash("replace");
    void refresh();
  }
  setActiveScopeTab(s.scope);
  syncFilterBar(document.getElementById("filterbar")!, s, cache[s.scope] ?? []);
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
// 地圖 first-paint：先鎖定 cohort manifest，精簡點位通過 SHA-256 驗證才早繪；
// manifest 不可用或驗證失敗時不晉級未驗證產物，交由 refresh() 以同版資料補繪。
// 放在 applyHash() 之後：scope 以網址深連結為準。晉級前核對：scope 未被切走、
// refresh 未先完成（cache 有值）、且所用 manifest 仍是目前鎖定版本（refresh 重讀到新版時不覆蓋）。
{
  const firstPaintScope = getState().scope;
  void loadFirstPaintMapEvents(firstPaintScope, { fetchManifest: fetchManifestOnce }).then((res) => {
    if (!res || getState().scope !== firstPaintScope || cache[firstPaintScope]) return;
    if (!cohortManifest) cohortManifest = res.manifest;
    if (cohortManifest.snapshotId !== res.manifest.snapshotId) return;
    // Record the view already shown by first-paint: full data arriving for this
    // same list is a background update and must preserve an open popup.
    lastMapViewKey = JSON.stringify(getState()) + "list";
    void mapView.render(filterEvents(res.events, getState()), firstPaintScope);
  });
  // 清單與指標 first-paint：先鎖定 cohort manifest，精簡 head 事件通過 SHA-256 驗證才早繪；
  // 隨後由 refresh() 在背景置換完整快照。
  void loadFirstPaintHeadEvents(firstPaintScope, { fetchManifest: fetchManifestOnce })
    .then((res) => {
      if (!res || getState().scope !== firstPaintScope || cache[firstPaintScope]) return;
      if (!cohortManifest) cohortManifest = res.manifest;
      if (cohortManifest.snapshotId !== res.manifest.snapshotId) return;
      headCache[firstPaintScope] = res.events;
      isHeadActive[firstPaintScope] = true;
      renderHeadFirstPaint(firstPaintScope, res.events);
    })
    .catch(() => {});
}
renderUsageTip();
// 側欄離開首屏關鍵載入窗；成功才記錄完成，新快照讓已開啟的面板重繪。
function setupLazyPanel(id: string, render: (container: HTMLElement, onReload: () => void) => Promise<boolean>): void {
  const el = document.getElementById(id)!;
  const section = el.closest<HTMLDetailsElement>("[data-side-section]");
  let version = 0;
  let renderedVersion = -1;
  let pending = false;
  const renderOnce = (): void => {
    if (pending || renderedVersion === version) return;
    pending = true;
    const requestedVersion = version;
    void render(el, () => {
      renderedVersion = -1;
      renderOnce();
    }).then((ok) => {
      if (ok && requestedVersion === version) renderedVersion = version;
    }).finally(() => {
      pending = false;
      if (requestedVersion !== version && section?.open) renderOnce();
    });
  };
  invalidateSidePanels.push(() => {
    version++;
    if (section?.open) renderOnce();
  });
  section?.addEventListener("toggle", () => {
    if (section.open) renderOnce();
  });
  if (section?.open || typeof IntersectionObserver === "undefined") renderOnce();
  else {
    const io = new IntersectionObserver((entries, observer) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        renderOnce();
      }
    }, { rootMargin: "200px" });
    io.observe(section ?? el);
  }
}
setupLazyPanel("policehealth", renderPoliceHealthPanel);
setupLazyPanel("sourcepanel", renderSourcePanel);
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
  lastGeneratedAt = s?.generatedAt || null;
  const currentScope = getState().scope;
  renderAiBrief(document.getElementById("aibrief")!, summary, currentScope,
    lastDisplayedScope === currentScope ? lastDisplayedEvents : []);
  renderDataFreshness(s);
  renderStalenessBanner(s?.generatedAt);
  // 摘要含 clusterSummaries → 更新 TopClusters（及若有聚焦群則更新網絡），免全頁重新過濾與渲染
  const net = netCache[currentScope];
  if (net && net.state !== "error") {
    renderTopClustersIfChanged(net, currentScope);
  }
  if (focusCluster) {
    void refresh();
  }
});
void refresh();
setInterval(() => {
  // manifest 獨立於摘要輪詢；離線時保留已驗證的事件／關聯快照。
  void Promise.all([
    fetchManifestOnce(),
    // 摘要卡住不能擋住 manifest 套用與 refresh。
    fetch("./data/summary.json", { cache: "no-store", signal: AbortSignal.timeout(15_000) })
      .then((res) => res.ok ? res.json() as Promise<AiSummary> : null)
      .catch(() => null),
  ]).then(([manifest, data]) => {
    if (manifest) cohortManifest = manifest;
    if (data?.generatedAt && data.generatedAt !== lastGeneratedAt) {
      lastGeneratedAt = data.generatedAt;
      summary = data;
      renderDataFreshness(data);
    }
    renderStalenessBanner(summary?.generatedAt);
    void refresh();
  });
}, REFRESH_MS);
