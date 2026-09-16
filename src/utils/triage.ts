import type { IntelEvent } from "../types/event";
import { RISK_ORDER } from "../types/event";
import { filterEvents } from "../data/loader";
import type { NetworkIndex } from "../data/network";
import { applySearchSubnet } from "../search";
import type { AppState } from "../store";

export const TRIAGE_ACKED_KEY = "taiwan-intel-triage-acked";

export type TriageEvent = IntelEvent & { unread: boolean };

export function filterTriageEvents(events: IntelEvent[], state: AppState, net: NetworkIndex): IntelEvent[] {
  return applySearchSubnet(filterEvents(events, state), net, state.query);
}

export interface TriageResult {
  items: TriageEvent[];
  unreadCount: number;
  total: number;
  capped: number;
}

function isElevated(e: IntelEvent): boolean {
  return e.riskLevel === "critical" || e.riskLevel === "high";
}

function timestampMs(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

export type TriageSortMode = "default" | "unread-first" | "unread-only";

export interface BuildTriageOptions {
  cap?: number;
  mode?: TriageSortMode;
}

export interface SaveTriageResult {
  ok: boolean;
  error?: string;
}

export function buildTriage(
  events: IntelEvent[],
  ackedIds: Set<string> | string[],
  nowMs: number,
  opts: BuildTriageOptions = {},
): TriageResult {
  void nowMs;
  const acked = ackedIds instanceof Set ? ackedIds : new Set(ackedIds);
  const cap = Math.max(0, opts.cap ?? 30);
  const mode = opts.mode ?? "default";

  const elevated = events.filter(isElevated);
  const total = elevated.length;
  const unreadCount = elevated.filter((e) => !acked.has(e.id)).length;

  let pool: IntelEvent[];
  if (mode === "unread-only") {
    pool = elevated.filter((e) => !acked.has(e.id));
  } else {
    pool = elevated.slice();
  }

  pool.sort((a, b) => {
    // 1. 保留風險優先（critical 優先於 high），不讓低風險未讀壓過高風險
    const riskDelta = RISK_ORDER[b.riskLevel] - RISK_ORDER[a.riskLevel];
    if (riskDelta !== 0) return riskDelta;

    // 2. 若為未讀優先模式，同風險下未讀優先於已讀
    if (mode === "unread-first") {
      const aUnread = !acked.has(a.id);
      const bUnread = !acked.has(b.id);
      if (aUnread !== bUnread) return (bUnread ? 1 : 0) - (aUnread ? 1 : 0);
    }

    // 3. 同順位下 timestamp 由新至舊
    return timestampMs(b.timestamp) - timestampMs(a.timestamp);
  });

  const items = pool.slice(0, cap).map((e) => ({ ...e, unread: !acked.has(e.id) }));

  return {
    items,
    unreadCount,
    total,
    capped: Math.max(0, pool.length - items.length),
  };
}

export function loadTriageAcked(storage: Storage = localStorage): Set<string> {
  try {
    const raw = storage.getItem(TRIAGE_ACKED_KEY);
    if (!raw) return new Set();
    const ids = JSON.parse(raw);
    if (!Array.isArray(ids)) return new Set();
    return new Set(
      ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0),
    );
  } catch {
    return new Set();
  }
}

export function saveTriageAcked(
  ackedIds: Set<string> | string[],
  storage: Storage = localStorage,
): SaveTriageResult {
  try {
    const list = [...(ackedIds instanceof Set ? ackedIds : new Set(ackedIds))];
    storage.setItem(TRIAGE_ACKED_KEY, JSON.stringify(list));
    return { ok: true };
  } catch (err) {
    // localStorage 可能因隱私模式、無痕、或容量限制被拒
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
