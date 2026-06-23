import "./styles/global.css";
import { t } from "./i18n/zh-TW";
import { getState, setState, subscribe } from "./store";
import { loadEvents, filterEvents } from "./data/loader";
import { edgeTypeLabel, loadNetwork, type NetworkIndex, type RelatedRef } from "./data/network";
import { renderEventList, resetEventListScroll } from "./components/EventList";
import { renderKpiStrip } from "./components/KpiStrip";
import { renderRelationGraph, type RelationNode } from "./components/RelationGraph";
import { riskBadge } from "./components/RiskBadge";
import { esc } from "./utils/escape";
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
    <div id="data-freshness" class="data-freshness" aria-live="polite"></div>
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
  </main>
  <nav class="mobile-quickbar" aria-label="快捷操作">
    <div class="search-box mq-search">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="16.5" y1="16.5" x2="21" y2="21"></line></svg>
      <input id="mq-query" type="search" aria-label="搜尋情報" placeholder="搜尋情報…">
    </div>
    <button id="mq-filter" type="button">篩選</button>
  </nav>`;

const mapView = new MapView(document.getElementById("map")!);

// 手機底部快捷列：搜尋同步寫入 store；篩選鈕捲到頂並聚焦篩選器。
const mqQuery = document.getElementById("mq-query") as HTMLInputElement | null;
if (mqQuery)
  mqQuery.oninput = (ev) =>
    setState({ query: (ev.target as HTMLInputElement).value.trim() || undefined });
const mqFilter = document.getElementById("mq-filter");
if (mqFilter)
  mqFilter.onclick = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.getElementById("f-cat")?.focus();
  };
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
  // 事件與情報網兩支 fetch 並行（原本串行，第二支要等第一支完成才開始）。
  if (!cache[s.scope] || !netCache[s.scope]) {
    const [ev, net] = await Promise.all([
      cache[s.scope] ?? loadEvents(s.scope),
      netCache[s.scope] ?? loadNetwork(s.scope),
    ]);
    cache[s.scope] = ev;
    netCache[s.scope] = net;
  }
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
    rgCtx = { center, neighbors, net, byId };
    resetRelationGraphState();
    drawRelationGraph();
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
      rgCtx = { center: hubEvent, neighbors, net, byId, headHtml: head };
      resetRelationGraphState();
      drawRelationGraph();
    } else {
      rgCtx = null;
      relGraph.hidden = true;
      relGraph.innerHTML = "";
    }
  } else {
    rgCtx = null;
    relGraph.hidden = true;
    relGraph.innerHTML = "";
  }
  if (viewKey !== lastViewKey) {
    resetEventListScroll(eventList);
    lastViewKey = viewKey;
  }
  renderFocusBar(display, net);
  renderTopClusters(document.getElementById("topclusters")!, net.clusters());
  void mapView.render(display);
  renderTimeline(document.getElementById("timeline")!, display);
  renderAiBrief(document.getElementById("aibrief")!, summary, s.scope);
  document.getElementById("count")!.textContent = `${display.length}`;
}

// 聚焦後把關聯網捲進視窗：手機單欄時入口（事件卡／情報群）常遠離圖渲染處（列表頂），
// 不捲過去會看起來「沒反應」。桌面圖已在頂端可視 → 不在視窗外就 no-op，不打擾。
function revealRelationGraph(): void {
  requestAnimationFrame(() => {
    const rg = document.getElementById("relationgraph");
    if (!rg || rg.hidden) return;
    const r = rg.getBoundingClientRect();
    if (r.top >= 0 && r.top < window.innerHeight * 0.7) return;
    // scrollIntoView 會自動處理正確的捲動容器（window.scrollTo 在本頁 html/body 全高時失效）；
    // CSS 的 scroll-margin-top 讓圖頂避開 sticky topbar。
    rg.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function focusEvent(id: string): void {
  focusId = id;
  focusCluster = null;
  writeHash("push");
  void refresh().then(revealRelationGraph);
}

function focusClusterById(id: string): void {
  focusCluster = id;
  focusId = null;
  writeHash("push");
  void refresh().then(revealRelationGraph);
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

// 關聯網互動：點節點先看預覽（觸控無 hover），按「前往」才聚焦；hover/tap 高亮；圖例篩選型別。
const relGraphEl = document.getElementById("relationgraph")!;
const REL_TYPES = ["same-incident", "same-entity", "same-topic"];
let rgPinned: string | null = null; // 被點選（釘住）的節點 id
let expandId: string | null = null; // 被就地展開（顯示第二圈）的節點 id
const rgOffTypes = new Set<string>(); // 被關閉的關聯型別（跨重畫保留，否則展開後篩選會掉）
// 當前關聯圖上下文，供「展開」互動不經 refresh 就地重畫。
let rgCtx: {
  center: IntelEvent;
  neighbors: RelationNode[];
  net: NetworkIndex;
  byId: Map<string, IntelEvent>;
  headHtml?: string;
} | null = null;

// 渲染新圖後重置互動狀態（由 refresh 呼叫）。
function resetRelationGraphState(): void {
  rgPinned = null;
  expandId = null;
  rgOffTypes.clear();
}

function rgSvg(): SVGSVGElement | null {
  return relGraphEl.querySelector("svg.rg-svg");
}

// 某節點可再展開的關聯數（排除中心與已在主環者）。
function expandableCount(id: string): number {
  if (!rgCtx) return 0;
  const ctx = rgCtx;
  const existing = new Set([ctx.center.id, ...ctx.neighbors.map((n) => n.event.id)]);
  return ctx.net.related(id).filter((r) => ctx.byId.has(r.id) && !existing.has(r.id)).length;
}

// 依 rgCtx＋expandId 就地重畫關聯圖（含 2-hop 第二圈），不經 refresh、不重置中心。
function drawRelationGraph(): void {
  if (!rgCtx) return;
  const { center, neighbors, net, byId, headHtml } = rgCtx;
  let expand: { nodeId: string; subs: RelationNode[] } | undefined;
  if (expandId && neighbors.some((n) => n.event.id === expandId)) {
    const existing = new Set([center.id, ...neighbors.map((n) => n.event.id)]);
    const subs = net
      .related(expandId)
      .map((r): RelationNode | null => {
        const ev = byId.get(r.id);
        return ev ? { event: ev, rel: r } : null;
      })
      .filter((n): n is RelationNode => n !== null)
      .filter((n) => !existing.has(n.event.id))
      .slice(0, 5);
    if (subs.length) expand = { nodeId: expandId, subs };
  }
  renderRelationGraph(relGraphEl, center, neighbors, headHtml, expand);
  // 重畫會重建圖例（預設全開）；還原型別篩選狀態並重新套用。
  if (rgOffTypes.size) {
    rgOffTypes.forEach((type) =>
      relGraphEl.querySelector(`.rg-legend-btn[data-type="${type}"]`)?.setAttribute("aria-pressed", "false"),
    );
    applyTypeFilter();
  }
}

function applyHighlight(id: string | null): void {
  const svg = rgSvg();
  if (!svg) return;
  svg.querySelectorAll(".is-active").forEach((el) => el.classList.remove("is-active"));
  svg.classList.toggle("has-active", !!id);
  if (!id) return;
  svg
    .querySelectorAll(`.rg-node-g[data-rel="${CSS.escape(id)}"], .rg-edge[data-rel="${CSS.escape(id)}"]`)
    .forEach((el) => el.classList.add("is-active"));
}

function showPreview(g: Element): void {
  const preview = relGraphEl.querySelector<HTMLElement>(".rg-preview");
  if (!preview) return;
  const d = (k: string): string => g.getAttribute(`data-${k}`) ?? "";
  const id = d("rel");
  const why = d("why");
  // 主環節點若還有可展開的關聯，提供「展開關聯 N／收合」；子節點不再提供（避免無限展開）。
  const exCount = g.classList.contains("rg-subnode") ? 0 : expandableCount(id);
  const expandBtn =
    exCount > 0
      ? `<button type="button" class="rg-expand" data-rel="${esc(id)}">${
          expandId === id ? "收合" : `展開關聯 ${exCount}`
        }</button>`
      : "";
  preview.innerHTML = `
    <div class="rg-pv-head">${riskBadge(d("risk") as RiskLevel)}<span class="rg-pv-title">${esc(d("title"))}</span></div>
    <div class="rg-pv-meta"><span>${esc(d("time"))}</span><span>${esc(d("region"))}・${esc(d("cat"))}</span></div>
    <div class="rg-pv-rel"><b>${esc(d("rtype"))}</b>${why ? `：${esc(why)}` : ""}</div>
    <div class="rg-pv-actions">
      <button type="button" class="rg-go" data-rel="${esc(id)}">前往 →</button>
      ${expandBtn}
    </div>`;
  preview.hidden = false;
}

function clearSelection(): void {
  rgPinned = null;
  applyHighlight(null);
  const preview = relGraphEl.querySelector<HTMLElement>(".rg-preview");
  if (preview) {
    preview.hidden = true;
    preview.innerHTML = "";
  }
}

function applyTypeFilter(): void {
  const svg = rgSvg();
  if (!svg) return;
  svg.querySelectorAll<SVGElement>(".rg-edge, .rg-node-g").forEach((el) => {
    const type = el.classList.contains("rg-edge")
      ? REL_TYPES.find((t) => el.classList.contains(`edge-${t}`))
      : el.getAttribute("data-rtype-key");
    el.classList.toggle("flt-off", !!type && rgOffTypes.has(type));
  });
}

function selectNode(g: Element): void {
  const id = g.getAttribute("data-rel");
  if (!id) return;
  rgPinned = id;
  applyHighlight(id);
  showPreview(g);
}

relGraphEl.addEventListener("click", (ev) => {
  const target = ev.target as Element;
  const go = target.closest<HTMLButtonElement>(".rg-go");
  if (go?.dataset.rel) {
    focusEvent(go.dataset.rel);
    return;
  }
  // 2-hop：展開/收合該節點的第二圈，就地重畫、不導航、不重置中心。
  const expandBtn = target.closest<HTMLButtonElement>(".rg-expand");
  if (expandBtn?.dataset.rel) {
    const eid = expandBtn.dataset.rel;
    expandId = expandId === eid ? null : eid;
    drawRelationGraph();
    rgPinned = null; // 展開時不釘住高亮，讓第二圈完整可見
    const g = rgSvg()?.querySelector(`.rg-node-g[data-rel="${CSS.escape(eid)}"]`);
    if (g) showPreview(g);
    return;
  }
  const legendBtn = target.closest<HTMLButtonElement>(".rg-legend-btn");
  if (legendBtn?.dataset.type) {
    const type = legendBtn.dataset.type;
    if (rgOffTypes.has(type)) rgOffTypes.delete(type);
    else rgOffTypes.add(type);
    legendBtn.setAttribute("aria-pressed", rgOffTypes.has(type) ? "false" : "true");
    applyTypeFilter();
    return;
  }
  const node = target.closest(".rg-node-g");
  if (node && !node.classList.contains("flt-off")) {
    selectNode(node);
  } else if (target.closest(".rg-center-g") || target.closest("svg.rg-svg")) {
    clearSelection();
  }
});

relGraphEl.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter" && ev.key !== " ") return;
  const node = (ev.target as Element).closest(".rg-node-g");
  if (node && !node.classList.contains("flt-off")) {
    ev.preventDefault();
    selectNode(node);
  }
});

// hover/focus 暫態高亮：離開時還原到釘住的節點。
relGraphEl.addEventListener("mouseover", (ev) => {
  const node = (ev.target as Element).closest(".rg-node-g");
  if (node && !node.classList.contains("flt-off")) applyHighlight(node.getAttribute("data-rel"));
});
relGraphEl.addEventListener("mouseout", (ev) => {
  if (!(ev.target as Element).closest(".rg-node-g")) return;
  applyHighlight(rgPinned);
});
relGraphEl.addEventListener("focusin", (ev) => {
  const node = (ev.target as Element).closest(".rg-node-g");
  if (node && !node.classList.contains("flt-off")) applyHighlight(node.getAttribute("data-rel"));
});
relGraphEl.addEventListener("focusout", () => applyHighlight(rgPinned));

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
void renderPoliceHealthPanel(document.getElementById("policehealth")!);
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

void loadSummary().then((s) => {
  summary = s;
  renderAiBrief(document.getElementById("aibrief")!, summary, getState().scope);
  renderDataFreshness(s);
});
void refresh();
setInterval(() => {
  const scope = getState().scope;
  delete cache[scope];
  delete netCache[scope];
  void refresh();
}, REFRESH_MS);
