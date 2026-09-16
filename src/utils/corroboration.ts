import type { NetworkIndex } from "../data/network";
import type { IntelEvent } from "../types/event";

export interface CorroborationResult {
  sources: number;
  channels: number;
  confirmed: boolean;
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
  if (!event) return { sources: 1, channels: 1, confirmed: false };

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

  // 1. 同一原始 URL 經多管道收錄，只計 1 個原始證據
  // 2. 同一發布者經直接 RSS 與聚合收錄，只計 1 個原始發布者
  let effectiveSources = publishers.size;
  if (canonicalUrls.size === 1 && clusterEvents.length > 1) {
    effectiveSources = 1;
  }

  const confirmed = effectiveSources >= 2;
  const isMultiChannel = !confirmed && channels.size >= 2;

  return {
    sources: Math.max(1, effectiveSources),
    channels: channels.size,
    confirmed,
    isMultiChannel,
  };
}
