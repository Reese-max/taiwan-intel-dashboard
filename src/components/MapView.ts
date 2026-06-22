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

// 危急／高風險標點加 class，由 CSS 套脈衝光暈動畫。
function markerClass(level: RiskLevel): string {
  if (level === "critical") return "mk mk-critical";
  if (level === "high") return "mk mk-high";
  return "mk";
}

export class MapView {
  private map: L.Map;
  private layer = L.layerGroup();

  constructor(el: HTMLElement) {
    this.map = L.map(el).setView([23.7, 121], 7);
    // 深色底圖（CartoDB dark_matter，免金鑰）以融入深色主題，風險色標點更突出。
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "© OpenStreetMap © CARTO",
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(this.map);
    this.layer.addTo(this.map);
    // 雷達掃描裝飾層（pointer-events:none，不擋地圖拖曳/縮放）。
    const radar = document.createElement("div");
    radar.className = "map-radar";
    radar.setAttribute("aria-hidden", "true");
    el.appendChild(radar);
  }

  render(events: IntelEvent[]): void {
    this.layer.clearLayers();
    const located = events.filter((e) => e.lat != null && e.lng != null);
    for (const e of located) {
      L.circleMarker([e.lat!, e.lng!], {
        radius: 7,
        color: RISK_COLOR[e.riskLevel],
        fillColor: RISK_COLOR[e.riskLevel],
        fillOpacity: 0.7,
        weight: 2,
        className: markerClass(e.riskLevel),
      })
        .bindPopup(`<b>${esc(e.title)}</b><br>${esc(e.region)}｜${esc(e.category)}`)
        .addTo(this.layer);
    }
    if (located.length) {
      const bounds = L.latLngBounds(located.map((e) => [e.lat!, e.lng!] as [number, number]));
      this.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 8 });
    }
  }
}
