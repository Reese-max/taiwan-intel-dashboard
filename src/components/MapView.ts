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

export class MapView {
  private map: L.Map;
  private layer = L.layerGroup();

  constructor(el: HTMLElement) {
    this.map = L.map(el).setView([23.7, 121], 7);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 18,
    }).addTo(this.map);
    this.layer.addTo(this.map);
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
