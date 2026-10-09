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
import { loadManifest, type CohortManifest } from "./manifest";

// 事件檔也可能較大（數 MB），給較寬鬆上限；重點是「有界」——永不 settle 的回應
// 不能永久佔住 main.ts 的 cohortPairInflight 去重快取，否則連手動重試都失效。
export const EVENTS_FETCH_TIMEOUT_MS = 20_000;

export interface LoadEventsOptions {
  manifest?: CohortManifest | null;
  expectedSha256?: string;
  url?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function eventsFetchSignal(options?: LoadEventsOptions): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(options?.timeoutMs ?? EVENTS_FETCH_TIMEOUT_MS);
  const caller = options?.signal;
  if (!caller) return timeoutSignal;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([caller, timeoutSignal]);
  // 無 AbortSignal.any 的環境：手動合併，不能為了相容而丟掉逾時（否則不回應的請求仍會永久佔住）。
  if (caller.aborted) return caller;
  if (timeoutSignal.aborted) return timeoutSignal;
  const controller = new AbortController();
  const relay = (source: AbortSignal) => () => controller.abort(source.reason);
  caller.addEventListener("abort", relay(caller), { once: true });
  timeoutSignal.addEventListener("abort", relay(timeoutSignal), { once: true });
  return controller.signal;
}

export async function loadEvents(scope: Scope, options?: LoadEventsOptions): Promise<IntelEvent[]> {
  const manifestFile = options?.manifest?.scopes?.[scope]?.events;
  const url = options?.url ?? (manifestFile ? `./data/${manifestFile}` : `./data/${scope}.json`);
  const expectedSha256 =
    options?.expectedSha256 ??
    (manifestFile
      ? options?.manifest?.files?.[manifestFile]?.sha256 || options?.manifest?.scopes?.[scope]?.sha256
      : undefined);
  if (options?.manifest && !expectedSha256) throw new Error("事件資料缺少 SHA-256，無法驗證");

  const res = await fetch(url, { signal: eventsFetchSignal(options) });
  if (!res.ok) throw new Error(`載入 ${scope}.json 失敗: ${res.status}`);
  if (typeof res.text === "function") {
    const text = await res.text();
    if (expectedSha256) {
      const hash = await computeSha256Hex(text);
      if (!hash) throw new Error("事件資料 SHA-256 無法驗證");
      if (hash !== expectedSha256) {
        throw new Error(`事件資料 SHA-256 不符 (期望 ${expectedSha256}，實收 ${hash})`);
      }
    }
    return JSON.parse(text) as IntelEvent[];
  }
  if (expectedSha256) throw new Error("事件資料 SHA-256 無法驗證");
  return (await res.json()) as IntelEvent[];
}

// 地圖 first-paint 是效能最佳化，不是資料一致性的例外路徑。
// 低階入口也須先鎖定 manifest 及具名 map；缺少任一契約即回 null，交由完整 refresh 補繪。
export async function loadMapEvents(scope: Scope, options?: LoadEventsOptions): Promise<IntelEvent[] | null> {
  const manifest = options?.manifest;
  if (!manifest) return null;

  const manifestFile = manifest.scopes?.[scope]?.map;
  if (!manifestFile) return null;

  const expectedSha256 = options?.expectedSha256 ?? manifest.files?.[manifestFile]?.sha256;
  if (!expectedSha256) return null;
  const url = options?.url ?? `./data/${manifestFile}`;

  try {
    const res = await fetch(url, { signal: eventsFetchSignal(options) });
    if (!res.ok) return null;
    if (typeof res.text === "function") {
      const text = await res.text();
      if (expectedSha256) {
        const hash = await computeSha256Hex(text);
        if (!hash || hash !== expectedSha256) return null;
      }
      return JSON.parse(text) as IntelEvent[];
    }
    if (expectedSha256) return null;
    return (await res.json()) as IntelEvent[];
  } catch {
    return null;
  }
}

export interface FirstPaintMapOptions {
  // 已鎖定的 manifest；給 undefined 才會走 fetchManifest/loadManifest 取得。
  manifest?: CohortManifest | null;
  // 呼叫端可注入共享的 manifest 抓取（如 createManifestLoader），避免開機重複請求。
  fetchManifest?: () => Promise<CohortManifest | null>;
  signal?: AbortSignal;
}

export interface FirstPaintMapResult {
  events: IntelEvent[];
  // 實際用於驗證的 manifest —— 呼叫端須核對其 snapshotId 仍為目前鎖定版本才晉級。
  manifest: CohortManifest;
}

// 地圖 first-paint 的同版鎖定入口：必須先取得 cohort manifest，精簡點位檔以其具名檔案＋
// SHA-256 驗證後才允許早繪。manifest 缺失、檔案 404、缺 hash 或 hash 不符一律回 null
// （fail-closed，不晉級未驗證產物），呼叫端等完整 refresh 以已驗證的同版資料繪製。
export async function loadFirstPaintMapEvents(
  scope: Scope,
  options?: FirstPaintMapOptions,
): Promise<FirstPaintMapResult | null> {
  const manifest =
    options?.manifest !== undefined
      ? options.manifest
      : options?.fetchManifest
        ? await options.fetchManifest()
        : await loadManifest({ signal: options?.signal });
  if (!manifest) return null;
  const events = await loadMapEvents(scope, { manifest, signal: options?.signal });
  if (!events) return null;
  return { events, manifest };
}
