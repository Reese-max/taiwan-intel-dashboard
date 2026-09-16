import type { IntelEvent } from "../types/event";
import { isValidCoordinate, isExactPrecision, locationRoleLabel } from "./geoPolicy";

export interface LocationLink {
  href: string;
  label: string;
  description: string;
  kind: "coordinates" | "region";
}

export const VAGUE_REGIONS = new Set([
  "", "全國", "未知", "不詳", "未提供", "—", "-", "全球", "國際", "海外",
  "unknown", "global", "worldwide", "n/a",
]);

type LocationInput = Pick<IntelEvent, "region" | "scope" | "lat" | "lng" | "locationPrecision"> &
  Partial<Pick<IntelEvent, "locationRole">>;

/** 只使用既有位置欄位；不把縣市中心、新聞標題或推測地址當成案發點。 */
export function locationSearchLink(e: LocationInput): LocationLink | null {
  if (e.locationPrecision === "global") return null;
  const precise = isExactPrecision(e.locationPrecision);
  if (precise && isValidCoordinate(e.lat, e.lng)) {
    const params = new URLSearchParams({ api: "1", query: `${e.lat},${e.lng}` });
    const roleSuffix = e.locationRole ? `（${locationRoleLabel(e.locationRole)}）` : "";
    return {
      href: `https://www.google.com/maps/search/?${params}`,
      label: "查看資料座標",
      description: `在 Google Maps 開啟資料提供的座標${roleSuffix}；定位精度仍以原始來源為準。`,
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
