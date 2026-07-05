import type { NetworkIndex } from "../data/network";
import type { IntelEvent } from "../types/event";

export interface CorroborationResult {
  sources: number;
  confirmed: boolean;
}

export function corroborationOf(
  eventId: string,
  byId: Map<string, IntelEvent>,
  net: NetworkIndex,
): CorroborationResult {
  const event = byId.get(eventId);
  if (!event) return { sources: 1, confirmed: false };

  const sources = new Set<string>([event.source.name]);
  for (const ref of net.related(eventId)) {
    if (ref.type !== "same-incident") continue;
    const related = byId.get(ref.id);
    if (related) sources.add(related.source.name);
  }

  return { sources: sources.size, confirmed: sources.size >= 2 };
}
