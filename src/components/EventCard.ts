import type { IntelEvent } from "../types/event";
import { riskBadge } from "./RiskBadge";
import { esc, stripHtml } from "../utils/escape";

export interface RelationChip {
  label: string;
  why: string;
}

function fmtDate(value: string): string {
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

function sourceDisplayName(e: IntelEvent): string {
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

function eventContext(e: IntelEvent): string {
  const parts = [
    `<span><b>資料時間</b>${esc(fmtDate(e.timestamp))}</span>`,
    `<span><b>擷取時間</b>${esc(fmtDate(e.source.fetchedAt))}</span>`,
    `<span><b>來源型態</b>${esc(sourceTypeLabel(e.source.type))}</span>`,
  ];
  if (e.source.datasetId) parts.push(`<span><b>資料集</b>${esc(e.source.datasetId)}</span>`);
  if (e.source.recordRef)
    parts.push(`<span class="ctx-wide"><b>原始編號</b>${esc(e.source.recordRef)}</span>`);
  if (e.source.aggregatorName)
    parts.push(`<span class="ctx-aggregator"><b>經由</b>${esc(e.source.aggregatorName)}</span>`);
  if (e.locationPrecision)
    parts.push(`<span class="ctx-location"><b>定位</b>${esc(locationPrecisionLabel(e.locationPrecision))}</span>`);
  if (e.source.query) parts.push(`<span class="ctx-query" title="${esc(e.source.query)}"><b>查詢</b>可重現查詢</span>`);
  return `<div class="event-context" aria-label="完整脈絡"><strong>完整脈絡</strong>${parts.join("")}</div>`;
}

export function eventCard(e: IntelEvent, relatedCount = 0, relation?: RelationChip): string {
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
  return `
    <article class="event-card" data-id="${esc(e.id)}">
      <header>${riskBadge(e.riskLevel)} <span class="cat">${esc(e.category)}</span>
        <span class="region">${esc(e.region)}</span>${relationChip}${rel}</header>
      <h3>${esc(e.title)}</h3>
      <p class="summary">${esc(stripHtml(e.summary))}</p>
      ${eventContext(e)}
      <footer>
        <time>${esc(time)}</time>
        ${src}
        ${ref}
        <span class="fetched" title="抓取時間">擷取於 ${esc(fetched)}</span>
      </footer>
    </article>`;
}
