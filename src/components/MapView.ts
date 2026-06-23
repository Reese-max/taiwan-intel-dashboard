import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { IntelEvent, RiskLevel } from "../types/event";
import { esc } from "../utils/escape";

const RISK_COLOR: Record<RiskLevel, string> = {
  low: "#3b82f6",
  medium: "#eab308",
  high: "#f97316",
  critical: "#ef4444",
};
const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
// 聚合網格邊長（像素）：同網格內多個事件聚成一顆計數泡泡，避免市區大量標點重疊。
const CELL = 46;

// 危急／高風險標點加 class，由 CSS 套脈衝光暈動畫。
function markerClass(level: RiskLevel): string {
  if (level === "critical") return "mk mk-critical";
  if (level === "high") return "mk mk-high";
  return "mk";
}

export class MapView {
  private map: L.Map;
  private layer = L.layerGroup();
  private located: IntelEvent[] = [];

  constructor(el: HTMLElement) {
    this.map = L.map(el).setView([23.7, 121], 7);
    // 深色底圖（CartoDB dark_matter，免金鑰）以融入深色主題，風險色標點更突出。
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "© OpenStreetMap © CARTO",
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(this.map);
    this.layer.addTo(this.map);
    // 縮放改變重疊程度 → 縮放結束後重新聚合。
    this.map.on("zoomend", () => this.redraw());
    // 雷達掃描裝飾層（pointer-events:none，不擋地圖拖曳/縮放）。
    const radar = document.createElement("div");
    radar.className = "map-radar";
    radar.setAttribute("aria-hidden", "true");
    el.appendChild(radar);
  }

  render(events: IntelEvent[]): void {
    this.located = events.filter((e) => e.lat != null && e.lng != null);
    this.redraw();
    if (this.located.length) {
      const bounds = L.latLngBounds(this.located.map((e) => [e.lat!, e.lng!] as [number, number]));
      this.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 8 });
    }
  }

  private singleMarker(e: IntelEvent): L.CircleMarker {
    return L.circleMarker([e.lat!, e.lng!], {
      radius: 7,
      color: RISK_COLOR[e.riskLevel],
      fillColor: RISK_COLOR[e.riskLevel],
      fillOpacity: 0.7,
      weight: 2,
      className: markerClass(e.riskLevel),
    }).bindPopup(`<b>${esc(e.title)}</b><br>${esc(e.region)}｜${esc(e.category)}`);
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
      const icon = L.divIcon({
        html: `<div class="map-cluster risk-${top}" style="width:${size}px;height:${size}px">${n}</div>`,
        className: "",
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      L.marker(centroid, { icon, keyboard: false })
        .on("click", () => this.map.flyTo(centroid, Math.min(z + 2, 12)))
        .addTo(this.layer);
    }
  }
}
