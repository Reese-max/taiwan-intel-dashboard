import type { NetworkIndex } from "../data/network";
import type { IntelEvent } from "../types/event";
import { RISK_ORDER } from "../types/event";
import { extractPublisherKey, extractChannelKey, extractRawReportKey } from "./corroboration";
import { fold } from "../search-query";
import { titleBigrams, titleSimilarity } from "./title";

export interface CollapsedGroup {
  representative: IntelEvent;
  members: IntelEvent[];
  sourceCount: number;
  channelCount?: number;
  rawReportCount?: number;
  isMultiChannel?: boolean;
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

const DUPLICATE_TITLE_JACCARD = 0.8;

// 只有新聞才用標題判重複：官方資料（如地震報告）以模板產生標題，相同標題可能是不同事件。與 correlate.mjs isNewsLikeEvent 同義。
const isNewsLike = (e: IntelEvent): boolean => e.source.type === "news-rss" || e.source.datasetId === "tw-news";

// 大小過濾：Jaccard ≥ t 必須 min(|a|,|b|) ≥ t·max(|a|,|b|)，先排除再算交集。
function isDuplicateTitle(a: Set<string>, b: Set<string>): boolean {
  if (Math.min(a.size, b.size) < DUPLICATE_TITLE_JACCARD * Math.max(a.size, b.size)) return false;
  return titleSimilarity(a, b) >= DUPLICATE_TITLE_JACCARD;
}

// 事件物件在快照內不變，標題特徵跨次 refresh 重用（每次輸入都會重算收合）。
const titleSignatures = new WeakMap<IntelEvent, Set<string>>();
function duplicateTitle(e: IntelEvent): Set<string> {
  let signature = titleSignatures.get(e);
  if (!signature) titleSignatures.set(e, signature = computeDuplicateTitle(e));
  return signature;
}

function computeDuplicateTitle(e: IntelEvent): Set<string> {
  if (!isNewsLike(e)) return new Set();
  const publishers = [e.source.publisherName ?? "", e.source.name.replace(/^GN\s+/u, "")].map(name => fold(name.trim()));
  const title = fold(e.title)
    .replace(/\s*[|｜][^|｜]+[|｜][^|｜]+$/u, "")
    .replace(/\s*[-–—]\s*([^-–—]+)$/u, (suffix, publisher: string) =>
      publishers.includes(publisher.trim()) || /^(?:ctwant|中央社|自由時報|聯合新聞網|聯合報|中時新聞網|中國時報|公視新聞網|華視新聞網|民視新聞網|三立新聞網|ettoday新聞雲|tvbs新聞網|nownews今日新聞|yahoo奇摩新聞)$/u.test(publisher.trim()) ? "" : suffix);
  // 英文標題用單字比對：字母雙字組（th、he…）人人共有，會讓候選數與比對量爆增。
  return /\p{Script=Han}/u.test(title) ? titleBigrams(title) : new Set(title.match(/[\p{L}\p{N}]+/gu) ?? []);
}

function areVerifiableDuplicates(a: IntelEvent, b: IntelEvent, rawKey: (e: IntelEvent) => string, titles: Map<IntelEvent, Set<string>>): boolean {
  const keyA = rawKey(a);
  const keyB = rawKey(b);
  if (keyA && keyB && keyA === keyB && !keyA.startsWith("event:")) {
    return true;
  }
  if (a.source.recordRef && b.source.recordRef && a.source.recordRef === b.source.recordRef) {
    return true;
  }
  return isDuplicateTitle(titles.get(a)!, titles.get(b)!);
}

function hasDirectSameIncident(aId: string, bId: string, net: NetworkIndex): boolean {
  const relatedA = net.related(aId);
  if (relatedA.some((r) => r.id === bId && r.type === "same-incident")) return true;
  const relatedB = net.related(bId);
  if (relatedB.some((r) => r.id === aId && r.type === "same-incident")) return true;
  return false;
}

function canJoinGroup(candidate: IntelEvent, currentMembers: IntelEvent[], net: NetworkIndex, rawKey: (e: IntelEvent) => string, titles: Map<IntelEvent, Set<string>>): boolean {
  for (const member of currentMembers) {
    if (areVerifiableDuplicates(candidate, member, rawKey, titles)) continue;
    if (hasDirectSameIncident(candidate.id, member.id, net)) continue;
    // 只要與組內任一成員無直接佐證且非可驗證重複紀錄，即不得藉由第三者傳遞收合
    return false;
  }
  return true;
}

export function collapseSameIncident(events: IntelEvent[], net: NetworkIndex): CollapsedGroup[] {
  const byId = new Map(events.map((e) => [e.id, e] as const));
  const originalIndex = new Map(events.map((e, i) => [e.id, i] as const));
  const visited = new Set<string>();
  const groups: CollapsedGroup[] = [];
  const rawKeys = new Map<IntelEvent, string>();
  const rawKeyPositions = new Map<string, number[]>();
  const recordRefPositions = new Map<string, number[]>();
  const titles = new Map<IntelEvent, Set<string>>();
  const titlePositions = new Map<string, number[]>();
  const addPosition = (index: Map<string, number[]>, key: string, position: number): void => {
    const positions = index.get(key);
    if (positions) positions.push(position);
    else index.set(key, [position]);
  };
  events.forEach((e, position) => {
    if (!rawKeys.has(e)) rawKeys.set(e, extractRawReportKey(e));
    const key = rawKeys.get(e)!;
    if (key && !key.startsWith("event:")) addPosition(rawKeyPositions, key, position);
    if (e.source.recordRef) addPosition(recordRefPositions, e.source.recordRef, position);
    titles.set(e, duplicateTitle(e));
  });
  // 前綴過濾：每個標題只索引最少見的 |x|-ceil(t|x|)+1 個 bigram；Jaccard ≥ t 的兩標題必共享其中之一，
  // 避免英文常見字母組（th、he…）讓候選數爆量。
  const pairFrequency = new Map<string, number>();
  for (const pairs of titles.values()) for (const pair of pairs) pairFrequency.set(pair, (pairFrequency.get(pair) ?? 0) + 1);
  const titlePrefix = (pairs: Set<string>): string[] => [...pairs]
    .sort((a, b) => pairFrequency.get(a)! - pairFrequency.get(b)! || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, pairs.size - Math.ceil(DUPLICATE_TITLE_JACCARD * pairs.size) + 1);
  const prefixes = new Map<IntelEvent, string[]>();
  events.forEach((e, position) => {
    prefixes.set(e, titlePrefix(titles.get(e)!));
    for (const pair of prefixes.get(e)!) addPosition(titlePositions, pair, position);
  });
  const rawKey = (e: IntelEvent): string => rawKeys.get(e)!;

  for (const seed of events) {
    if (visited.has(seed.id)) continue;

    const groupMembers: IntelEvent[] = [seed];
    visited.add(seed.id);

    // 取得候選成員：
    // 1. 同原始稿件之可驗證重複紀錄
    // 2. 與 seed 有 direct same-incident 之鄰居（依 weight 與時間排序）
    const candidateIds: string[] = [];

    // 候選仍依原陣列 entry 順序；同 ID 的 byId/originalIndex 保留既有 last-entry 語義。
    const seedRawKey = rawKey(seed);
    if (seedRawKey && !seedRawKey.startsWith("event:")) {
      const positions = new Set(rawKeyPositions.get(seedRawKey) ?? []);
      if (seed.source.recordRef) {
        for (const position of recordRefPositions.get(seed.source.recordRef) ?? []) positions.add(position);
      }
      for (const position of [...positions].sort((a, b) => a - b)) {
        const other = events[position];
        if (!visited.has(other.id)) {
          candidateIds.push(other.id);
        }
      }
    }

    // 標題候選只需查共有 bigram 的事件；仍逐對驗證，不做傳遞閉包。
    const titleCandidates = new Set<number>();
    for (const pair of prefixes.get(seed)!) {
      for (const position of titlePositions.get(pair) ?? []) titleCandidates.add(position);
    }
    for (const position of [...titleCandidates].sort((a, b) => a - b)) {
      const other = events[position];
      if (!visited.has(other.id) && isDuplicateTitle(titles.get(seed)!, titles.get(other)!) && !candidateIds.includes(other.id)) {
        candidateIds.push(other.id);
      }
    }

    // 再依權重取得 same-incident 候選鄰居
    const relatedIncident = net.related(seed.id)
      .filter((r) => r.type === "same-incident" && byId.has(r.id) && !visited.has(r.id))
      .sort((a, b) => b.weight - a.weight);

    for (const r of relatedIncident) {
      if (!candidateIds.includes(r.id)) {
        candidateIds.push(r.id);
      }
    }

    // 逐一檢視候選者是否能加入此群（必須滿足全連接條件，杜絕 A-B-C 鏈狀傳遞推論）
    for (const cid of candidateIds) {
      if (visited.has(cid)) continue;
      const cand = byId.get(cid);
      if (!cand) continue;

      if (canJoinGroup(cand, groupMembers, net, rawKey, titles)) {
        groupMembers.push(cand);
        visited.add(cid);
      }
    }

    if (groupMembers.length === 1) {
      groups.push({
        representative: seed,
        members: [seed],
        sourceCount: 1,
        channelCount: 1,
        rawReportCount: 1,
        isMultiChannel: false,
      });
      continue;
    }

    const representative = groupMembers.reduce((best, e) => betterRepresentative(best, e, originalIndex));
    const rest = groupMembers
      .filter((e) => e.id !== representative.id)
      .sort((a, b) => {
        const timeDelta = timeValue(b) - timeValue(a);
        if (timeDelta !== 0) return timeDelta;
        return (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0);
      });

    const publishers = new Set<string>();
    const channels = new Set<string>();
    const rawReports = new Set<string>();

    for (const ev of groupMembers) {
      const pub = extractPublisherKey(ev);
      if (pub) publishers.add(pub);
      const ch = extractChannelKey(ev);
      if (ch) channels.add(ch);
      const raw = rawKey(ev);
      if (raw) rawReports.add(raw);
    }

    let effectiveSources = publishers.size;
    if (publishers.size === 0) {
      effectiveSources = 1;
    } else if (rawReports.size === 1 && groupMembers.length > 1) {
      effectiveSources = 1;
    }

    const sourceCount = Math.max(1, effectiveSources);
    const channelCount = Math.max(1, channels.size);
    const rawReportCount = Math.max(1, rawReports.size);
    const isMultiChannel = sourceCount < 2 && channelCount >= 2;

    groups.push({
      representative,
      members: [representative, ...rest],
      sourceCount,
      channelCount,
      rawReportCount,
      isMultiChannel,
    });
  }

  return groups.sort(
    (a, b) => (originalIndex.get(a.representative.id) ?? 0) - (originalIndex.get(b.representative.id) ?? 0),
  );
}
