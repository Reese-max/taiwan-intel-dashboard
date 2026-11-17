import type { IntelEvent } from "./types/event";
import type { NetworkIndex } from "./data/network";
import { fold, parseSearchQuery, searchMismatch } from "./search-query";
import { titleBigrams, titleSimilarity } from "./utils/title";

// 資料量測：同事件強度 1.5 多為同一案的不同報導，1.2–1.4 多為同城同類的別案，只帶前者與人工後續報導。
const STRONG_INCIDENT_WEIGHT = 1.5;
const strongRelation = (r: { type: string; weight: number }) =>
  r.type === "follow-up" || (r.type === "same-incident" && r.weight >= STRONG_INCIDENT_WEIGHT);

export function applySearchSubnet(events: IntelEvent[], net: NetworkIndex, query?: string): IntelEvent[] {
  if (!query?.trim()) return events;
  const parsed = parseSearchQuery(query);
  const now = Date.now();
  const eligible = events.filter(e => searchMismatch(e, parsed, now) !== "time");
  if (!parsed.groups.length) return eligible;
  const available = new Set(eligible.map((e) => e.id));
  const ids = new Set<string>();
  const directIds = new Set<string>();
  const titleHits: IntelEvent[] = [];
  const otherHits: IntelEvent[] = [];
  for (const e of eligible) {
    if (searchMismatch(e, parsed, now)) continue;
    directIds.add(e.id);
    const title = fold(e.title);
    const titleHit = parsed.groups.every(group => group.some(term => title.includes(fold(term))));
    (titleHit ? titleHits : otherHits).push(e);
    ids.add(e.id);
    for (const r of net.related(e.id)) if (strongRelation(r) && available.has(r.id)) ids.add(r.id);
  }
  return [...titleHits, ...otherHits, ...eligible.filter(e => ids.has(e.id) && !directIds.has(e.id))];
}

export function relateExternal(item: { title: string }, events: IntelEvent[]): { related: IntelEvent[]; duplicate: boolean } {
  const title = titleBigrams(item.title);
  if (!title.size) return { related: [], duplicate: false };
  // ponytail: 每篇站外新聞掃描站內標題，最多三十篇；資料量明顯增加時再建立倒排索引。
  const matches = events.map(event => {
    const other = titleBigrams(event.title);
    return { event, score: titleSimilarity(title, other) };
  }).filter(match => match.score >= 0.25).sort((a, b) => b.score - a.score);
  return { related: matches.slice(0, 3).map(match => match.event), duplicate: (matches[0]?.score ?? 0) >= 0.8 };
}
