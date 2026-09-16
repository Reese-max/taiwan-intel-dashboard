import type { IntelEvent } from "../types/event";

export interface LocationLink {
  href: string;
  label: string;
  description: string;
  kind: "coordinates" | "region";
}

const VAGUE_REGIONS = new Set([
  "", "全國", "未知", "不詳", "未提供", "—", "-", "全球", "國際", "海外",
  "unknown", "global", "worldwide", "n/a",
]);

type LocationInput = Pick<IntelEvent, "region" | "scope" | "lat" | "lng" | "locationPrecision">;

function hasValidCoordinates(e: LocationInput): boolean {
  return typeof e.lat === "number" && typeof e.lng === "number"
    && Number.isFinite(e.lat) && Number.isFinite(e.lng)
    && e.lat >= -90 && e.lat <= 90 && e.lng >= -180 && e.lng <= 180
    && !(e.lat === 0 && e.lng === 0);
}

/** 只使用既有位置欄位；不把縣市中心、新聞標題或推測地址當成案發點。 */
export function locationSearchLink(e: LocationInput): LocationLink | null {
  if (e.locationPrecision === "global") return null;
  const precise = e.locationPrecision === "exact" || e.locationPrecision === "address";
  if (precise && hasValidCoordinates(e)) {
    const params = new URLSearchParams({ api: "1", query: `${e.lat},${e.lng}` });
    return {
      href: `https://www.google.com/maps/search/?${params}`,
      label: "查看資料座標",
      description: "在 Google Maps 開啟資料提供的座標；定位精度仍以原始來源為準。",
      kind: "coordinates",
    };
  }
  const region = typeof e.region === "string" ? e.region.trim() : "";
  // 過長或未知位置不猜測、不截斷成另一個地點；控制 URL 長度。
  if (region.length > 160 || VAGUE_REGIONS.has(region.toLowerCase())) return null;
  const query = e.scope === "domestic" ? `臺灣 ${region}` : region;
  const params = new URLSearchParams({ api: "1", query });
  return {
    href: `https://www.google.com/maps/search/?${params}`,
    label: "查詢區域（非案發點）",
    description: `僅查詢資料中的區域「${region}」，不代表精確案發位置。`,
    kind: "region",
  };
}
