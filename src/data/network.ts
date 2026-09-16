// 情報網前端載入層：讀 build-time 產出的 network.json，建立 事件id → 相連事件 的索引。
// 前端零計算（關聯在抓取階段算好），這裡只做 O(E) 建索引與查詢。
import type { Scope } from "../types/event";
import { computeSha256Hex } from "../utils/sha256";

export type EdgeType = "same-incident" | "same-entity" | "same-topic";

export interface NetEdge {
  a: string;
  b: string;
  type: EdgeType;
  weight: number;
  why: string;
}

export interface NetNode {
  id: string;
  title?: string;
  summary?: string;
  region: string;
  category: string;
  riskLevel: string;
  scope: Scope;
  degree: number;
  // 只計 same-incident 直接佐證鄰居的來源，不含 same-entity／same-topic。
  // 只計群內 same-incident 直接佐證來源；同實體／同題關聯不計入。
  sourceCount?: number;
  evidenceSources?: string[];
}

export interface ClusterTemporalBucket {
  ts: string; // UTC 日桶起點（YYYY-MM-DDT00:00:00.000Z）
  reports: number;
  sources: number;
}

export interface ClusterGeoMember {
  id: string;
  lat: number;
  lng: number;
}

export interface ClusterGeo {
  id: string;
  size: number;
  centroidLat: number;
  centroidLng: number;
  members: ClusterGeoMember[]; // 成員座標佐證
}

export interface ClusterDegradation {
  missingTimestamp: { count: number; ids: string[] };
  missingCoordinates: { count: number; ids: string[] };
}

export interface NetCluster {
  id: string;
  members: string[];
  size: number;
  representativeTitle?: string;
  topCategory?: string;
  regions?: string[];
  latestTs?: string;
  sourceCount?: number;
  evidenceSources?: string[];
  dominantCategoryShare?: number;
  categoryEntropy?: number;
  distinctTopicRatio?: number;
  temporalSpanDays?: number;
  // 時序演變與地理聚集訊號（build-time 由 correlate 產出；全員時間缺失時省略 firstSeenTs/lastSeenTs）。
  temporalSeries?: ClusterTemporalBucket[];
  firstSeenTs?: string;
  lastSeenTs?: string;
  geoClusters?: ClusterGeo[];
  degraded?: ClusterDegradation;
  incoherent?: boolean;
}

export interface ScopeNetwork {
  // 舊產物可省略；新產物保留事件摘要與直接佐證來源。
  nodes?: NetNode[];
  edges: NetEdge[];
  clusters: NetCluster[];
  stats: Record<string, unknown>;
}

export type NetworkState = "ready" | "empty" | "error" | "stale";

export interface IntelNetwork {
  snapshotId?: string;
  rulesVersion?: string;
  generatedAt: string;
  scopeNote?: string;
  domestic: ScopeNetwork;
  international: ScopeNetwork;
  excluded?: { domestic: number; international: number };
}

export interface RelatedRef {
  id: string;
  type: EdgeType;
  weight: number;
  why: string;
}

const TYPE_LABEL: Record<EdgeType, string> = {
  "same-incident": "同事件候選（待查證）",
  "same-entity": "共享實體",
  "same-topic": "同題情勢（弱關聯）",
};

export const NETWORK_FETCH_TIMEOUT_MS = 5_000;

export function edgeTypeLabel(t: EdgeType): string {
  return TYPE_LABEL[t] ?? t;
}

export interface NetworkIndexOptions {
  state?: NetworkState;
  error?: string;
  generatedAt?: string;
  snapshotId?: string;
  rulesVersion?: string;
}

// 鄰接索引：給定事件 id 回傳相連事件（依關聯強度排序）。
export class NetworkIndex {
  readonly state: NetworkState;
  readonly error?: string;
  readonly generatedAt?: string;
  readonly snapshotId?: string;
  readonly rulesVersion?: string;
  readonly rawNetwork: ScopeNetwork | null;

  private adj = new Map<string, RelatedRef[]>();
  private clusterById = new Map<string, NetCluster>();
  private clusterByMember = new Map<string, NetCluster>();
  private clusterList: NetCluster[] = [];

  constructor(net?: ScopeNetwork | null, options?: NetworkIndexOptions) {
    this.rawNetwork = net ?? null;
    this.error = options?.error;
    this.generatedAt = options?.generatedAt;
    this.snapshotId = options?.snapshotId;
    this.rulesVersion = options?.rulesVersion;

    if (options?.state) {
      this.state = options.state;
    } else if (options?.error) {
      this.state = "error";
    } else if (!net) {
      this.state = "empty";
    } else {
      const hasData = (net.edges?.length ?? 0) > 0 || (net.clusters?.length ?? 0) > 0 || (net.nodes?.length ?? 0) > 0;
      this.state = hasData ? "ready" : "empty";
    }

    if (!net) return;
    this.clusterList = [...(net.clusters ?? [])];
    for (const c of this.clusterList) {
      this.clusterById.set(c.id, c);
      for (const id of c.members) this.clusterByMember.set(id, c);
    }
    for (const e of net.edges ?? []) {
      this.push(e.a, { id: e.b, type: e.type, weight: e.weight, why: e.why });
      this.push(e.b, { id: e.a, type: e.type, weight: e.weight, why: e.why });
    }
    for (const list of this.adj.values()) list.sort((x, y) => y.weight - x.weight);
  }

  static createReady(net: ScopeNetwork, meta?: { generatedAt?: string; snapshotId?: string; rulesVersion?: string }): NetworkIndex {
    return new NetworkIndex(net, { state: "ready", ...meta });
  }

  static createEmpty(meta?: { generatedAt?: string; snapshotId?: string; rulesVersion?: string }): NetworkIndex {
    return new NetworkIndex(null, { state: "empty", ...meta });
  }

  static createError(error: string, meta?: { snapshotId?: string; rulesVersion?: string }): NetworkIndex {
    return new NetworkIndex(null, { state: "error", error, ...meta });
  }

  static createStale(previous: NetworkIndex, error: string): NetworkIndex {
    return new NetworkIndex(previous.rawNetwork, {
      state: "stale",
      error,
      generatedAt: previous.generatedAt,
      snapshotId: previous.snapshotId,
      rulesVersion: previous.rulesVersion,
    });
  }

  private push(id: string, ref: RelatedRef): void {
    const list = this.adj.get(id);
    if (list) list.push(ref);
    else this.adj.set(id, [ref]);
  }

  related(id: string): RelatedRef[] {
    return this.adj.get(id) ?? [];
  }

  count(id: string): number {
    return this.adj.get(id)?.length ?? 0;
  }

  clusters(): NetCluster[] {
    return [...this.clusterList];
  }

  cluster(id: string): NetCluster | undefined {
    return this.clusterById.get(id);
  }

  clusterOf(id: string): NetCluster | undefined {
    return this.clusterByMember.get(id);
  }
}

export interface LoadNetworkOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  previousIndex?: NetworkIndex | null;
  networkUrl?: string;
  expectedSnapshotId?: string;
  expectedSha256?: string;
}

// 載入並建索引；明確區分 ready、empty、error、stale。
export async function loadNetwork(scope: Scope, options: LoadNetworkOptions = {}): Promise<NetworkIndex> {
  const url = options.networkUrl ?? "./data/network.json";
  const timeoutMs = options.timeoutMs ?? NETWORK_FETCH_TIMEOUT_MS;
  const previous = options.previousIndex && options.previousIndex.state !== "error" ? options.previousIndex : null;

  let res: Response;
  try {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? typeof AbortSignal.any === "function"
        ? AbortSignal.any([options.signal, timeoutSignal])
        : options.signal
      : timeoutSignal;

    res = await fetch(url, { signal });
  } catch (err: unknown) {
    const isTimeout =
      (err instanceof DOMException && err.name === "TimeoutError") ||
      (err instanceof Error && /timeout|aborted/i.test(err.message));
    const errorMsg = isTimeout
      ? `載入情報網逾時 (超過 ${Math.round(timeoutMs / 1000)} 秒)`
      : `網路連線異常: ${err instanceof Error ? err.message : String(err)}`;
    if (previous) return NetworkIndex.createStale(previous, errorMsg);
    return NetworkIndex.createError(errorMsg);
  }

  if (!res.ok) {
    const errorMsg =
      res.status === 404
        ? "情報網資料尚未產生或檔案不存在 (HTTP 404)"
        : `載入情報網失敗 (HTTP ${res.status})`;
    if (previous) return NetworkIndex.createStale(previous, errorMsg);
    return NetworkIndex.createError(errorMsg);
  }

  let rawText: string | null = null;
  let net: IntelNetwork;
  if (typeof res.text === "function") {
    rawText = await res.text();
    if (options.expectedSha256 && globalThis.crypto?.subtle) {
      const hash = await computeSha256Hex(rawText);
      if (hash && hash !== options.expectedSha256) {
        const errorMsg = `情報網 SHA-256 不符 (期望 ${options.expectedSha256}，實收 ${hash})`;
        if (previous) return NetworkIndex.createStale(previous, errorMsg);
        return NetworkIndex.createError(errorMsg);
      }
    }
    try {
      net = JSON.parse(rawText) as IntelNetwork;
    } catch (err: unknown) {
      const errorMsg = `情報網資料格式錯誤 (JSON 無法解析: ${err instanceof Error ? err.message : String(err)})`;
      if (previous) return NetworkIndex.createStale(previous, errorMsg);
      return NetworkIndex.createError(errorMsg);
    }
  } else {
    try {
      net = (await res.json()) as IntelNetwork;
    } catch (err: unknown) {
      const errorMsg = `情報網資料格式錯誤 (JSON 無法解析: ${err instanceof Error ? err.message : String(err)})`;
      if (previous) return NetworkIndex.createStale(previous, errorMsg);
      return NetworkIndex.createError(errorMsg);
    }
  }

  if (!net || typeof net !== "object") {
    const errorMsg = "情報網資料根值不是物件";
    if (previous) return NetworkIndex.createStale(previous, errorMsg);
    return NetworkIndex.createError(errorMsg);
  }

  if (options.expectedSnapshotId) {
    if (!net.snapshotId || !net.snapshotId.trim()) {
      const errorMsg = `情報網缺少快照版本 (期望 ${options.expectedSnapshotId}，實收無版本)`;
      if (previous) return NetworkIndex.createStale(previous, errorMsg);
      return NetworkIndex.createError(errorMsg, { snapshotId: options.expectedSnapshotId });
    }
    if (net.snapshotId !== options.expectedSnapshotId) {
      const errorMsg = `情報網快照版本不符 (期望 ${options.expectedSnapshotId}，實收 ${net.snapshotId})`;
      if (previous) return NetworkIndex.createStale(previous, errorMsg);
      return NetworkIndex.createError(errorMsg, { snapshotId: net.snapshotId });
    }
  }

  const scopeNet = net[scope];
  if (!scopeNet || typeof scopeNet !== "object") {
    const errorMsg = `情報網未包含 ${scope} 領域資料`;
    if (previous) return NetworkIndex.createStale(previous, errorMsg);
    return NetworkIndex.createError(errorMsg);
  }

  const meta = {
    generatedAt: net.generatedAt,
    snapshotId: net.snapshotId,
    rulesVersion: net.rulesVersion,
  };
  const hasData = (scopeNet.edges?.length ?? 0) > 0 || (scopeNet.clusters?.length ?? 0) > 0 || (scopeNet.nodes?.length ?? 0) > 0;
  return hasData ? NetworkIndex.createReady(scopeNet, meta) : NetworkIndex.createEmpty(meta);
}

