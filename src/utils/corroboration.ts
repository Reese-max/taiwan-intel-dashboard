import type { NetworkIndex } from "../data/network";
import type { IntelEvent } from "../types/event";

export interface CorroborationResult {
  sources: number;
  publishers?: number;
  channels: number;
  rawReports?: number;
  /** @deprecated 保留舊欄位相容；自動候選不能當成查證結論。 */
  confirmed: boolean;
  verification?: "unverified";
  isMultiChannel?: boolean;
  missingPublisherIdentity?: boolean;
}

export function normalizeUrl(raw?: string): string {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    for (const k of Array.from(u.searchParams.keys())) {
      if (/^utm_|^fbclid|^ref$|^gclid|^from/i.test(k)) u.searchParams.delete(k);
    }
    u.hash = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return raw.trim().replace(/\/+$/, "");
  }
}

export function extractPublisherKey(e: IntelEvent): string {
  if (e.source.publisherName) {
    const p = e.source.publisherName.trim();
    if (p) return p;
  }
  if (e.source.publisherUrl) {
    try {
      const host = new URL(e.source.publisherUrl).hostname.replace(/^www\./, "");
      if (host) return host;
    } catch {}
  }
  let name = e.source.name || "";
  if (name.startsWith("GN ")) {
    const gn = name.slice(3).trim();
    if (gn) return gn;
  }
  if (e.source.type === "cwa") {
    return "中央氣象署";
  }
  if (e.source.url) {
    try {
      const host = new URL(e.source.url).hostname.replace(/^www\./, "");
      if (host && !host.includes("google.com") && !host.includes("gdeltproject.org")) {
        return host;
      }
    } catch {}
  }
  // 嚴禁將通用 datasetId / aggregator / gov-open-data 偽裝成發布者身分
  if (
    name &&
    !name.startsWith("dataset:") &&
    name !== "gov-open-data" &&
    name !== "cwa" &&
    name !== "manual"
  ) {
    return name;
  }
  return "";
}

export function extractChannelKey(e: IntelEvent): string {
  if (e.source.datasetId) return `dataset:${e.source.datasetId.trim()}`;
  if (e.source.aggregatorName) return `aggregator:${e.source.aggregatorName.trim()}`;
  if (e.source.feedLabel) return `feed:${e.source.feedLabel.trim()}`;
  if (e.source.name) return `channel:${e.source.name.trim()}`;
  return "channel:default";
}

export function extractRawReportKey(e: IntelEvent): string {
  const norm = normalizeUrl(e.source.url ?? e.source.recordRef);
  if (norm) return norm;
  return `event:${e.id}`;
}

export function corroborationOf(
  eventId: string,
  byId: Map<string, IntelEvent>,
  net: NetworkIndex,
): CorroborationResult {
  const event = byId.get(eventId);
  if (!event) return { sources: 1, publishers: 0, channels: 1, rawReports: 0, confirmed: false, verification: "unverified" };

  const clusterEvents: IntelEvent[] = [event];
  for (const ref of net.related(eventId)) {
    if (ref.type !== "same-incident") continue;
    const related = byId.get(ref.id);
    if (related) clusterEvents.push(related);
  }

  const channels = new Set<string>();
  const publishers = new Set<string>();
  const canonicalUrls = new Set<string>();
  let hasMissingPublisher = false;

  for (const ev of clusterEvents) {
    const ch = extractChannelKey(ev);
    if (ch) channels.add(ch);

    const pub = extractPublisherKey(ev);
    if (pub) {
      publishers.add(pub);
    } else {
      hasMissingPublisher = true;
    }

    const url = normalizeUrl(ev.source.url ?? ev.source.recordRef);
    if (url) canonicalUrls.add(url);
  }

  // 沿用來源／URL 去重：
  // 1. 同稿多管道（同一原始 URL 被多管道收錄）：effectiveSources 不得超過 1
  // 2. 缺身分：不能因 datasetId 不同而膨脹獨立發布者數
  let effectiveSources = publishers.size;
  if (publishers.size === 0) {
    effectiveSources = 1;
  } else if (canonicalUrls.size === 1 && clusterEvents.length > 1) {
    effectiveSources = 1;
  }

  const isMultiChannel = effectiveSources < 2 && channels.size >= 2;
  const missingPublisherIdentity = hasMissingPublisher && publishers.size === 0;

  return {
    sources: Math.max(1, effectiveSources),
    publishers: publishers.size,
    channels: Math.max(1, channels.size),
    rawReports: Math.max(1, canonicalUrls.size || clusterEvents.length),
    confirmed: false,
    verification: "unverified",
    isMultiChannel,
    missingPublisherIdentity,
  };
}

/** 卡片與行動提示共用保守文案；即使舊輸入含 confirmed=true 也不升格。 */
export function candidateSourceLabel(result?: CorroborationResult): string {
  if (!result) return "";
  if (Number.isSafeInteger(result.sources) && result.sources > 1) {
    return `多來源線索（${result.sources} 個標記）·待查證`;
  }
  if (Number.isSafeInteger(result.channels) && result.channels > 1) {
    return `多管道收錄（${result.channels} 管道）·待查證`;
  }
  return "";
}
