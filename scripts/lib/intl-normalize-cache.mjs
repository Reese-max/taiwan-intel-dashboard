// 國際正規化跨輪快取：international.json 只存挑進前 max 的事件，其餘正規化結果原本每輪丟掉再重送 LLM。
// 這裡保存全部新結果與「模型看過但沒挑」的 id，期限內不再重送。
export const INTL_CACHE_FILE = "intl-normalize-cache.json";
// 「沒挑」是跟同批新聞比較的結果，換一批可能入選：只鎖 12 小時。
export const REJECTED_TTL_MS = 12 * 3600e3;
const CLOCK_SKEW_MS = 3600e3;

// 未來時間戳（時鐘偏差、壞檔）視為無效，避免永不過期。
const within = (at, now, ttlMs) => {
  const t = Date.parse(at);
  return Number.isFinite(t) && t <= now + CLOCK_SKEW_MS && now - t < ttlMs;
};

export function readIntlCache(raw, { now = Date.now(), ttlMs, rejectedTtlMs = REJECTED_TTL_MS }) {
  return {
    events: (Array.isArray(raw?.events) ? raw.events : []).filter((e) => e?.id && within(e?.source?.fetchedAt, now, ttlMs)),
    rejected: new Map(Object.entries(raw?.rejected || {}).filter(([, at]) => within(at, now, rejectedTtlMs))),
  };
}

// 新結果排前面，超過上限時丟最舊的。
export function updateIntlCache(cache, { freshEvents = [], answeredIds = [], now = Date.now(), maxEvents = 1500, maxRejected = 3000 }) {
  const byId = new Map();
  for (const event of [...freshEvents, ...cache.events]) if (event?.id && !byId.has(event.id)) byId.set(event.id, event);
  const returned = new Set(freshEvents.map((event) => event?.id));
  const rejected = new Map([...cache.rejected].filter(([id]) => !returned.has(id)));
  const at = new Date(now).toISOString();
  for (const id of answeredIds) {
    if (returned.has(id)) continue;
    rejected.delete(id); // 重新插入讓新紀錄排在後面，截斷時留新的
    rejected.set(id, at);
  }
  return { events: [...byId.values()].slice(0, maxEvents), rejected: new Map([...rejected].slice(-maxRejected)) };
}

export const serializeIntlCache = ({ events, rejected }) => ({ version: 1, events, rejected: Object.fromEntries(rejected) });
