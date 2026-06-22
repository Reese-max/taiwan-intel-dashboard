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
  const mx = (CX + x) / 2;
  const my = (CY + y) / 2;
  const dx = x - CX;
  const dy = y - CY;
  const len = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / len) * BOW;
  const cy = my + (dx / len) * BOW;
  return `M${CX},${CY} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
}

export function renderRelationGraph(
  container: HTMLElement,
  center: IntelEvent,
  neighbors: RelationNode[],
  headHtml?: string,
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
    .map(({ n, x, y, right }) => {
      const lx = x + (right ? 12 : -12);
      const anchor = right ? "start" : "end";
      const e = n.event;
      const why = cleanWhy(edgeTypeLabel(n.rel.type), n.rel.why ?? "");
      const tip = `${e.title}\n${edgeTypeLabel(n.rel.type)}${why ? `：${why}` : ""}`;
      // data-* 供 main.ts 組預覽（觸控無 hover，<title> 在手機無效）。
      return `<g class="rg-node-g" data-rel="${esc(e.id)}" data-rtype-key="${esc(n.rel.type)}"
        data-title="${esc(e.title)}" data-time="${esc(fmtTime(e.timestamp))}" data-risk="${esc(e.riskLevel)}"
        data-cat="${esc(e.category)}" data-region="${esc(e.region)}" data-rtype="${esc(edgeTypeLabel(n.rel.type))}"
        data-why="${esc(why)}" tabindex="0" role="button" aria-label="${esc(e.title)}">
        <title>${esc(tip)}</title>
        <circle class="rg-hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="15" fill="transparent" />
        <circle class="rg-node risk-${e.riskLevel}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" />
        <text class="rg-label" x="${lx.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="${anchor}">${esc(trunc(e.title, 8))}</text>
      </g>`;
    })
    .join("");

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
      ${edges}${centerNode}${nodes}
    </svg>
    <div class="rg-preview" hidden></div>
    <div class="rg-legend" role="group" aria-label="依關聯型別篩選">
      <button type="button" class="rg-legend-btn" data-type="same-incident" aria-pressed="true"><i class="edge-same-incident"></i>跨源佐證</button>
      <button type="button" class="rg-legend-btn" data-type="same-entity" aria-pressed="true"><i class="edge-same-entity"></i>共享實體</button>
      <button type="button" class="rg-legend-btn" data-type="same-topic" aria-pressed="true"><i class="edge-same-topic"></i>同題情勢</button>
    </div>`;
}
