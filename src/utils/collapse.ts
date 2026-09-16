import type { NetworkIndex } from "../data/network";
import type { IntelEvent } from "../types/event";
import { RISK_ORDER } from "../types/event";
import { extractPublisherKey, extractChannelKey, extractRawReportKey } from "./corroboration";

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

function areVerifiableDuplicates(a: IntelEvent, b: IntelEvent): boolean {
  const keyA = extractRawReportKey(a);
  const keyB = extractRawReportKey(b);
  if (keyA && keyB && keyA === keyB && !keyA.startsWith("event:")) {
    return true;
  }
  if (a.source.recordRef && b.source.recordRef && a.source.recordRef === b.source.recordRef) {
    return true;
  }
  return false;
}

function hasDirectSameIncident(aId: string, bId: string, net: NetworkIndex): boolean {
  const relatedA = net.related(aId);
  if (relatedA.some((r) => r.id === bId && r.type === "same-incident")) return true;
  const relatedB = net.related(bId);
  if (relatedB.some((r) => r.id === aId && r.type === "same-incident")) return true;
  return false;
}

function canJoinGroup(candidate: IntelEvent, currentMembers: IntelEvent[], net: NetworkIndex): boolean {
  for (const member of currentMembers) {
    if (areVerifiableDuplicates(candidate, member)) continue;
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

  for (const seed of events) {
    if (visited.has(seed.id)) continue;

    const groupMembers: IntelEvent[] = [seed];
    visited.add(seed.id);

    // 取得候選成員：
    // 1. 同原始稿件之可驗證重複紀錄
    // 2. 與 seed 有 direct same-incident 之鄰居（依 weight 與時間排序）
    const candidateIds: string[] = [];

    // 先納入相同 URL 重複稿
    const seedRawKey = extractRawReportKey(seed);
    if (seedRawKey && !seedRawKey.startsWith("event:")) {
      for (const other of events) {
        if (!visited.has(other.id) && areVerifiableDuplicates(seed, other)) {
          candidateIds.push(other.id);
        }
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

      if (canJoinGroup(cand, groupMembers, net)) {
        groupMembers.push(cand);
        visited.add(cid);
      }
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
      const raw = extractRawReportKey(ev);
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
