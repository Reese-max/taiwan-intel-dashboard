import type { IntelEvent, Scope, RiskLevel } from "../types/event";
import { RISK_ORDER } from "../types/event";

export interface FilterOptions {
  scope?: Scope;
  category?: string;
  minRisk?: RiskLevel;
  source?: string;
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
