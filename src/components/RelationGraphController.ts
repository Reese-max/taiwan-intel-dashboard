import type { NetworkIndex } from "../data/network";
import type { RelationNode } from "./RelationGraph";
import { riskBadge } from "./RiskBadge";
import type { IntelEvent, RiskLevel } from "../types/event";
import { esc } from "../utils/escape";

const REL_TYPES = ["same-incident", "same-entity", "same-topic"];

export interface RelationGraphContext {
  center: IntelEvent;
  neighbors: RelationNode[];
  net: NetworkIndex;
  byId: Map<string, IntelEvent>;
  headHtml?: string;
}

type RenderRelationGraph = typeof import("./RelationGraph").renderRelationGraph;

interface RelationGraphControllerDeps {
  relGraphEl: HTMLElement;
  renderRelationGraph: RenderRelationGraph;
  onFocusEvent: (id: string) => void;
}

export interface RelationGraphController {
  draw(ctx: RelationGraphContext): void;
  reset(): void;
  clear(): void;
  reveal(): void;
}

export function createRelationGraphController({
  relGraphEl,
  renderRelationGraph,
  onFocusEvent,
}: RelationGraphControllerDeps): RelationGraphController {
  let rgPinned: string | null = null; // 被點選（釘住）的節點 id
  let expandId: string | null = null; // 被就地展開（顯示第二圈）的節點 id
  const rgOffTypes = new Set<string>(); // 被關閉的關聯型別（跨重畫保留，否則展開後篩選會掉）
  // 當前關聯圖上下文，供「展開」互動不經 refresh 就地重畫。
  let rgCtx: RelationGraphContext | null = null;

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

  // 聚焦後把關聯網捲進視窗：手機單欄時入口（事件卡／情報群）常遠離圖渲染處（列表頂），
  // 不捲過去會看起來「沒反應」。桌面圖已在頂端可視 → 不在視窗外就 no-op，不打擾。
  function revealRelationGraph(): void {
    requestAnimationFrame(() => {
      const rg = relGraphEl;
      if (!rg || rg.hidden) return;
      const listScroller = rg.closest<HTMLElement>(".col-list");
      if (listScroller) {
        const top = Math.max(0, rg.offsetTop - listScroller.offsetTop - 8);
        listScroller.scrollTo({ top, behavior: "auto" });
      }
      const r = rg.getBoundingClientRect();
      if (r.top >= 0 && r.top < window.innerHeight * 0.7) return;
      // scrollIntoView 會自動處理正確的捲動容器（window.scrollTo 在本頁 html/body 全高時失效）；
      // CSS 的 scroll-margin-top 讓圖頂避開 sticky topbar。
      rg.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  relGraphEl.addEventListener("click", (ev) => {
    const target = ev.target as Element;
    const go = target.closest<HTMLButtonElement>(".rg-go");
    if (go?.dataset.rel) {
      onFocusEvent(go.dataset.rel);
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

  return {
    draw(ctx: RelationGraphContext): void {
      rgCtx = ctx;
      drawRelationGraph();
    },
    reset: resetRelationGraphState,
    clear(): void {
      rgCtx = null;
      relGraphEl.hidden = true;
      relGraphEl.innerHTML = "";
    },
    reveal: revealRelationGraph,
  };
}
