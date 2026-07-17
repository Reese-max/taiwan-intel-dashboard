import type { IntelEvent, Scope, RiskLevel, NewsAuthority } from "../types/event";
import { RISK_ORDER } from "../types/event";

export interface FilterOptions {
  scope?: Scope;
  category?: string;
  minRisk?: RiskLevel;
  source?: string;
  newsAuthority?: NewsAuthority;
  sinceDays?: number;
}

export function filterEvents(events: IntelEvent[], opts: FilterOptions): IntelEvent[] {
  const cutoff = opts.sinceDays ? Date.now() - opts.sinceDays * 86400000 : undefined;
  const maxFuture = opts.sinceDays ? Date.now() + 86400000 : undefined;
  return events.filter((e) => {
    if (opts.scope && e.scope !== opts.scope) return false;
    if (opts.category && e.category !== opts.category) return false;
    if (opts.minRisk && RISK_ORDER[e.riskLevel] < RISK_ORDER[opts.minRisk]) return false;
    if (opts.source && e.source.name !== opts.source) return false;
    const isOfficialPoliceNews =
      e.source.datasetId === "7505" ||
      (e.source.datasetId === "tw-news" && e.source.authority === "official");
    const isMediaPoliceNews = e.source.datasetId === "tw-news" && e.source.authority !== "official";
    if (opts.newsAuthority === "official" && !isOfficialPoliceNews) return false;
    if (opts.newsAuthority === "media" && !isMediaPoliceNews) return false;
    const eventTime = new Date(e.timestamp).getTime();
    if (Number.isFinite(eventTime)) {
      if (maxFuture && eventTime > maxFuture) return false;
      if (cutoff && eventTime < cutoff) return false;
    }
    return true;
  });
}

export async function loadEvents(scope: Scope): Promise<IntelEvent[]> {
  const res = await fetch(`./data/${scope}.json`);
  if (!res.ok) throw new Error(`載入 ${scope}.json 失敗: ${res.status}`);
  return (await res.json()) as IntelEvent[];
}

// 地圖 first-paint 精簡點：只含可定位事件與地圖/篩選所需欄位，體積遠小於完整 <scope>.json，
// 讓地圖標點不必等完整事件即可先繪。載入失敗（如尚未產出）回 null，呼叫端 fallback 至完整事件。
export async function loadMapEvents(scope: Scope): Promise<IntelEvent[] | null> {
  try {
    const res = await fetch(`./data/${scope}.map.json`);
    if (!res.ok) return null;
    return (await res.json()) as IntelEvent[];
  } catch {
    return null;
  }
}
