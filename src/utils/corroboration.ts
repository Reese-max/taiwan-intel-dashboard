import type { NetworkIndex } from "../data/network";
import type { IntelEvent } from "../types/event";

export interface CorroborationResult {
  sources: number;
  channels: number;
  /** @deprecated 保留舊欄位相容；自動候選不能當成查證結論。 */
  confirmed: boolean;
  verification?: "unverified";
  isMultiChannel?: boolean;
}

function normalizeUrl(raw?: string): string {
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
  if (e.source.publisherName) return e.source.publisherName.trim();
  if (e.source.datasetId) return `dataset:${e.source.datasetId}`;
  if (e.source.publisherUrl) {
    try {
      return new URL(e.source.publisherUrl).hostname;
    } catch {}
  }
  let name = e.source.name || "";
  if (name.startsWith("GN ")) name = name.slice(3).trim();
  return name || "unknown";
}

export function corroborationOf(
  eventId: string,
  byId: Map<string, IntelEvent>,
  net: NetworkIndex,
): CorroborationResult {
  const event = byId.get(eventId);
  if (!event) return { sources: 1, channels: 1, confirmed: false, verification: "unverified" };

  const clusterEvents: IntelEvent[] = [event];
  for (const ref of net.related(eventId)) {
    if (ref.type !== "same-incident") continue;
    const related = byId.get(ref.id);
    if (related) clusterEvents.push(related);
  }

  const channels = new Set<string>();
  const publishers = new Set<string>();
  const canonicalUrls = new Set<string>();

  for (const ev of clusterEvents) {
    channels.add(ev.source.name);
    publishers.add(extractPublisherKey(ev));
    const url = normalizeUrl(ev.source.url ?? ev.source.recordRef);
    if (url) canonicalUrls.add(url);
  }

  // 沿用來源／URL 去重，僅作候選線索計數，不代表消息獨立或事實已查證。
  let effectiveSources = publishers.size;
  if (canonicalUrls.size === 1 && clusterEvents.length > 1) {
    effectiveSources = 1;
  }

  const isMultiChannel = effectiveSources < 2 && channels.size >= 2;

  return {
    sources: Math.max(1, effectiveSources),
    channels: channels.size,
    confirmed: false,
    verification: "unverified",
    isMultiChannel,
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
