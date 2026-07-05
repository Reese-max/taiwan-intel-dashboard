// 外交部領事事務局「國外旅遊警示」RSS → 結構化 IntelEvent[]。
// 來源已是官方結構化燈號，僅做 RSS 解析與欄位映射，不送 LLM 正規化。
import { fetchRssItems } from "./fetch-rss.mjs";
import { eventIdFor } from "./nvidia.mjs";

export const MOFA_TRAVEL_WARNING_FEED = {
  label: "外交部領事事務局 旅遊警示",
  url: "https://www.boca.gov.tw/sp-trwa-rss-1.xml",
  hint: "地緣政治",
};

const RISK_BY_SIGNAL = [
  [/第四級|紅色/, "critical"],
  [/第三級|橙色/, "high"],
  [/第二級|黃色/, "medium"],
  [/第一級|灰色/, "low"],
];

function toIso(pubDate, fallback) {
  const d = new Date(pubDate || "");
  return Number.isFinite(d.getTime()) ? d.toISOString() : fallback;
}

function riskFromTitle(title) {
  const text = String(title || "");
  return RISK_BY_SIGNAL.find(([pattern]) => pattern.test(text))?.[1] || "low";
}

export function parseTravelWarning(title) {
  const text = String(title || "").trim();
  const parts = text.split(/\s+-\s*/);
  const region = (parts.length >= 2 ? parts[1] : "").trim();
  return {
    region: region || "國外",
    riskLevel: riskFromTitle(text),
  };
}

export function mapMofaTravelWarningEvent(item, { fetchedAt = new Date().toISOString() } = {}) {
  const title = String(item?.title || "").trim() || "外交部國外旅遊警示";
  const description = String(item?.description || "").trim();
  const link = String(item?.link || "").trim();
  const { region, riskLevel } = parseTravelWarning(title);
  const id = eventIdFor("international", link || title);

  return {
    id,
    title,
    region,
    timestamp: toIso(item?.pubDate, fetchedAt),
    category: "地緣政治",
    scope: "international",
    riskLevel,
    summary: description || title,
    locationPrecision: "country",
    source: {
      name: MOFA_TRAVEL_WARNING_FEED.label,
      type: "gov-open-data",
      url: link || MOFA_TRAVEL_WARNING_FEED.url,
      fetchedAt,
      datasetId: "mofa-travel-warning",
      recordRef: link || title,
      query: "外交部領事事務局 國外旅遊警示 RSS",
    },
  };
}

export function mapMofaTravelWarningEvents(items, { fetchedAt = new Date().toISOString() } = {}) {
  return (Array.isArray(items) ? items : []).map((item) => mapMofaTravelWarningEvent(item, { fetchedAt }));
}

export async function fetchMofaTravelWarnings({ perFeed = 200 } = {}) {
  const fetchedAt = new Date().toISOString();
  const rss = await fetchRssItems({
    feeds: [MOFA_TRAVEL_WARNING_FEED],
    perFeed,
    concurrency: 1,
  });
  const feed = rss.feedStatus[0];
  if (!feed?.ok) throw new Error(`MOFA RSS ${feed?.error || "failed"}`);
  return mapMofaTravelWarningEvents(rss.items, { fetchedAt });
}
