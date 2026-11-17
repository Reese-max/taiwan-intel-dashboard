import type { IntelEvent } from "./types/event";
import type { NetworkIndex } from "./data/network";
import { fold, parseSearchQuery, searchMismatch } from "./search-query";

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
  for (const e of eligible) {
    if (searchMismatch(e, parsed, now)) continue;
    ids.add(e.id);
    for (const r of net.related(e.id)) if (strongRelation(r) && available.has(r.id)) ids.add(r.id);
  }
  return eligible.filter((e) => ids.has(e.id));
}

function titleBigrams(title: string): Set<string> {
  const chars = [...fold(title).replace(/[\s\p{P}\p{S}]/gu, "")];
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
