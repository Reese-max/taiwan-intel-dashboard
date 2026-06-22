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

function angle(i: number, n: number): number {
  return (-90 + (i * 360) / n) * (Math.PI / 180);
}

function trunc(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
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
      const tip = `${edgeTypeLabel(n.rel.type)}（強度 ${n.rel.weight.toFixed(1)}）${n.rel.why ? `｜${n.rel.why}` : ""}`;
      return `<line class="rg-edge edge-${n.rel.type}" x1="${CX}" y1="${CY}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke-width="${sw}"><title>${esc(tip)}</title></line>`;
    })
    .join("");

  const nodes = placed
    .map(({ n, x, y, right }) => {
      const lx = x + (right ? 11 : -11);
      const anchor = right ? "start" : "end";
      const tip = `${n.event.title}\n${edgeTypeLabel(n.rel.type)}${n.rel.why ? `：${n.rel.why}` : ""}`;
      return `<g class="rg-node-g" data-rel="${esc(n.event.id)}" tabindex="0" role="button" aria-label="${esc(n.event.title)}">
        <title>${esc(tip)}</title>
        <circle class="rg-node risk-${n.event.riskLevel}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" />
        <text class="rg-label" x="${lx.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="${anchor}">${esc(trunc(n.event.title, 7))}</text>
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
    <svg class="rg-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="關聯網圖：點節點可聚焦該情報">
      ${edges}${centerNode}${nodes}
    </svg>
    <div class="rg-legend">
      <span><i class="edge-same-incident"></i>跨源佐證</span>
      <span><i class="edge-same-entity"></i>共享實體</span>
      <span><i class="edge-same-topic"></i>同題情勢</span>
    </div>`;
}
