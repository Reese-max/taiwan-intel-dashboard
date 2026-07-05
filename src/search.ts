import type { IntelEvent } from "./types/event";
import type { NetworkIndex } from "./data/network";

export function applySearchSubnet(events: IntelEvent[], net: NetworkIndex, query?: string): IntelEvent[] {
  const q = query?.trim().toLocaleLowerCase("zh-TW");
  if (!q) return events;
  const available = new Set(events.map((e) => e.id));
  const ids = new Set<string>();
  for (const e of events) {
    const hay = `${e.title} ${e.summary} ${e.region} ${e.category} ${e.source.name}`.toLocaleLowerCase("zh-TW");
    if (!hay.includes(q)) continue;
    ids.add(e.id);
    for (const r of net.related(e.id)) if (available.has(r.id)) ids.add(r.id);
  }
  return events.filter((e) => ids.has(e.id));
}
