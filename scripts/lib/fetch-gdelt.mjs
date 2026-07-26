const API_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const DEFAULT_QUERY = '(Taiwan OR China OR "South China Sea" OR Ukraine OR Gaza OR sanctions OR cyberattack)';
const DEFAULT_TIMESPAN = "24h";

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback;
}

function parseGdeltDate(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/);
  if (!match) return raw;
  const [, year, month, day, hour, minute, second] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))).toISOString();
}

function httpError(status) {
  const error = new Error(`GDELT HTTP ${status}`);
  error.status = status;
  return error;
}

export function getGdeltRuntimeConfig(env = process.env) {
  return {
    query: String(env.GDELT_QUERY || DEFAULT_QUERY).trim() || DEFAULT_QUERY,
    timespan: String(env.GDELT_TIMESPAN || DEFAULT_TIMESPAN).trim() || DEFAULT_TIMESPAN,
    maxRecords: boundedNumber(env.GDELT_MAX_RECORDS, 75, 1, 250),
    timeoutMs: boundedNumber(env.GDELT_TIMEOUT_MS, 15000, 1000, 60000),
  };
}

export async function fetchGdelt({
  query,
  timespan,
  maxRecords,
  timeoutMs,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  const cfg = getGdeltRuntimeConfig({
    ...process.env,
    ...(query !== undefined ? { GDELT_QUERY: query } : {}),
    ...(timespan !== undefined ? { GDELT_TIMESPAN: timespan } : {}),
    ...(maxRecords !== undefined ? { GDELT_MAX_RECORDS: maxRecords } : {}),
    ...(timeoutMs !== undefined ? { GDELT_TIMEOUT_MS: timeoutMs } : {}),
  });
  const requestUrl = new URL(API_URL);
  requestUrl.searchParams.set("query", cfg.query);
  requestUrl.searchParams.set("mode", "artlist");
  requestUrl.searchParams.set("format", "json");
  requestUrl.searchParams.set("maxrecords", String(cfg.maxRecords));
  requestUrl.searchParams.set("sort", "datedesc");
  requestUrl.searchParams.set("timespan", cfg.timespan);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const response = await fetchImpl(requestUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "taiwan-intel-dashboard GDELT adapter" },
    });
    if (!response.ok) throw httpError(response.status);
    const payload = await response.json();
    const articles = Array.isArray(payload?.articles) ? payload.articles : [];
    const items = [];
    const seen = new Set();
    for (const article of articles) {
      const link = String(article?.url_mobile || article?.url || "").trim();
      const title = String(article?.title || "").trim();
      if (!/^https?:\/\//i.test(link) || !title || seen.has(link)) continue;
      seen.add(link);
      const domain = String(article?.domain || "").trim();
      items.push({
        title,
        link,
        description: "",
        pubDate: parseGdeltDate(article?.seendate),
        source: "GDELT Global News",
        sourceName: "GDELT Global News",
        sourceUrl: requestUrl.toString(),
        feedLabel: "GDELT Global News",
        publisherName: domain || undefined,
        publisherUrl: domain ? `https://${domain}` : undefined,
        aggregatorName: "GDELT",
        aggregatorUrl: API_URL,
        ingestMethod: "gdelt-doc",
        sourceConfidence: "aggregated",
        hint: "地緣政治",
        datasetId: "gdelt-doc",
        query: `GDELT DOC ${requestUrl.toString()}`,
      });
    }
    return {
      ok: true,
      label: "GDELT Global News",
      items,
      count: items.length,
      query: cfg.query,
      timespan: cfg.timespan,
      maxRecords: cfg.maxRecords,
      fetchedAt: now.toISOString(),
      requestUrl: requestUrl.toString(),
    };
  } finally {
    clearTimeout(timer);
  }
}
