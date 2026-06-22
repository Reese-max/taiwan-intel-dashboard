export type Scope = "domestic" | "international";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type SourceType = "gov-open-data" | "news-rss" | "cwa" | "manual";

export interface Provenance {
  name: string;
  type: SourceType;
  datasetId?: string;
  recordRef?: string;
  url?: string;
  fetchedAt: string; // ISO8601
  query?: string;
}

export interface IntelEvent {
  id: string;
  title: string;
  region: string;
  lat?: number;
  lng?: number;
  timestamp: string; // ISO8601
  category: string;
  scope: Scope;
  riskLevel: RiskLevel;
  summary: string;
  source: Provenance;
  // LLM 萃取的語意訊號（僅新聞精修批次有）：供關聯網做語意關聯。
  aiEntities?: string[];
  aiTopic?: string;
}

export const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};
