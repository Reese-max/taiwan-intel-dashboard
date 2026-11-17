import type { IntelEvent } from "./types/event";
import type { NetworkIndex } from "./data/network";
import { parseSearchQuery, searchMismatch } from "./search-query";

export function applySearchSubnet(events: IntelEvent[], net: NetworkIndex, query?: string): IntelEvent[] {
  if (!query?.trim()) return events;
  const parsed = parseSearchQuery(query);
  const now = Date.now();
  const eligible = events.filter(e => searchMismatch(e, parsed, now) !== "time");
  if (!parsed.groups.length) return eligible;
  const available = new Set(eligible.map((e) => e.id));
  const ids = new Set<string>();
  for (const e of eligible) {
    if (searchMismatch(e, parsed, now)) continue;
    ids.add(e.id);
    for (const r of net.related(e.id)) if (available.has(r.id)) ids.add(r.id);
  }
  return eligible.filter((e) => ids.has(e.id));
}

function titleBigrams(title: string): Set<string> {
  const chars = [...title.toLocaleLowerCase("zh-TW").replace(/[\s\p{P}\p{S}]/gu, "")];
  return new Set(chars.slice(1).map((char, index) => chars[index] + char));
}

export function relateExternal(item: { title: string }, events: IntelEvent[]): { related: IntelEvent[]; duplicate: boolean } {
  const title = titleBigrams(item.title);
  if (!title.size) return { related: [], duplicate: false };
  // ponytail: 每篇站外新聞掃描站內標題，最多三十篇；資料量明顯增加時再建立倒排索引。
  const matches = events.map(event => {
    const other = titleBigrams(event.title);
    const intersection = [...title].filter(pair => other.has(pair)).length;
    return { event, score: intersection / (title.size + other.size - intersection) };
  }).filter(match => match.score >= 0.25).sort((a, b) => b.score - a.score);
  return { related: matches.slice(0, 3).map(match => match.event), duplicate: (matches[0]?.score ?? 0) >= 0.8 };
}
