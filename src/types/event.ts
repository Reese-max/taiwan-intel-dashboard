export type Scope = "domestic" | "international";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type NewsAuthority = "official" | "media";
export type SourceType = "gov-open-data" | "news-rss" | "cwa" | "manual";
export type IngestMethod = "direct-rss" | "google-news-rss" | "gov-open-data" | "manual";
export type SourceConfidence = "verified" | "aggregated" | "inferred";
export type LocationPrecision = "exact" | "address" | "district" | "city" | "country" | "global" | "unknown";

export interface Provenance {
  name: string;
  type: SourceType;
  datasetId?: string;
  recordRef?: string;
  url?: string;
  fetchedAt: string; // ISO8601
  query?: string;
  publisherName?: string;
  publisherUrl?: string;
  aggregatorName?: string;
  aggregatorUrl?: string;
  ingestMethod?: IngestMethod;
  sourceConfidence?: SourceConfidence;
  authority?: NewsAuthority;
  jurisdiction?: string;
  feedLabel?: string;
}

export interface IntelEvent {
  id: string;
  title: string;
  region: string;
  lat?: number;
  lng?: number;
  locationPrecision?: LocationPrecision;
  locationNote?: string;
  timestamp: string; // ISO8601
  category: string;
  categoryBasis?: string; // 分類來源標記：llm / rule:<類> / hint:<hint> / default
  temporal?: "historical" | "judicial"; // 事件時效語義：歷史參考資料或司法結果報導
  scope: Scope;
  riskLevel: RiskLevel;
  summary: string;
  source: Provenance;
  // LLM 萃取的語意訊號（僅新聞精修批次有）：供關聯網做語意關聯。
  aiEntities?: string[];
  aiTopic?: string;
  twRelevance?: number; // 對台灣的相關度 0-100（LLM 估計，僅國際事件）
  sentiment?: "negative" | "neutral" | "positive" | "mixed"; // LLM 估計的事件情緒傾向
  threatActors?: string[]; // LLM 抽取的威脅行為者/敵對組織具名
  relations?: { from: string; to: string; type: string }[]; // LLM 抽取的實體關係（餵關係圖，僅國際事件）
  implications?: string; // 高風險國際事件的二次深度「影響評估」短文
}

export const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};
