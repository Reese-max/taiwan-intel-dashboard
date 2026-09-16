import type { IntelEvent, Scope, RiskLevel, NewsAuthority } from "../types/event";
import { RISK_ORDER } from "../types/event";

export interface FilterOptions {
  scope?: Scope;
  category?: string;
  minRisk?: RiskLevel;
  source?: string;
  newsAuthority?: NewsAuthority;
  sinceDays?: number;
  now?: number;
  includeUnknownTime?: boolean;
}

export function filterEvents(events: IntelEvent[], opts: FilterOptions): IntelEvent[] {
  const now = typeof opts.now === "number" && Number.isFinite(opts.now) ? opts.now : Date.now();
  const cutoff = opts.sinceDays ? now - opts.sinceDays * 86400000 : undefined;
  const maxFuture = opts.sinceDays ? now + 86400000 : undefined;
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

    if (!cutoff) return true;

    const eventTime = e.timestamp ? Date.parse(e.timestamp) : NaN;
    if (!Number.isFinite(eventTime)) {
      return Boolean(opts.includeUnknownTime);
    }
    if (maxFuture && eventTime > maxFuture) return false;
    if (eventTime < cutoff) return false;
    return true;
  });
}

import { computeSha256Hex } from "../utils/sha256";
import type { CohortManifest } from "./manifest";

export interface LoadEventsOptions {
  manifest?: CohortManifest | null;
  expectedSha256?: string;
  url?: string;
  signal?: AbortSignal;
}

export async function loadEvents(scope: Scope, options?: LoadEventsOptions): Promise<IntelEvent[]> {
  const manifestFile = options?.manifest?.scopes?.[scope]?.events;
  const url = options?.url ?? (manifestFile ? `./data/${manifestFile}` : `./data/${scope}.json`);
  const expectedSha256 =
    options?.expectedSha256 ??
    (manifestFile
      ? options?.manifest?.files?.[manifestFile]?.sha256 || options?.manifest?.scopes?.[scope]?.sha256
      : undefined);

  const res = await fetch(url, { signal: options?.signal });
  if (!res.ok) throw new Error(`載入 ${scope}.json 失敗: ${res.status}`);
  if (typeof res.text === "function") {
    const text = await res.text();
    if (expectedSha256 && globalThis.crypto?.subtle) {
      const hash = await computeSha256Hex(text);
      if (hash && hash !== expectedSha256) {
        throw new Error(`事件資料 SHA-256 不符 (期望 ${expectedSha256}，實收 ${hash})`);
      }
    }
    return JSON.parse(text) as IntelEvent[];
  }
  return (await res.json()) as IntelEvent[];
}

// 地圖 first-paint 精簡點：只含可定位事件與地圖/篩選所需欄位，體積遠小於完整 <scope>.json，
// 讓地圖標點不必等完整事件即可先繪。載入失敗（如尚未產出或 hash 不符）回 null，呼叫端 fallback 至完整事件。
export async function loadMapEvents(scope: Scope, options?: LoadEventsOptions): Promise<IntelEvent[] | null> {
  const manifestFile = options?.manifest?.scopes?.[scope]?.map;
  const url = options?.url ?? (manifestFile ? `./data/${manifestFile}` : `./data/${scope}.map.json`);
  const expectedSha256 =
    options?.expectedSha256 ??
    (manifestFile ? options?.manifest?.files?.[manifestFile]?.sha256 : undefined);

  try {
    const res = await fetch(url, { signal: options?.signal });
    if (!res.ok) return null;
    if (typeof res.text === "function") {
      const text = await res.text();
      if (expectedSha256 && globalThis.crypto?.subtle) {
        const hash = await computeSha256Hex(text);
        if (hash && hash !== expectedSha256) {
          return null;
        }
      }
      return JSON.parse(text) as IntelEvent[];
    }
    return (await res.json()) as IntelEvent[];
  } catch {
    return null;
  }
}
