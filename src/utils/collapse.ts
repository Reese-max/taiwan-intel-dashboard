import type { NetworkIndex } from "../data/network";
import type { IntelEvent } from "../types/event";
import { RISK_ORDER } from "../types/event";

export interface CollapsedGroup {
  representative: IntelEvent;
  members: IntelEvent[];
  sourceCount: number;
}

function timeValue(e: IntelEvent): number {
  const t = new Date(e.timestamp).getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

function betterRepresentative(a: IntelEvent, b: IntelEvent, originalIndex: Map<string, number>): IntelEvent {
  const riskDelta = RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel];
  if (riskDelta !== 0) return riskDelta > 0 ? a : b;
  const timeDelta = timeValue(a) - timeValue(b);
  if (timeDelta !== 0) return timeDelta > 0 ? a : b;
  return (originalIndex.get(a.id) ?? 0) <= (originalIndex.get(b.id) ?? 0) ? a : b;
}

export function collapseSameIncident(events: IntelEvent[], net: NetworkIndex): CollapsedGroup[] {
  const byId = new Map(events.map((e) => [e.id, e] as const));
  const originalIndex = new Map(events.map((e, i) => [e.id, i] as const));
  const visited = new Set<string>();
  const groups: CollapsedGroup[] = [];

  for (const seed of events) {
    if (visited.has(seed.id)) continue;

    const stack = [seed.id];
    const ids: string[] = [];
    visited.add(seed.id);

    while (stack.length > 0) {
      const id = stack.pop()!;
      ids.push(id);

      for (const ref of net.related(id)) {
        if (ref.type !== "same-incident" || visited.has(ref.id) || !byId.has(ref.id)) continue;
        visited.add(ref.id);
        stack.push(ref.id);
      }
    }

    const component = ids.map((id) => byId.get(id)!);
    const representative = component.reduce((best, e) => betterRepresentative(best, e, originalIndex));
    const rest = component
      .filter((e) => e.id !== representative.id)
      .sort((a, b) => {
        const timeDelta = timeValue(b) - timeValue(a);
        if (timeDelta !== 0) return timeDelta;
        return (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0);
      });

    groups.push({
      representative,
      members: [representative, ...rest],
      sourceCount: new Set(component.map((e) => e.source.name)).size,
    });
  }

  return groups.sort(
    (a, b) => (originalIndex.get(a.representative.id) ?? 0) - (originalIndex.get(b.representative.id) ?? 0),
  );
}
