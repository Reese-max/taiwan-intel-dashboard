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
  region?: string;
  query?: string;
}

export function explainOutOfFilter(e: IntelEvent, opts: FilterOptions): string[] {
  const reasons: string[] = [];
  const now = typeof opts.now === "number" && Number.isFinite(opts.now) ? opts.now : Date.now();
  const cutoff = opts.sinceDays ? now - opts.sinceDays * 86400000 : undefined;
  const maxFuture = opts.sinceDays ? now + 86400000 : undefined;
  const targetRegion = opts.region ? opts.region.trim().replace(/^台(?=[北中南東])/, "臺") : "";

  if (opts.category && e.category !== opts.category) {
    reasons.push(`分類非「${opts.category}」`);
  }
  if (opts.minRisk && RISK_ORDER[e.riskLevel] < RISK_ORDER[opts.minRisk]) {
    reasons.push(`風險未達「${opts.minRisk}」`);
  }
  if (targetRegion) {
    const eReg = (e.region || "").trim().replace(/^台(?=[北中南東])/, "臺");
    if (!eReg || (eReg !== targetRegion && !eReg.includes(targetRegion) && !targetRegion.includes(eReg))) {
      reasons.push(`地點非「${opts.region}」`);
    }
  }
  const isOfficialPoliceNews =
    e.source.datasetId === "7505" ||
    (e.source.datasetId === "tw-news" && e.source.authority === "official");
  const isMediaPoliceNews = e.source.datasetId === "tw-news" && e.source.authority !== "official";
  if (opts.newsAuthority === "official" && !isOfficialPoliceNews) {
    reasons.push("來源非官方新聞");
  } else if (opts.newsAuthority === "media" && !isMediaPoliceNews) {
    reasons.push("來源非媒體新聞");
  }

  if (cutoff) {
    const eventTime = e.timestamp ? Date.parse(e.timestamp) : NaN;
    if (!Number.isFinite(eventTime)) {
      if (!opts.includeUnknownTime) reasons.push("時間未明");
    } else if (maxFuture && eventTime > maxFuture) {
      reasons.push("超過未來時間範圍");
    } else if (eventTime < cutoff) {
      reasons.push(`時間超出近 ${opts.sinceDays} 天`);
    }
  }
  if (opts.query) {
    const q = opts.query.toLowerCase();
    const title = (e.title || "").toLowerCase();
    const summary = (e.summary || "").toLowerCase();
    const region = (e.region || "").toLowerCase();
    if (!title.includes(q) && !summary.includes(q) && !region.includes(q)) {
      reasons.push(`未含關鍵字「${opts.query}」`);
    }
  }

  return reasons;
}

export function filterEvents(events: IntelEvent[], opts: FilterOptions): IntelEvent[] {
  const now = typeof opts.now === "number" && Number.isFinite(opts.now) ? opts.now : Date.now();
  const cutoff = opts.sinceDays ? now - opts.sinceDays * 86400000 : undefined;
  const maxFuture = opts.sinceDays ? now + 86400000 : undefined;
  const targetRegion = opts.region ? opts.region.trim().replace(/^台(?=[北中南東])/, "臺") : "";

  return events.filter((e) => {
    if (opts.scope && e.scope !== opts.scope) return false;
    if (opts.category && e.category !== opts.category) return false;
    if (opts.minRisk && RISK_ORDER[e.riskLevel] < RISK_ORDER[opts.minRisk]) return false;
    if (opts.source && e.source.name !== opts.source) return false;
    if (targetRegion) {
      const eReg = (e.region || "").trim().replace(/^台(?=[北中南東])/, "臺");
      if (!eReg) return false;
      if (eReg !== targetRegion && !eReg.includes(targetRegion) && !targetRegion.includes(eReg)) {
        return false;
      }
    }
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

// 地圖 first-paint 是效能最佳化，不是資料一致性的例外路徑。
// 呼叫端沒有先鎖定 manifest，或 manifest 沒有該 map 產物的 hash 時，一律跳過早繪，
// 交由後續已鎖定 cohort 的完整事件 refresh 繪圖，避免跨部署時短暫晉級舊快照。
export async function loadMapEvents(scope: Scope, options?: LoadEventsOptions): Promise<IntelEvent[] | null> {
  const manifest = options?.manifest;
  if (!manifest) return null;

  const manifestFile = manifest.scopes?.[scope]?.map;
  if (!manifestFile) return null;

  const expectedSha256 = options?.expectedSha256 ?? manifest.files?.[manifestFile]?.sha256;
  if (!expectedSha256) return null;

  const url = options?.url ?? `./data/${manifestFile}`;

  try {
    const res = await fetch(url, { signal: options?.signal });
    if (!res.ok) return null;
    if (typeof res.text === "function") {
      const text = await res.text();
      if (!globalThis.crypto?.subtle) return null;
      const hash = await computeSha256Hex(text);
      if (!hash || hash !== expectedSha256) {
        return null;
      }
      return JSON.parse(text) as IntelEvent[];
    }
    // 無法取得原始文字就無法驗證 manifest hash，因此 first-paint 不得晉級。
    return null;
  } catch {
    return null;
  }
}