import "./styles/global.css";
import { t } from "./i18n/zh-TW";
import { getState, setState, subscribe } from "./store";
import { loadEvents, filterEvents } from "./data/loader";
import { edgeTypeLabel, loadNetwork, type NetworkIndex, type RelatedRef } from "./data/network";
import { renderEventList, resetEventListScroll } from "./components/EventList";
import { renderKpiStrip } from "./components/KpiStrip";
import { renderRelationGraph, type RelationNode } from "./components/RelationGraph";
import { renderFilterBar } from "./components/FilterBar";
import { renderTimeline } from "./components/TimelineView";
import { renderSourcePanel } from "./components/SourcePanel";
import { loadSummary, renderAiBrief, type AiSummary } from "./components/AiBrief";
import { renderPoliceHealthPanel } from "./components/PoliceHealthPanel";
import { renderTopClusters } from "./components/TopClusters";
import { MapView } from "./components/MapView";
import type { IntelEvent, RiskLevel, Scope } from "./types/event";

const DEFAULT_SINCE_DAYS = 3;
const REFRESH_MS = 300000;
const TIP_KEY = "taiwan-intel-link-tip-dismissed";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <h1>${t.appTitle}</h1>
      <p class="subtitle">${t.subtitle}</p>
    </div>
    <nav class="tabs" role="tablist">
      <button data-scope="domestic" class="active" role="tab">${t.tabDomestic}</button>
      <button data-scope="international" role="tab">${t.tabInternational}</button>
    </nav>
  </header>
  <div id="usage-tip" class="usage-tip" hidden>
    <span>🔗＝點我看關聯；點事件可追整張情報網。</span>
    <button type="button" id="close-tip">我知道了</button>
  </div>
  <div id="filterbar" class="filterbar"></div>
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
      <div id="focusbar" class="focusbar" hidden></div>
      <div id="relationgraph" class="relation-graph" hidden></div>
      <div id="eventlist"></div>
    </section>
    <aside class="col-side">
      <div id="topclusters"></div>
      <div id="aibrief" class="ai-brief"></div>
      <div id="policehealth"></div>
      <div id="sourcepanel"></div>
    </aside>
  </main>`;

const mapView = new MapView(document.getElementById("map")!);
const cache: Partial<Record<Scope, IntelEvent[]>> = {};
const netCache: Partial<Record<Scope, NetworkIndex>> = {};
let summary: AiSummary | null = null;
// 情報網聚焦：可選單一事件，或選一個 cluster 展開整群。
let focusId: string | null = null;
let focusCluster: string | null = null;
let applyingHash = false;
let lastQuery = "";
let lastViewKey = "";

function isScope(v: string | null): v is Scope {
  return v === "domestic" || v === "international";
}

function isRisk(v: string | null): v is RiskLevel {
  return v === "low" || v === "medium" || v === "high" || v === "critical";
}

function setActiveScopeTab(scope: Scope): void {
  document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.scope === scope);
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

function applySearchSubnet(events: IntelEvent[], net: NetworkIndex, query?: string): IntelEvent[] {
  const q = query?.trim().toLocaleLowerCase("zh-TW");
  if (!q) return events;
  const available = new Set(events.map((e) => e.id));
  const ids = new Set<string>();
  for (const e of events) {
    const hay = `${e.title} ${e.summary} ${e.region} ${e.category} ${e.source.name}`.toLocaleLowerCase("zh-TW");
    if (!hay.includes(q)) continue;
    ids.add(e.id);
    for (const r of net.related(e.id)) if (available.has(r.id)) ids.add(r.id);
  }
  return events.filter((e) => ids.has(e.id));
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
    label = `情報群：${c?.representativeTitle || focusCluster}`;
    count = c?.size ?? events.length;
  } else if (focusId) {
    const center = events.find((e) => e.id === focusId);
    label = `關聯網：${center ? center.title : focusId}`;
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
  if (!cache[s.scope]) cache[s.scope] = await loadEvents(s.scope);
  if (!netCache[s.scope]) netCache[s.scope] = await loadNetwork(s.scope);
  const all = cache[s.scope]!;
  const net = netCache[s.scope]!;
  renderKpiStrip(document.getElementById("kpistrip")!, all);

  let display: IntelEvent[];
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
  }

  const eventList = document.getElementById("eventlist")!;
  renderEventList(eventList, display, {
    relatedCount: (id) => net.count(id),
    relationOf: (id) => relationById.get(id),
  });
  // 聚焦時於清單上方畫關聯網圖：單一事件＝放射狀；情報群＝以核心成員展開（一般清單不畫）。
  const relGraph = document.getElementById("relationgraph")!;
  if (focusId && all.some((e) => e.id === focusId)) {
    const byId = new Map(all.map((e) => [e.id, e] as const));
    const center = byId.get(focusId)!;
    const neighbors = net
      .related(focusId)
      .map((r): RelationNode | null => {
        const ev = byId.get(r.id);
        return ev ? { event: ev, rel: r } : null;
      })
      .filter((n): n is RelationNode => n !== null);
    renderRelationGraph(relGraph, center, neighbors);
  } else if (focusCluster && net.cluster(focusCluster)) {
    const c = net.cluster(focusCluster)!;
    const byId = new Map(all.map((e) => [e.id, e] as const));
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
      const head = `🕸 情報群網絡　<b>${c.size ?? memberIds.length}</b> 則 · 圖示核心成員的群內關聯`;
      renderRelationGraph(relGraph, hubEvent, neighbors, head);
    } else {
      relGraph.hidden = true;
      relGraph.innerHTML = "";
    }
  } else {
    relGraph.hidden = true;
    relGraph.innerHTML = "";
  }
  if (viewKey !== lastViewKey) {
    resetEventListScroll(eventList);
    lastViewKey = viewKey;
  }
  renderFocusBar(display, net);
  renderTopClusters(document.getElementById("topclusters")!, net.clusters());
  mapView.render(display);
  renderTimeline(document.getElementById("timeline")!, display);
  renderAiBrief(document.getElementById("aibrief")!, summary, s.scope);
  document.getElementById("count")!.textContent = `${display.length}`;
}

function focusEvent(id: string): void {
  focusId = id;
  focusCluster = null;
  writeHash("push");
  void refresh();
}

function focusClusterById(id: string): void {
  focusCluster = id;
  focusId = null;
  writeHash("push");
  void refresh();
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

// 點關聯網圖的節點 → 聚焦該情報（事件委派，含鍵盤 Enter/Space）。
const relGraphEl = document.getElementById("relationgraph")!;
relGraphEl.addEventListener("click", (ev) => {
  const g = (ev.target as Element).closest(".rg-node-g");
  const id = g?.getAttribute("data-rel");
  if (id) focusEvent(id);
});
relGraphEl.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter" && ev.key !== " ") return;
  const g = (ev.target as Element).closest(".rg-node-g");
  const id = g?.getAttribute("data-rel");
  if (id) {
    ev.preventDefault();
    focusEvent(id);
  }
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
void renderPoliceHealthPanel(document.getElementById("policehealth")!);
void renderSourcePanel(document.getElementById("sourcepanel")!);
void loadSummary().then((s) => {
  summary = s;
  renderAiBrief(document.getElementById("aibrief")!, summary, getState().scope);
});
void refresh();
setInterval(() => {
  const scope = getState().scope;
  delete cache[scope];
  delete netCache[scope];
  void refresh();
}, REFRESH_MS);
