import type { IntelEvent } from "../types/event";
import { RISK_ORDER } from "../types/event";

export const TRIAGE_ACKED_KEY = "taiwan-intel-triage-acked";

export type TriageEvent = IntelEvent & { unread: boolean };

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

export function buildTriage(
  events: IntelEvent[],
  ackedIds: Set<string> | string[],
  nowMs: number,
  opts: { cap?: number } = {},
): TriageResult {
  void nowMs;
  const acked = ackedIds instanceof Set ? ackedIds : new Set(ackedIds);
  const cap = Math.max(0, opts.cap ?? 30);
  const sorted = events
    .filter(isElevated)
    .slice()
    .sort((a, b) => {
      const riskDelta = RISK_ORDER[b.riskLevel] - RISK_ORDER[a.riskLevel];
      if (riskDelta !== 0) return riskDelta;
      return timestampMs(b.timestamp) - timestampMs(a.timestamp);
    });
  const items = sorted.slice(0, cap).map((e) => ({ ...e, unread: !acked.has(e.id) }));

  return {
    items,
    unreadCount: sorted.filter((e) => !acked.has(e.id)).length,
    total: sorted.length,
    capped: Math.max(0, sorted.length - items.length),
  };
}

export function loadTriageAcked(storage: Storage = localStorage): Set<string> {
  try {
    const raw = storage.getItem(TRIAGE_ACKED_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveTriageAcked(ackedIds: Set<string> | string[], storage: Storage = localStorage): void {
  try {
    storage.setItem(TRIAGE_ACKED_KEY, JSON.stringify([...(ackedIds instanceof Set ? ackedIds : new Set(ackedIds))]));
  } catch {
    // localStorage 可能因隱私模式或容量限制失敗；收件匣仍可在本次 render 中運作。
  }
}
