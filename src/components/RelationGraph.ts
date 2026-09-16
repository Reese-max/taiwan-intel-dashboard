import type { IntelEvent } from "../types/event";
import type { RelatedRef } from "../data/network";
import { edgeTypeLabel } from "../data/network";
import { esc } from "../utils/escape";

export interface RelationNode {
  event: IntelEvent;
  rel: RelatedRef;
}

// 放射狀網圖：圖示前 MAX_NODES 強的鄰居，其餘留給下方清單（避免擁擠）。
const MAX_NODES = 10;
const W = 380;
const H = 320;
const CX = W / 2;
const CY = H / 2;
const R = 116;
// 邊曲線控制點偏移量（垂直於連線），輕微弧度減少重疊。
const BOW = 14;
// 2-hop 就地展開：子節點距父節點半徑、最多顯示數。
const RSUB = 44;
const SUB_MAX = 5;
const PAD = 14;

function angle(i: number, n: number): number {
  return (-90 + (i * 360) / n) * (Math.PI / 180);
}

function trunc(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

// why 常以型別標籤開頭（如「跨源佐證：…」）；顯示時型別已另呈現，去掉前綴免重複。
function cleanWhy(label: string, why: string): string {
  return why.replace(new RegExp(`^${label}[：:]\\s*`), "").trim();
}

function fmtTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("zh-TW", { hour12: false });
}

// 由中心到 (x,y) 的二次貝茲曲線：控制點＝中點沿垂直方向偏移 BOW。
function curvePath(x: number, y: number): string {
  return curveBetween(CX, CY, x, y, BOW);
}

// 任兩點間的二次貝茲曲線（控制點＝中點沿垂直方向偏移 bow）。
function curveBetween(x1: number, y1: number, x2: number, y2: number, bow: number): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / len) * bow;
  const cy = my + (dx / len) * bow;
  return `M${x1.toFixed(1)},${y1.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// 共用節點 markup（主環與第二圈共用；子節點較小、無文字標籤、靠點擊預覽看內容）。
function nodeMarkup(
  n: RelationNode,
  x: number,
  y: number,
  opts: { sub?: boolean; expanded?: boolean; label?: string; lx?: number; anchor?: "start" | "end" },
): string {
  const e = n.event;
  const why = cleanWhy(edgeTypeLabel(n.rel.type), n.rel.why ?? "");
  const tip = `${e.title}\n${edgeTypeLabel(n.rel.type)}${why ? `：${why}` : ""}`;
  const cls = `rg-node-g${opts.sub ? " rg-subnode" : ""}${opts.expanded ? " is-expanded" : ""}`;
  const label =
    opts.label != null
      ? `<text class="rg-label" x="${opts.lx!.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="${opts.anchor}">${esc(opts.label)}</text>`
      : "";
  return `<g class="${cls}" data-rel="${esc(e.id)}" data-rtype-key="${esc(n.rel.type)}"
    data-title="${esc(e.title)}" data-time="${esc(fmtTime(e.timestamp))}" data-risk="${esc(e.riskLevel)}"
    data-cat="${esc(e.category)}" data-region="${esc(e.region)}" data-rtype="${esc(edgeTypeLabel(n.rel.type))}"
    data-why="${esc(why)}" tabindex="0" role="button" aria-label="${esc(e.title)}">
    <title>${esc(tip)}</title>
    <circle class="rg-hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${opts.sub ? 12 : 15}" fill="transparent" />
    <circle class="rg-node risk-${e.riskLevel}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${opts.sub ? 5 : 7}" />
    ${label}
  </g>`;
}

export function renderRelationGraph(
  container: HTMLElement,
  center: IntelEvent,
  neighbors: RelationNode[],
  headHtml?: string,
  expand?: { nodeId: string; subs: RelationNode[] },
): void {
  if (!neighbors.length) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }

  const shown = neighbors.slice(0, MAX_NODES);
  const more = neighbors.length - shown.length;
  const maxW = Math.max(...shown.map((n) => n.rel.weight), 1);

  const placed = shown.map((n, i) => {
    const a = angle(i, shown.length);
    return { n, x: CX + R * Math.cos(a), y: CY + R * Math.sin(a), right: Math.cos(a) >= 0 };
  });

  const edges = placed
    .map(({ n, x, y }) => {
      const sw = (1.3 + (n.rel.weight / maxW) * 3).toFixed(2);
      const why = cleanWhy(edgeTypeLabel(n.rel.type), n.rel.why ?? "");
      const tip = `${edgeTypeLabel(n.rel.type)}（強度 ${n.rel.weight.toFixed(1)}）${why ? `｜${why}` : ""}`;
      return `<path class="rg-edge edge-${n.rel.type}" data-rel="${esc(n.event.id)}" d="${curvePath(x, y)}" fill="none" stroke-width="${sw}"><title>${esc(tip)}</title></path>`;
    })
    .join("");

  const nodes = placed
    .map(({ n, x, y, right }) =>
      nodeMarkup(n, x, y, {
        label: trunc(n.event.title, 8),
        lx: x + (right ? 12 : -12),
        anchor: right ? "start" : "end",
        expanded: expand?.nodeId === n.event.id,
      }),
    )
    .join("");

  // 2-hop 就地展開：在被展開的主環節點朝外側長出第二圈（細淡虛線邊，最多 SUB_MAX 個）。
  let subEdges = "";
  let subNodes = "";
  const parent = expand && placed.find((p) => p.n.event.id === expand.nodeId);
  if (expand && parent) {
    const subs = expand.subs.slice(0, SUB_MAX);
    const pa = Math.atan2(parent.y - CY, parent.x - CX); // 由中心指向父節點＝朝外方向
    const span = (Math.min(120, 40 * Math.max(1, subs.length - 1)) * Math.PI) / 180;
    subs.forEach((s, j) => {
      const t = subs.length <= 1 ? 0 : (j / (subs.length - 1) - 0.5) * span;
      const sa = pa + t;
      const sx = clamp(parent.x + RSUB * Math.cos(sa), PAD, W - PAD);
      const sy = clamp(parent.y + RSUB * Math.sin(sa), PAD, H - PAD);
      subEdges += `<path class="rg-edge rg-subedge edge-${s.rel.type}" data-rel="${esc(s.event.id)}" d="${curveBetween(parent.x, parent.y, sx, sy, 6)}" fill="none" stroke-width="1"><title>${esc(edgeTypeLabel(s.rel.type))}</title></path>`;
      subNodes += nodeMarkup(s, sx, sy, { sub: true });
    });
  }

  const centerNode = `<g class="rg-center-g">
    <title>${esc(center.title)}</title>
    <circle class="rg-node rg-center risk-${center.riskLevel}" cx="${CX}" cy="${CY}" r="12" />
    <text class="rg-center-label" x="${CX}" y="${(CY + 31).toFixed(1)}" text-anchor="middle">${esc(trunc(center.title, 13))}</text>
  </g>`;

  const head =
    headHtml ??
    `🕸 關聯網　<b>${neighbors.length}</b> 則直接關聯${
      more > 0 ? `（圖示最強 ${MAX_NODES}，餘 ${more} 則見下方清單）` : ""
    }`;

  container.hidden = false;
  container.innerHTML = `
    <div class="rg-head">${head}</div>
    <svg class="rg-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="關聯網圖：點節點看預覽，再按前往聚焦">
      ${edges}${subEdges}${centerNode}${nodes}${subNodes}
    </svg>
    <div class="rg-preview" hidden></div>
    <div class="rg-legend" role="group" aria-label="依關聯型別篩選">
      <button type="button" class="rg-legend-btn" data-type="same-incident" aria-pressed="true"><i class="edge-same-incident"></i>${esc(edgeTypeLabel("same-incident"))}</button>
      <button type="button" class="rg-legend-btn" data-type="same-entity" aria-pressed="true"><i class="edge-same-entity"></i>共享實體</button>
      <button type="button" class="rg-legend-btn" data-type="same-topic" aria-pressed="true"><i class="edge-same-topic"></i>${esc(edgeTypeLabel("same-topic"))}</button>
    </div>`;
}
