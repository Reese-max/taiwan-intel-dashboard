import type { IntelEvent } from "../types/event";
import type { CorroborationResult } from "./corroboration";
import { stripHtml } from "./escape";

export interface ActionDecision {
  impact: string;
  recommendation: string;
  status: string;
  domain: string;
}

function categoryText(e: IntelEvent): string {
  return `${e.category} ${e.title} ${stripHtml(e.summary)}`;
}

export function actionImpactDomain(e: IntelEvent): string {
  const text = categoryText(e);
  if (/資安|駭|個資|深偽|網軍|認知作戰/.test(text)) return "帳號／系統";
  if (/反詐|詐騙|洗錢|金融|投資|虛擬資產|銀行/.test(text)) return "金流／帳戶";
  if (/交通|車禍|肇逃|測速|道路|通行|酒駕/.test(text)) return "通行";
  if (/災防|天氣|地震|火警|氣爆|淹水|土石流|坍方|颱風|豪雨|工安/.test(text)) return "安全／通行";
  if (/食安|藥|醫|疾管|健康|中毒/.test(text)) return "健康";
  if (/地緣|外交|軍事|戰爭|衝突|主權|制裁|供應鏈/.test(text)) return "外交／供應鏈";
  if (/治安|命案|槍|刀|暴力|竊盜|搶奪|毒品|失蹤|協尋/.test(text)) return "人身安全";
  return "一般注意";
}

function intlRelevanceLabel(e: IntelEvent): string {
  if (typeof e.twRelevance !== "number") return "對台關聯待判斷";
  if (e.twRelevance >= 70) return `高對台關聯 ${e.twRelevance}`;
  if (e.twRelevance >= 30) return `中對台關聯 ${e.twRelevance}`;
  return `低對台關聯 ${e.twRelevance}`;
}

function impactScope(e: IntelEvent, domain: string): string {
  if (e.scope === "international") return `國際｜${intlRelevanceLabel(e)}｜${domain}`;
  switch (e.locationPrecision) {
    case "exact":
    case "address":
    case "district":
      return `附近／區域｜${domain}`;
    case "city":
      return `縣市層級｜${domain}`;
    case "country":
      return `全國層級｜${domain}`;
    default:
      return `${e.region || "區域待判斷"}｜${domain}`;
  }
}

function categoryAction(domain: string): string {
  if (domain === "帳號／系統") return "檢查帳號與系統曝險";
  if (domain === "金流／帳戶") return "避免匯款並核對來源";
  if (domain === "通行") return "查路況並改道";
  if (domain === "安全／通行") return "避開現場並追蹤警示";
  if (domain === "健康") return "確認接觸風險";
  if (domain === "外交／供應鏈") return "追蹤供應鏈與旅行風險";
  if (domain === "人身安全") return "提高警覺並避開熱點";
  return "持續觀察";
}

function isLowRelevanceIntl(e: IntelEvent): boolean {
  return e.scope === "international" && typeof e.twRelevance === "number" && e.twRelevance < 30;
}

function needsPrimarySourceCheck(e: IntelEvent, corroboration?: CorroborationResult): boolean {
  if (corroboration?.confirmed) return false;
  return e.source.sourceConfidence === "aggregated" || e.source.type === "news-rss";
}

function recommendation(e: IntelEvent, domain: string, corroboration?: CorroborationResult): string {
  if (e.temporal === "historical") return "作為歷史參考";
  if (e.temporal === "judicial") return "參考司法結果";
  if (isLowRelevanceIntl(e) && e.riskLevel !== "critical") return "背景觀察，不升級";
  if (e.riskLevel === "critical") return e.scope === "international" ? "列入重點追蹤" : "立即避開／處理";
  if (needsPrimarySourceCheck(e, corroboration) && e.riskLevel === "high") return "先查證原文再行動";
  if (e.riskLevel === "high" || e.riskLevel === "medium") return categoryAction(domain);
  return "低優先掃描";
}

function status(e: IntelEvent, corroboration?: CorroborationResult): string {
  if (e.temporal === "historical") return "歷史資料";
  if (e.temporal === "judicial") return "司法結果";
  if (corroboration?.confirmed) return `${corroboration.sources} 源佐證`;
  if (corroboration?.sources === 1 && (e.riskLevel === "critical" || e.riskLevel === "high")) return "單一來源待查證";
  if (e.source.sourceConfidence === "aggregated") return "聚合來源待核";
  if (e.categoryBasis === "default") return "分類待確認";
  if (e.scope === "international" && e.implications) return "已有影響評估";
  if (e.riskLevel === "critical" || e.riskLevel === "high") return "高優先觀察";
  return "一般追蹤";
}

export function getActionDecision(e: IntelEvent, corroboration?: CorroborationResult): ActionDecision {
  const domain = actionImpactDomain(e);
  return {
    impact: impactScope(e, domain),
    recommendation: recommendation(e, domain, corroboration),
    status: status(e, corroboration),
    domain,
  };
}
