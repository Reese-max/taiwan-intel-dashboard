import type { LocationPrecision, LocationRole, IntelEvent } from "../types/event";

export const EXACT_PRECISIONS = new Set<string>(["exact", "address"]);
export const LOW_PRECISIONS = new Set<string>(["district", "city", "county-center", "country", "global", "unknown"]);
export const INCIDENT_ROLES = new Set<string>(["incident", "arrest"]);
export const NON_INCIDENT_ROLES = new Set<string>(["agency", "mention", "impact_zone", "unknown"]);

export function isValidCoordinate(lat?: unknown, lng?: unknown): lat is number {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function isExactPrecision(precision?: string): boolean {
  return typeof precision === "string" && EXACT_PRECISIONS.has(precision.toLowerCase());
}

export function isLowPrecision(precision?: string): boolean {
  return typeof precision === "string" && LOW_PRECISIONS.has(precision.toLowerCase());
}

export function isIncidentRole(role?: string): boolean {
  return typeof role === "string" && INCIDENT_ROLES.has(role.toLowerCase());
}

export function isNonIncidentRole(role?: string): boolean {
  return typeof role === "string" && NON_INCIDENT_ROLES.has(role.toLowerCase());
}

/**
 * 判定事件是否具備進「案發地距離分群」的資格：
 * 1. 座標必須合法有限非 (0,0)
 * 2. 精度必須為 exact 或 address（排除 city / district / county-center / country 等推估中心）
 * 3. 地點角色必須為 incident 或 arrest（排除機關所在地 agency、僅提及 mention、未知 unknown）
 * 4. 舊測試或無標註資料若完全未帶 precision 與 role，容許以相容方式進行單純距離聚合，但不把已知 city / 角色不明當案發熱點。
 */
export function canClusterByDistance(event?: Partial<IntelEvent>): boolean {
  if (!event || !isValidCoordinate(event.lat, event.lng)) return false;
  if (isLowPrecision(event.locationPrecision)) return false;
  if (isNonIncidentRole(event.locationRole)) return false;
  if (isIncidentRole(event.locationRole)) return true;
  if (event.locationRole === "unknown") return false;
  if (isExactPrecision(event.locationPrecision)) {
    return event.locationRole === "incident" || event.locationRole === "arrest";
  }
  return event.locationPrecision === undefined && event.locationRole === undefined;
}

export function locationPrecisionLabel(precision?: LocationPrecision | string): string {
  switch (precision) {
    case "exact":
    case "address":
      return "精準位置";
    case "district":
      return "行政區推論";
    case "city":
      return "縣市推論";
    case "county-center":
      return "縣市中心推論";
    case "country":
      return "國家層級";
    case "global":
      return "全球概略";
    default:
      return "未知";
  }
}

export function locationRoleLabel(role?: LocationRole | string): string {
  switch (role) {
    case "incident":
      return "案發地";
    case "arrest":
      return "查獲／逮捕地";
    case "agency":
      return "機關／辦公處所";
    case "impact_zone":
      return "警戒／影響區域";
    case "mention":
      return "報導提及處所";
    case "unknown":
      return "角色未知";
    default:
      return "";
  }
}
