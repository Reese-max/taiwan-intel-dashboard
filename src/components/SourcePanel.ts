import { esc } from "../utils/escape";

interface ProvSource {
  key?: string;
  name: string;
  type?: "gov-open-data" | "news-rss" | "cwa" | "manual" | string;
  datasetId?: string;
  scope?: string;
  category?: string;
  count: number;
  fetchedAt?: string;
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  skippedThisRun?: boolean;
  authority?: "official" | "media" | string;
  configured?: boolean;
  stale?: boolean;
  error?: string;
  latestDataDate?: string;
  query?: string;
  license?: string;
}
interface Manifest {
  generatedAt: string;
  note?: string;
  pipeline?: {
    twnews?: {
      lowContributionFeeds?: string[];
      sourceContributionTotals?: {
        raw?: number;
        rawUnique?: number;
        policeRelevant?: number;
        finalEvents?: number;
      };
    };
    international?: {
      rawCount?: number;
      count?: number;
      okFeeds?: number;
      totalFeeds?: number;
      normalizeSkippedBatches?: number;
      feeds?: FeedStatus[];
    };
    gdelt?: {
      ok?: boolean;
      count?: number;
      error?: string;
    };
  };
  sources: ProvSource[];
}

interface FeedStatus {
  label: string;
  ok?: boolean;
  count?: number;
  normalizedCount?: number;
  error?: string;
  method?: string;
}

const DAY_MS = 86400000;
const SOURCE_VISIBLE_LIMIT = 4;
const SOURCE_EXTRA_LIMIT = 8;
const LOW_CONTRIBUTION_VISIBLE_LIMIT = 6;

function fmtDate(value?: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("zh-TW", { hour12: false });
}

function sourceTypeLabel(type?: string): string {
  switch (type) {
    case "gov-open-data":
      return "開放資料";
    case "news-rss":
      return "新聞／RSS";
    case "cwa":
      return "中央氣象署";
    case "manual":
      return "人工彙整";
    default:
      return "未知來源";
  }
}

function freshness(source: ProvSource, generatedAt: string): { label: string; className: string; order: number } {
  if (source.configured === false) return { label: "尚未設定", className: "bad", order: -2 };
  if (source.stale === true) return { label: "抓取失敗", className: "bad", order: -1 };
  const reference = Date.parse(generatedAt);
  const last = Date.parse(source.lastSuccessAt ?? source.fetchedAt ?? "");
  if (!Number.isFinite(reference) || !Number.isFinite(last)) return { label: "時間未知", className: "unknown", order: 3 };
  const age = Math.max(0, reference - last);
  if (age <= DAY_MS) return { label: "同步正常", className: "ok", order: 0 };
  if (age <= DAY_MS * 3) return { label: "近期同步", className: "warn", order: 1 };
  return { label: "需檢查", className: "bad", order: 2 };
}

function datasetLink(datasetId: string): string {
  const safeId = encodeURIComponent(datasetId);
  return `https://data.gov.tw/dataset/${safeId}`;
}

function sourceDecision(source: ProvSource, generatedAt: string): string {
  if (source.configured === false) return "需設定憑證";
  if (source.stale === true) return "需檢查同步";
  const fresh = freshness(source, generatedAt);
  if (fresh.className === "bad") return "需檢查同步";
  if (source.count <= 0) return "觀察是否空轉";
  if (source.type === "gov-open-data" || source.type === "cwa") return "可作為主要證據";
  if (source.type === "news-rss") return "輔助判斷，需看原文";
  return "補充來源";
}

function sourceItem(source: ProvSource, generatedAt: string): string {
  const fresh = freshness(source, generatedAt);
  const dataset = source.datasetId
    ? /^\d+$/.test(source.datasetId)
      ? `<a class="dataset-link" href="${datasetLink(source.datasetId)}" target="_blank" rel="noopener">資料集 ${esc(source.datasetId)}</a>`
      : `<span>資料集 ${esc(source.datasetId)}</span>`
    : "";
  const meta = [
    sourceTypeLabel(source.type),
    source.scope === "international" ? "國際" : source.scope === "domestic" ? "國內" : undefined,
    source.category,
    `${source.count} 筆`,
  ]
    .filter(Boolean)
    .map((v) => `<span>${esc(String(v))}</span>`)
    .join("");
  return `<li>
    <div class="source-list-head">
      <b>${esc(source.name)}</b>
      <span class="source-fresh ${fresh.className}">${fresh.label}</span>
    </div>
    <div class="source-meta">${meta}</div>
    <p class="source-decision"><b>處理</b>${esc(sourceDecision(source, generatedAt))}</p>
    <details class="source-detail">
      <summary>查證與授權</summary>
      <div class="source-lineage">
        ${dataset}
        <span>最近同步 ${esc(fmtDate(source.lastSuccessAt ?? source.fetchedAt))}</span>
        ${source.lastAttemptAt ? `<span>最近嘗試 ${esc(fmtDate(source.lastAttemptAt))}</span>` : ""}
        ${source.latestDataDate ? `<span>最新資料日 ${esc(source.latestDataDate)}</span>` : ""}
      </div>
      ${source.query ? `<code title="可重現查詢">${esc(source.query)}</code>` : ""}
      ${source.license ? `<p class="license">${esc(source.license)}</p>` : ""}
    </details>
  </li>`;
}

function lowContributionBlock(manifest: Manifest): string {
  const twnews = manifest.pipeline?.twnews;
  const feeds = twnews?.lowContributionFeeds || [];
  if (!feeds.length) return "";
  const visibleFeeds = feeds.slice(0, LOW_CONTRIBUTION_VISIBLE_LIMIT);
  const hiddenFeeds = feeds.slice(LOW_CONTRIBUTION_VISIBLE_LIMIT);
  const totals = twnews?.sourceContributionTotals || {};
  const totalLine =
    typeof totals.raw === "number"
      ? `最終 ${totals.finalEvents ?? 0}／原始 ${totals.raw}`
      : "最終貢獻偏低";
  const detail = [
    typeof totals.rawUnique === "number" ? `去重後 ${totals.rawUnique}` : undefined,
    typeof totals.policeRelevant === "number" ? `警政相關 ${totals.policeRelevant}` : undefined,
  ]
    .filter(Boolean)
    .join("，");
  return `<section class="source-alert source-alert-warn" aria-label="新聞來源低貢獻警示">
    <h5>新聞來源低貢獻警示</h5>
    <p>${esc(totalLine)}${detail ? `（${esc(detail)}）` : ""}；以下來源有原始量，但幾乎未進入最終事件，可能被標題去重或警政相關性過濾。</p>
    <div class="source-chip-list">${visibleFeeds.map((feed) => `<span>${esc(feed)}</span>`).join("")}</div>
    ${
      hiddenFeeds.length
        ? `<details class="source-alert-more">
            <summary>查看其餘 ${hiddenFeeds.length} 個低貢獻來源</summary>
            <div class="source-chip-list">${hiddenFeeds.map((feed) => `<span>${esc(feed)}</span>`).join("")}</div>
          </details>`
        : ""
    }
  </section>`;
}

function internationalGapBlock(manifest: Manifest): string {
  const pipeline = manifest.pipeline?.international;
  const feeds = Array.isArray(pipeline?.feeds) ? pipeline.feeds : [];
  if (!feeds.length) return "";
  const gaps = feeds.filter((feed) => {
    if (feed.ok === false || Number(feed.count || 0) <= 0) return true;
    return typeof feed.normalizedCount === "number" && feed.normalizedCount <= 0;
  });
  const gapReason = (feed: FeedStatus): string => {
    if (feed.ok === false) return `抓取失敗${feed.error ? `：${feed.error}` : ""}`;
    if (Number(feed.count || 0) <= 0) return "回應但無原始資料";
    if (typeof feed.normalizedCount === "number" && feed.normalizedCount <= 0) return "正規化未產出";
    return "需觀察";
  };
  const visible = gaps.slice(0, 6);
  const hidden = gaps.slice(6);
  const metrics = [
    typeof pipeline?.rawCount === "number" ? `原始 ${pipeline.rawCount}` : undefined,
    typeof pipeline?.count === "number" ? `正規化 ${pipeline.count}` : undefined,
    typeof pipeline?.okFeeds === "number" && typeof pipeline?.totalFeeds === "number"
      ? `有資料來源 ${pipeline.okFeeds}/${pipeline.totalFeeds}`
      : undefined,
    pipeline?.normalizeSkippedBatches ? `跳過正規化 ${pipeline.normalizeSkippedBatches} 批` : undefined,
  ].filter(Boolean).join("，");
  const item = (feed: FeedStatus) => `<span title="${esc(gapReason(feed))}">${esc(feed.label)}：${esc(gapReason(feed))}</span>`;
  return `<section class="source-alert source-alert-warn" aria-label="國際來源新鮮度與缺口">
    <h5>國際來源新鮮度／缺口</h5>
    <p>${esc(metrics || "已載入來源狀態")}；此區只告警，不直接阻斷部署。</p>
    ${gaps.length ? `<div class="source-chip-list">${visible.map(item).join("")}</div>` : `<p>目前沒有已知來源缺口。</p>`}
    ${hidden.length ? `<details class="source-alert-more"><summary>查看其餘 ${hidden.length} 個缺口</summary><div class="source-chip-list">${hidden.map(item).join("")}</div></details>` : ""}
  </section>`;
}

export async function renderSourcePanel(container: HTMLElement): Promise<void> {
  const res = await fetch("./data/provenance.json");
  if (!res.ok) {
    container.innerHTML = `<p class="empty">來源資訊不可用</p>`;
    return;
  }
  const m = (await res.json()) as Manifest;
  const generated = new Date(m.generatedAt).toLocaleString("zh-TW", { hour12: false });
  const total = m.sources.reduce((sum, s) => sum + s.count, 0);
  const official = m.sources.filter((s) => s.type === "gov-open-data" || s.type === "cwa").length;
  const sorted = [...m.sources].sort((a, b) => freshness(a, m.generatedAt).order - freshness(b, m.generatedAt).order || b.count - a.count);
  const visibleSources = sorted.slice(0, SOURCE_VISIBLE_LIMIT);
  const extraSources = sorted.slice(SOURCE_VISIBLE_LIMIT, SOURCE_VISIBLE_LIMIT + SOURCE_EXTRA_LIMIT);
  const hiddenCount = Math.max(0, sorted.length - SOURCE_VISIBLE_LIMIT - SOURCE_EXTRA_LIMIT);
  const items = visibleSources
    .map((s) => sourceItem(s, m.generatedAt))
    .join("");
  const extraItems = extraSources.map((s) => sourceItem(s, m.generatedAt)).join("");
  container.innerHTML = `
    <section class="source-card">
      <h4>來源總覽</h4>
      <div class="source-kpis" aria-label="來源總覽">
        <div><b>${m.sources.length} 個來源</b><span>來源數</span></div>
        <div><b>${total} 筆</b><span>事件與資料列</span></div>
        <div><b>官方來源 ${official}</b><span>政府／氣象署</span></div>
      </div>
      <p class="source-generated">擷取於 ${esc(generated)}</p>
      ${internationalGapBlock(m)}
      ${lowContributionBlock(m)}
      <ul class="source-list">${items}</ul>
      ${
        extraItems
          ? `<details class="source-more">
              <summary>查看 ${extraSources.length} 個代表來源${hiddenCount ? `（另 ${hiddenCount} 個省略）` : ""}</summary>
              <ul class="source-list source-list-extra">${extraItems}</ul>
            </details>`
          : ""
      }
      ${hiddenCount ? `<p class="prov-note">另有 ${hiddenCount} 個低量來源已省略，保留面板可讀性；完整清單見 provenance.json。</p>` : ""}
    </section>
    ${m.note ? `<p class="prov-note">${esc(m.note)}</p>` : ""}`;
}
