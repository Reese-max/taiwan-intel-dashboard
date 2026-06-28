import "leaflet/dist/leaflet.css";
import type * as L from "leaflet";
import type { IntelEvent, RiskLevel } from "../types/event";
import { esc } from "../utils/escape";

const RISK_COLOR: Record<RiskLevel, string> = {
  low: "#3b82f6",
  medium: "#eab308",
  high: "#f97316",
  critical: "#ef4444",
};
const RISK_LABEL: Record<RiskLevel, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "危急",
};
const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
// 聚合網格邊長（像素）：同網格內多個事件聚成一顆計數泡泡，避免市區大量標點重疊。
const CELL = 46;

// 危急／高風險標點加 class，由 CSS 套脈衝光暈動畫。
export function markerClass(level: RiskLevel, event?: IntelEvent): string {
  const base = level === "critical" ? "mk mk-critical" : level === "high" ? "mk mk-high" : "mk";
  const confidence = event?.source.sourceConfidence ? ` source-${event.source.sourceConfidence}` : "";
  const precision = event?.locationPrecision ? ` loc-${event.locationPrecision}` : "";
  return `${base}${confidence}${precision}`;
}

function sourceDisplayName(e: IntelEvent): string {
  if (e.source.publisherName) return e.source.publisherName;
  if (e.source.aggregatorName) return `${e.source.aggregatorName} 聚合`;
  return e.source.name;
}

function locationPrecisionLabel(value: IntelEvent["locationPrecision"]): string {
  switch (value) {
    case "exact":
    case "address":
      return "精準位置";
    case "district":
      return "行政區推論";
    case "city":
      return "縣市推論";
    case "country":
      return "國家層級";
    case "global":
      return "全球概略";
    default:
      return "未知";
  }
}

export function eventFocusHash(e: IntelEvent): string {
  const params = new URLSearchParams();
  params.set("scope", e.scope);
  params.set("focus", e.id);
  return `#${params.toString()}`;
}

export function mapPopupHtml(e: IntelEvent): string {
  const via = e.source.aggregatorName
    ? `<br><span class="map-popup-warn">經由：${esc(e.source.aggregatorName)}，請點開原文確認</span>`
    : "";
  const loc = e.locationPrecision
    ? `<br><span class="map-popup-muted">定位：${esc(locationPrecisionLabel(e.locationPrecision))}</span>`
    : "";
  return `<b>${esc(e.title)}</b><br>${esc(e.region)}｜${esc(e.category)}<br>來源：${esc(sourceDisplayName(e))}${via}${loc}
    <br><a class="map-popup-action" href="${esc(eventFocusHash(e))}">查看關聯網 →</a>`;
}

export function clusterPopupHtml(events: IntelEvent[]): string {
  const shown = events
    .slice()
    .sort((a, b) => {
      const risk = RISK_RANK[b.riskLevel] - RISK_RANK[a.riskLevel];
      if (risk) return risk;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    })
    .slice(0, 6);
  const hidden = Math.max(0, events.length - shown.length);
  const items = shown
    .map(
      (e) => `<li>
        <span class="map-cluster-risk risk-${esc(e.riskLevel)}">${esc(RISK_LABEL[e.riskLevel])}</span>
        <span class="map-cluster-title">${esc(e.title)}</span>
        <span class="map-cluster-meta">${esc(e.region)}｜${esc(e.category)}｜來源：${esc(sourceDisplayName(e))}</span>
        <a class="map-cluster-action" href="${esc(eventFocusHash(e))}">查看</a>
      </li>`,
    )
    .join("");
  const more = hidden ? `<div class="map-cluster-more">另有 ${hidden} 則未列出，放大地圖可拆分重疊標點。</div>` : "";
  return `<div class="map-cluster-popup">
    <b>此區有 ${events.length} 則情報</b>
    <div class="map-cluster-hint">雙擊或放大地圖可拆分重疊標點；下列先顯示風險較高與較新的事件。</div>
    <ul>${items}</ul>
    ${more}
  </div>`;
}

export function isMapDisplayable(e: IntelEvent): boolean {
  return e.lat != null && e.lng != null && !(e.lat === 0 && e.lng === 0) && e.locationPrecision !== "global";
}

export class MapView {
  private lib!: typeof L;
  private map!: L.Map;
  private layer!: L.LayerGroup;
  private located: IntelEvent[] = [];
  private ready: Promise<void>;

  constructor(el: HTMLElement) {
    this.ready = this.init(el);
  }

  // Leaflet 動態載入：把 ~44KB JS 移出初始 bundle，地圖區塊就緒後才下載並建圖。
  private async init(el: HTMLElement): Promise<void> {
    const lib = ((await import("leaflet")) as unknown as { default: typeof L }).default;
    this.lib = lib;
    this.layer = lib.layerGroup();
    this.map = lib.map(el).setView([23.7, 121], 7);
    // 深色底圖（CartoDB dark_matter，免金鑰）以融入深色主題，風險色標點更突出。
    lib
      .tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "© OpenStreetMap © CARTO",
        subdomains: "abcd",
        maxZoom: 19,
      })
      .addTo(this.map);
    this.layer.addTo(this.map);
    // 縮放改變重疊程度 → 縮放結束後重新聚合。
    this.map.on("zoomend", () => this.redraw());
    // 雷達掃描裝飾層（pointer-events:none，不擋地圖拖曳/縮放）。
    const radar = document.createElement("div");
    radar.className = "map-radar";
    radar.setAttribute("aria-hidden", "true");
    el.appendChild(radar);
  }

  async render(events: IntelEvent[]): Promise<void> {
    this.located = events.filter(isMapDisplayable);
    await this.ready;
    this.redraw();
    if (this.located.length) {
      const bounds = this.lib.latLngBounds(
        this.located.map((e) => [e.lat!, e.lng!] as [number, number]),
      );
      this.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 8 });
    }
  }

  private singleMarker(e: IntelEvent): L.CircleMarker {
    return this.lib.circleMarker([e.lat!, e.lng!], {
      radius: 7,
      color: RISK_COLOR[e.riskLevel],
      fillColor: RISK_COLOR[e.riskLevel],
      fillOpacity: 0.7,
      weight: 2,
      className: markerClass(e.riskLevel, e),
    }).bindPopup(mapPopupHtml(e));
  }

  // 依目前 zoom 將鄰近事件聚成網格群：單一→風險點；多個→計數泡泡（點擊放大去聚合）。
  private redraw(): void {
    this.layer.clearLayers();
    const z = this.map.getZoom();
    const grid = new Map<string, { events: IntelEvent[]; sx: number; sy: number }>();
    for (const e of this.located) {
      const p = this.map.project([e.lat!, e.lng!], z);
      const key = `${Math.floor(p.x / CELL)}:${Math.floor(p.y / CELL)}`;
      let c = grid.get(key);
      if (!c) {
        c = { events: [], sx: 0, sy: 0 };
        grid.set(key, c);
      }
      c.events.push(e);
      c.sx += p.x;
      c.sy += p.y;
    }
    for (const c of grid.values()) {
      if (c.events.length === 1) {
        this.singleMarker(c.events[0]).addTo(this.layer);
        continue;
      }
      const n = c.events.length;
      const centroid = this.map.unproject([c.sx / n, c.sy / n], z);
      const top = c.events.reduce((a, b) => (RISK_RANK[b.riskLevel] > RISK_RANK[a.riskLevel] ? b : a)).riskLevel;
      const size = Math.min(48, 26 + Math.round(Math.log2(n) * 6));
      const icon = this.lib.divIcon({
        html: `<div class="map-cluster risk-${top}" style="width:${size}px;height:${size}px">${n}</div>`,
        className: "",
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      this.lib
        .marker(centroid, { icon, keyboard: false })
        .bindPopup(clusterPopupHtml(c.events), { maxWidth: 360 })
        .on("dblclick", () => {
          this.map.flyTo(centroid, Math.min(z + 2, 12));
        })
        .addTo(this.layer);
    }
  }
}
