import "leaflet/dist/leaflet.css";
import type * as L from "leaflet";
import type { IntelEvent, RiskLevel, Scope } from "../types/event";
import { esc } from "../utils/escape";
import { getActionDecision } from "../utils/actionDecision";

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
const TAIWAN_BBOX = { minLat: 21.9, maxLat: 26.3, minLng: 118.1, maxLng: 122.1 };

interface MapViewOptions {
  onFocus?: (eventId: string) => void;
  onShowList?: () => void;
}

interface RenderOptions {
  fit?: boolean;
}

export type MapDisplayable = IntelEvent & { lat: number; lng: number };

function throttle<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let last = 0;
  let timer: number | undefined;
  return ((...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = ms - (now - last);
    if (remaining <= 0) {
      window.clearTimeout(timer);
      timer = undefined;
      last = now;
      fn(...args);
      return;
    }
    if (timer === undefined) {
      timer = window.setTimeout(() => {
        last = Date.now();
        timer = undefined;
        fn(...args);
      }, remaining);
    }
  }) as T;
}

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
  const decision = getActionDecision(e);
  const via = e.source.aggregatorName
    ? `<br><span class="map-popup-warn">經由：${esc(e.source.aggregatorName)}，請點開原文確認</span>`
    : "";
  const loc = e.locationPrecision
    ? `<br><span class="map-popup-muted">定位：${esc(locationPrecisionLabel(e.locationPrecision))}</span>`
    : "";
  return `<b>${esc(e.title)}</b><br>${esc(e.region)}｜${esc(e.category)}<br>來源：${esc(sourceDisplayName(e))}
    <br><span class="map-popup-decision">建議：${esc(decision.recommendation)}｜${esc(decision.status)}</span>
    ${via}${loc}<br><a class="map-popup-action map-focus-btn" data-map-focus="${esc(e.id)}" href="${esc(eventFocusHash(e))}">查看關聯網 →</a>`;
}

export function clusterPopupHtml(events: IntelEvent[]): string {
  const shown = events
    .slice()
    .sort((a, b) => {
      const risk = RISK_RANK[b.riskLevel] - RISK_RANK[a.riskLevel];
      if (risk) return risk;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    })
    .slice(0, 3);
  const hidden = Math.max(0, events.length - shown.length);
  const primary = shown[0];
  const riskSummary = (["critical", "high", "medium", "low"] as RiskLevel[])
    .map((risk) => {
      const count = events.filter((e) => e.riskLevel === risk).length;
      return count ? `<span class="map-cluster-stat risk-${esc(risk)}">${esc(RISK_LABEL[risk])} ${count}</span>` : "";
    })
    .join("");
  const items = shown
      .map(
        (e) => `<li>
        <span class="map-cluster-risk risk-${esc(e.riskLevel)}">${esc(RISK_LABEL[e.riskLevel])}</span>
        <span class="map-cluster-title">${esc(e.title)}</span>
        <span class="map-cluster-meta">${esc(e.region)}｜${esc(e.category)}</span>
        <a class="map-cluster-action map-focus-btn" data-map-focus="${esc(e.id)}" href="${esc(eventFocusHash(e))}">查看</a>
        </li>`,
      )
      .join("");
  const primaryAction = primary
    ? `<a class="map-cluster-action map-focus-btn" data-map-focus="${esc(primary.id)}" href="${esc(eventFocusHash(primary))}">查看最高風險</a>`
    : "";
  const more = hidden ? `<div class="map-cluster-more">另有 ${hidden} 則，放大後再拆讀。</div>` : "";
  return `<div class="map-cluster-popup">
    <b>此區有 ${events.length} 則情報</b>
    <div class="map-cluster-summary" aria-label="此區風險構成">${riskSummary}</div>
    <div class="map-cluster-actions">
      <button class="map-cluster-action map-cluster-zoom" type="button">放大拆分</button>
      ${primaryAction}
    </div>
    <ul>${items}</ul>
    ${more}
  </div>`;
}

export function isMapDisplayable(e: IntelEvent): e is MapDisplayable {
  return e.lat != null && e.lng != null && !(e.lat === 0 && e.lng === 0) && e.locationPrecision !== "global";
}

export function mapEmptyLabel(totalEvents: number, locatedEvents: number): string {
  if (locatedEvents > 0) return "";
  if (totalEvents > 0) return "這批事件缺少可標示座標，請改看列表或放寬地理條件。";
  return "目前條件沒有可標示的地圖點，請改看列表或放寬篩選。";
}

function isInsideTaiwanBBox(e: MapDisplayable): boolean {
  return (
    e.lat >= TAIWAN_BBOX.minLat &&
    e.lat <= TAIWAN_BBOX.maxLat &&
    e.lng >= TAIWAN_BBOX.minLng &&
    e.lng <= TAIWAN_BBOX.maxLng
  );
}

export class MapView {
  private lib!: typeof L;
  private map!: L.Map;
  private layer!: L.LayerGroup;
  private located: MapDisplayable[] = [];
  private _cachedEvents: IntelEvent[] | null = null;
  private _cachedLocated: MapDisplayable[] = [];
  private ready: Promise<void>;
  private onFocus?: (eventId: string) => void;
  private onShowList?: () => void;
  private popupOpen = false;
  private emptyEl?: HTMLElement;
  private lastScope: Scope = "domestic";

  constructor(el: HTMLElement, options: MapViewOptions = {}) {
    this.ready = this.init(el);
    this.onFocus = options.onFocus;
    this.onShowList = options.onShowList;
  }

  // Leaflet 動態載入：把 ~44KB JS 移出初始 bundle，地圖區塊就緒後才下載並建圖。
  private async init(el: HTMLElement): Promise<void> {
    const lib = ((await import("leaflet")) as unknown as { default: typeof L }).default;
    this.lib = lib;
    this.layer = lib.layerGroup();
    this.map = lib.map(el, { preferCanvas: true }).setView([23.7, 121], 7);
    // 深色底圖（CartoDB dark_matter，免金鑰）以融入深色主題，風險色標點更突出。
    lib
      .tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "© OpenStreetMap © CARTO",
        subdomains: "abcd",
        maxZoom: 19,
      })
      .addTo(this.map);
    this.layer.addTo(this.map);
    // 平移/縮放改變可見範圍與重疊程度 → 結束後依視口重新聚合（moveend 涵蓋 pan + zoom）。
    this.map.on(
      "moveend",
      throttle(() => {
        if (!this.popupOpen) this.redraw();
      }, 150),
    );
    this.map.on("popupopen", () => {
      this.popupOpen = true;
    });
    this.map.on("popupclose", () => {
      this.popupOpen = false;
      this.redraw();
    });
    // 雷達掃描裝飾層（pointer-events:none，不擋地圖拖曳/縮放）。
    const radar = document.createElement("div");
    radar.className = "map-radar";
    radar.setAttribute("aria-hidden", "true");
    el.appendChild(radar);
    const empty = document.createElement("div");
    empty.className = "map-empty-hint";
    empty.setAttribute("role", "status");
    empty.hidden = true;
    el.appendChild(empty);
    this.emptyEl = empty;

    el.addEventListener("click", (ev) => {
      const target = (ev.target as HTMLElement).closest<HTMLElement>(".map-focus-btn[data-map-focus]");
      if (!target) return;
      ev.preventDefault();
      const id = target.dataset.mapFocus;
      if (id && this.onFocus) this.onFocus(id);
    });
  }

  async resize(): Promise<void> {
    await this.ready;
    this.map.invalidateSize(true);
    this.redraw();
  }

  async reveal(): Promise<void> {
    await this.ready;
    this.map.invalidateSize(true);
    if (!this.popupOpen) this.fitToLocated(this.lastScope);
    this.redraw();
  }

  async closePopup(): Promise<void> {
    await this.ready;
    this.popupOpen = false;
    this.map.closePopup();
  }

  async render(events: IntelEvent[], scope: Scope = events[0]?.scope ?? "domestic", options: RenderOptions = {}): Promise<void> {
    if (events === this._cachedEvents) {
      this.located = this._cachedLocated;
    } else {
      this._cachedEvents = events;
      this._cachedLocated = events.filter(isMapDisplayable);
      this.located = this._cachedLocated;
    }
    await this.ready;
    this.lastScope = scope;
    this.updateEmptyHint(events.length);
    const shouldFit = options.fit !== false;
    if (shouldFit) this.fitToLocated(scope);
    this.redraw();
  }

  private fitToLocated(scope: Scope): void {
    const taiwanBounds = this.lib.latLngBounds([
      [TAIWAN_BBOX.minLat, TAIWAN_BBOX.minLng],
      [TAIWAN_BBOX.maxLat, TAIWAN_BBOX.maxLng],
    ]);
    this.map.setMaxBounds(scope === "domestic" ? taiwanBounds.pad(0.5) : undefined);
    const fitLocated = scope === "domestic" ? this.located.filter(isInsideTaiwanBBox) : this.located;
    if (fitLocated.length) {
      const bounds = this.lib.latLngBounds(
        fitLocated.map((e) => [e.lat!, e.lng!] as [number, number]),
      );
      // 先（無動畫）對齊視口、再 redraw：視口裁切只渲染可見範圍，若先 redraw 再 fitBounds，
      // 切換 scope 或在手機隱藏地圖分頁套篩選時，標點會被舊視口剪掉而看不到。
      this.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 8, animate: false });
    } else if (scope === "domestic") {
      this.map.setView([23.7, 121], 7, { animate: false });
    }
  }

  private updateEmptyHint(totalEvents: number): void {
    if (!this.emptyEl) return;
    const label = mapEmptyLabel(totalEvents, this.located.length);
    this.emptyEl.hidden = !label;
    this.emptyEl.replaceChildren();
    if (!label) return;
    const text = document.createElement("span");
    text.textContent = label;
    this.emptyEl.appendChild(text);
    if (this.onShowList) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "看列表";
      button.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.onShowList?.();
      });
      this.emptyEl.appendChild(button);
    }
  }

  private singleMarker(e: IntelEvent): L.CircleMarker {
    const marker = this.lib.circleMarker([e.lat!, e.lng!], {
      radius: 7,
      color: RISK_COLOR[e.riskLevel],
      fillColor: RISK_COLOR[e.riskLevel],
      fillOpacity: 0.7,
      weight: 2,
      className: markerClass(e.riskLevel, e),
    }).bindPopup(mapPopupHtml(e));
    marker.on("click", () => {
      this.popupOpen = true;
    });
    return marker;
  }

  private attachClusterPopupHandlers(marker: L.Marker, centroid: L.LatLng): void {
    const openPopup = (ev?: Event): void => {
      ev?.preventDefault();
      ev?.stopPropagation();
      this.popupOpen = true;
      this.map.getContainer().scrollIntoView({ block: "center", inline: "nearest" });
      this.map.panTo(marker.getLatLng(), { animate: false });
      marker.openPopup();
    };
    marker.on("mousedown", () => {
      this.popupOpen = true;
    });
    marker.on("click", () => openPopup());
    marker.on("popupopen", () => {
      const popupEl = marker.getPopup()?.getElement();
      const zoomBtn = popupEl?.querySelector<HTMLButtonElement>(".map-cluster-zoom");
      if (!zoomBtn) return;
      zoomBtn.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.popupOpen = false;
        marker.closePopup();
        this.map.flyTo(centroid, Math.min(this.map.getZoom() + 2, 12));
      };
    });
    const el = marker.getElement();
    const cluster = el?.querySelector<HTMLElement>(".map-cluster");
    const hit = el?.querySelector<HTMLElement>(".map-cluster-hit");
    cluster?.addEventListener("click", openPopup);
    hit?.addEventListener("click", openPopup);
    cluster?.addEventListener("touchstart", () => {
      this.popupOpen = true;
    }, { passive: true });
    hit?.addEventListener("touchstart", () => {
      this.popupOpen = true;
    }, { passive: true });
    cluster?.addEventListener("touchend", openPopup);
    hit?.addEventListener("touchend", openPopup);
  }

  // 依目前 zoom 將鄰近事件聚成網格群：單一→風險點；多個→計數泡泡（點擊放大去聚合）。
  private redraw(): void {
    this.layer.clearLayers();
    const z = this.map.getZoom();
    // 視口裁切：只聚合/渲染目前可見範圍（含 20% 邊距，讓小幅平移前邊緣標點已在）內的事件；
    // 縮放越深、跳過的離畫面事件越多。moveend 已掛重繪 → 平移後補上新視口標點。
    const bounds = this.map.getBounds().pad(0.2);
    const grid = new Map<string, { events: IntelEvent[]; sx: number; sy: number }>();
    for (const e of this.located) {
      if (!bounds.contains([e.lat, e.lng])) continue;
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
      const hitSize = Math.max(48, size + 10);
      const icon = this.lib.divIcon({
        html: `<div class="map-cluster-hit" style="width:${hitSize}px;height:${hitSize}px"><div class="map-cluster risk-${top}" style="width:${size}px;height:${size}px">${n}</div></div>`,
        className: "",
        iconSize: [hitSize, hitSize],
        iconAnchor: [hitSize / 2, hitSize / 2],
      });
      const marker = this.lib.marker(centroid, { icon, keyboard: false }).bindPopup(clusterPopupHtml(c.events), { maxWidth: 360 });
      marker.on("dblclick", () => {
        this.map.flyTo(centroid, Math.min(z + 2, 12));
      });
      marker.addTo(this.layer);
      this.attachClusterPopupHandlers(marker, centroid);
    }
  }
}
