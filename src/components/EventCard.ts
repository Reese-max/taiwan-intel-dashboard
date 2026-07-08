import type { IntelEvent } from "../types/event";
import type { CorroborationResult } from "../utils/corroboration";
import { riskBadge } from "./RiskBadge";
import { esc, stripHtml } from "../utils/escape";

export interface RelationChip {
  label: string;
  why: string;
}

export function fmtDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("zh-TW", { hour12: false });
}

function sourceTypeLabel(type: IntelEvent["source"]["type"]): string {
  switch (type) {
    case "gov-open-data":
      return "開放資料";
    case "news-rss":
      return "新聞／RSS";
    case "cwa":
      return "中央氣象署";
    case "manual":
      return "人工彙整";
  }
}

export function sourceDisplayName(e: IntelEvent): string {
  if (e.source.publisherName) return e.source.publisherName;
  if (e.source.aggregatorName) return `${e.source.aggregatorName} 聚合`;
  return e.source.name;
}

function sourceChain(e: IntelEvent): string {
  const bits = [`來源：${sourceDisplayName(e)}`];
  if (e.source.aggregatorName) bits.push(`經由：${e.source.aggregatorName}`);
  if (e.source.sourceConfidence === "aggregated") bits.push("聚合來源，請點開原文確認");
  return bits.join("｜");
}

function locationPrecisionLabel(value: IntelEvent["locationPrecision"]): string {
  switch (value) {
    case "exact":
    case "address":
      return "精準位置";
    case "district":
      return "行政區推論";
    case "city":
      return "縣市推論";
    case "country":
      return "國家層級";
    case "global":
      return "全球概略";
    default:
      return "未知";
  }
}

function categoryText(e: IntelEvent): string {
  return `${e.category} ${e.title} ${stripHtml(e.summary)}`;
}

function impactDomain(e: IntelEvent): string {
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

function impactScope(e: IntelEvent): string {
  const domain = impactDomain(e);
  if (e.scope === "international") {
    return `國際｜${intlRelevanceLabel(e)}｜${domain}`;
  }
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

function categoryAction(e: IntelEvent): string {
  const domain = impactDomain(e);
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

function suggestedAction(e: IntelEvent, corroboration?: CorroborationResult): string {
  if (e.temporal === "historical") return "作為歷史參考";
  if (e.temporal === "judicial") return "參考司法結果";
  if (isLowRelevanceIntl(e) && e.riskLevel !== "critical") return "背景觀察，不升級";
  if (e.riskLevel === "critical") return e.scope === "international" ? "列入重點追蹤" : "立即避開／處理";
  if (needsPrimarySourceCheck(e, corroboration) && e.riskLevel === "high") return "先查證原文再行動";
  if (e.riskLevel === "high") return categoryAction(e);
  if (e.riskLevel === "medium") return categoryAction(e);
  return "低優先掃描";
}

function eventStatus(e: IntelEvent, corroboration?: CorroborationResult): string {
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

function decisionPanel(e: IntelEvent, corroboration?: CorroborationResult): string {
  const items = [
    `<span><b>影響</b>${esc(impactScope(e))}</span>`,
    `<span><b>建議</b>${esc(suggestedAction(e, corroboration))}</span>`,
    `<span><b>狀態</b>${esc(eventStatus(e, corroboration))}</span>`,
  ];
  return `<div class="event-decision" aria-label="行動判斷">${items.join("")}</div>`;
}

function eventContext(e: IntelEvent): string {
  const verifyParts = [
    `<span><b>資料時間</b>${esc(fmtDate(e.timestamp))}</span>`,
    `<span><b>擷取時間</b>${esc(fmtDate(e.source.fetchedAt))}</span>`,
    `<span><b>來源型態</b>${esc(sourceTypeLabel(e.source.type))}</span>`,
  ];
  if (e.source.aggregatorName)
    verifyParts.push(`<span class="ctx-aggregator"><b>經由</b>${esc(e.source.aggregatorName)}</span>`);
  if (e.locationPrecision)
    verifyParts.push(`<span class="ctx-location"><b>定位</b>${esc(locationPrecisionLabel(e.locationPrecision))}</span>`);

  const rawParts = [];
  if (e.source.datasetId) rawParts.push(`<span><b>資料集</b>${esc(e.source.datasetId)}</span>`);
  if (e.source.recordRef) rawParts.push(`<span class="ctx-wide"><b>原始編號</b>${esc(e.source.recordRef)}</span>`);
  if (e.source.query) rawParts.push(`<span class="ctx-query" title="${esc(e.source.query)}"><b>查詢</b>可重現查詢</span>`);

  return `<details class="event-context event-verify" aria-label="完整脈絡：查證依據">
    <summary><strong>查證依據</strong><span>${verifyParts.length} 項</span></summary>
    <div class="event-context-body">${verifyParts.join("")}</div>
  </details>
  ${
    rawParts.length
      ? `<details class="event-context event-raw" aria-label="完整脈絡：原始資料">
          <summary><strong>原始資料</strong><span>${rawParts.length} 項</span></summary>
          <div class="event-context-body">${rawParts.join("")}</div>
        </details>`
      : ""
  }`;
}

function temporalBadge(temporal: IntelEvent["temporal"]): string {
  if (temporal === "historical") return `<span class="temporal-badge temporal-historical">${esc("歷史資料")}</span>`;
  if (temporal === "judicial") return `<span class="temporal-badge temporal-judicial">${esc("司法結果")}</span>`;
  return "";
}

export function eventCard(
  e: IntelEvent,
  relatedCount = 0,
  relation?: RelationChip,
  corroboration?: CorroborationResult,
  extraHeaderHtml = "",
): string {
  const time = fmtDate(e.timestamp);
  const fetched = fmtDate(e.source.fetchedAt);
  // url 與 recordRef 相同時 build-static 會省略 url（剝肥），故 fallback 至 recordRef。
  const linkUrl = e.source.url ?? e.source.recordRef;
  const displaySource = sourceDisplayName(e);
  const src =
    linkUrl && /^https?:\/\//.test(linkUrl)
      ? `<a class="src-link" href="${esc(linkUrl)}" target="_blank" rel="noopener" title="${esc(sourceChain(e))}">↗ ${esc(displaySource)}</a>`
      : `<span class="src-link src-none" title="無原始連結">${esc(displaySource)}（無原始連結）</span>`;
  const ref = e.source.recordRef
    ? `<span class="ref" title="原始識別">編號 ${esc(e.source.recordRef)}</span>`
    : "";
  // 情報網：有相連事件時顯示可點按鈕，點擊聚焦該事件的關聯網。
  const rel =
    relatedCount > 0
      ? `<button type="button" class="rel-link" data-rel="${esc(e.id)}" title="顯示與此情報相關聯的事件">🔗 關聯 ${relatedCount}</button>`
      : "";
  const relationChip = relation
    ? `<span class="rel-chip" title="${esc(relation.why)}">${esc(relation.label)}：${esc(relation.why)}</span>`
    : "";
  const isElevatedRisk = e.riskLevel === "critical" || e.riskLevel === "high";
  const corroborationChip = corroboration?.confirmed
    ? `<span class="corroboration-chip" title="${esc(`不同來源數：${corroboration.sources}`)}">${esc(`✓ ${corroboration.sources} 源佐證`)}</span>`
    : corroboration?.sources === 1 && isElevatedRisk
      ? `<span class="single-source-note" title="${esc("目前僅見單一來源，需人工查證")}">${esc("單一來源·待查證")}</span>`
      : "";
  const temporal = temporalBadge(e.temporal);
  return `
    <article class="event-card" data-id="${esc(e.id)}">
      <header>${riskBadge(e.riskLevel)} <span class="cat">${esc(e.category)}</span>${temporal}
        <span class="region">${esc(e.region)}</span>${relationChip}${corroborationChip}${extraHeaderHtml}${rel}</header>
      <h3>${esc(e.title)}</h3>
      <p class="summary">${esc(stripHtml(e.summary))}</p>
      ${decisionPanel(e, corroboration)}
      ${eventContext(e)}
      <footer>
        <time>${esc(time)}</time>
        ${src}
        ${ref}
        <span class="fetched" title="抓取時間">擷取於 ${esc(fetched)}</span>
      </footer>
    </article>`;
}
