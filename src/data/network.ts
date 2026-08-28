// 情報網前端載入層：讀 build-time 產出的 network.json，建立 事件id → 相連事件 的索引。
// 前端零計算（關聯在抓取階段算好），這裡只做 O(E) 建索引與查詢。
import type { Scope } from "../types/event";

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

export interface IntelNetwork {
  generatedAt: string;
  domestic: ScopeNetwork;
  international: ScopeNetwork;
}

export interface RelatedRef {
  id: string;
  type: EdgeType;
  weight: number;
  why: string;
}

const TYPE_LABEL: Record<EdgeType, string> = {
  "same-incident": "跨源佐證",
  "same-entity": "共享實體",
  "same-topic": "同題情勢（弱關聯）",
};

const NETWORK_FETCH_TIMEOUT_MS = 5_000;

export function edgeTypeLabel(t: EdgeType): string {
  return TYPE_LABEL[t] ?? t;
}

// 鄰接索引：給定事件 id 回傳相連事件（依關聯強度排序）。
export class NetworkIndex {
  private adj = new Map<string, RelatedRef[]>();
  private clusterById = new Map<string, NetCluster>();
  private clusterByMember = new Map<string, NetCluster>();
  private clusterList: NetCluster[] = [];

  constructor(net?: ScopeNetwork | null) {
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

// 載入並建索引；無 network.json（404）時回空索引，不報錯。
export async function loadNetwork(scope: Scope): Promise<NetworkIndex> {
  try {
    const res = await fetch("./data/network.json", { signal: AbortSignal.timeout(NETWORK_FETCH_TIMEOUT_MS) });
    if (!res.ok) return new NetworkIndex(null);
    const net = (await res.json()) as IntelNetwork;
    return new NetworkIndex(net[scope]);
  } catch {
    return new NetworkIndex(null);
  }
}
