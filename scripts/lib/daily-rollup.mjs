import { taiwanLocalDate } from "./police-tree.mjs";

const SCOPES = ["domestic", "international"];
const RISKS = ["low", "medium", "high", "critical"];
const DAY_MS = 86400000;
const TAIWAN_OFFSET_MS = 8 * 60 * 60 * 1000;

// 每日 rollup 採逐格 max(previous, current)：每輪只重算當下可見快照，寫回時只墊高
// 既有格子的已知最高值。這讓重跑同一輪不會灌水，也避免來源保留窗把舊事件擠出
// 視圖後降低歷史日計數；晚到事件仍可補高該日。保留窗以本輪有效事件最大日為錨；
// 若本輪沒有有效 timestamp，則沿用既有最大日，避免壞資料輪誤剪歷史。只保留最近
// retentionDays 天，防止 gh-pages 狀態檔無界成長。
export function taiwanLocalDay(isoLike) {
  const day = taiwanLocalDate(isoLike);
  return day || null;
}

function emptyDay() {
  return {
    total: 0,
    byScope: { domestic: 0, international: 0 },
    byRisk: { low: 0, medium: 0, high: 0, critical: 0 },
    byCategory: {},
  };
}

function finiteCount(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isDayKey(day) {
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) && taiwanLocalDay(`${day}T00:00:00+08:00`) === day;
}

function normalizeDay(value) {
  const out = emptyDay();
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;

  out.total = finiteCount(value.total);
  for (const scope of SCOPES) out.byScope[scope] = finiteCount(value.byScope?.[scope]);
  for (const risk of RISKS) out.byRisk[risk] = finiteCount(value.byRisk?.[risk]);
  if (value.byCategory && typeof value.byCategory === "object" && !Array.isArray(value.byCategory)) {
    for (const [category, count] of Object.entries(value.byCategory)) {
      if (category) out.byCategory[category] = finiteCount(count);
    }
  }
  return out;
}

function normalizePrevious(previous) {
  const days = {};
  if (!previous?.days || typeof previous.days !== "object" || Array.isArray(previous.days)) return { days };
  for (const [day, value] of Object.entries(previous.days)) {
    if (isDayKey(day)) days[day] = normalizeDay(value);
  }
  return { days };
}

function increment(bucket, event) {
  bucket.total += 1;
  if (SCOPES.includes(event.scope)) bucket.byScope[event.scope] += 1;
  if (RISKS.includes(event.riskLevel)) bucket.byRisk[event.riskLevel] += 1;
  const category = typeof event.category === "string" && event.category.trim() ? event.category : "未分類";
  bucket.byCategory[category] = (bucket.byCategory[category] || 0) + 1;
}

function mergeDay(previous, current) {
  const prev = normalizeDay(previous);
  const cur = normalizeDay(current);
  const out = emptyDay();

  out.total = Math.max(prev.total, cur.total);
  for (const scope of SCOPES) out.byScope[scope] = Math.max(prev.byScope[scope], cur.byScope[scope]);
  for (const risk of RISKS) out.byRisk[risk] = Math.max(prev.byRisk[risk], cur.byRisk[risk]);
  for (const category of new Set([...Object.keys(prev.byCategory), ...Object.keys(cur.byCategory)])) {
    out.byCategory[category] = Math.max(prev.byCategory[category] || 0, cur.byCategory[category] || 0);
  }
  return out;
}

function taiwanDayToTime(day) {
  return Date.parse(`${day}T00:00:00+08:00`);
}

function maxDay(days) {
  return days.length ? [...days].sort().at(-1) : null;
}

function cutoffDay(anchorDay, retentionDays) {
  const retention = Number.isFinite(retentionDays) ? Math.max(0, Math.floor(retentionDays)) : 90;
  if (retention <= 0) return null;
  return new Date(taiwanDayToTime(anchorDay) - (retention - 1) * DAY_MS + TAIWAN_OFFSET_MS).toISOString().slice(0, 10);
}

export function applyDailyRollup(previous, events, { retentionDays = 90 } = {}) {
  const normalized = normalizePrevious(previous);
  const currentDays = {};

  for (const event of Array.isArray(events) ? events : []) {
    const day = taiwanLocalDay(event?.timestamp);
    if (!day) continue;
    if (!currentDays[day]) currentDays[day] = emptyDay();
    increment(currentDays[day], event || {});
  }

  const merged = {};
  for (const day of new Set([...Object.keys(normalized.days), ...Object.keys(currentDays)])) {
    merged[day] = mergeDay(normalized.days[day], currentDays[day]);
  }

  const anchor = maxDay(Object.keys(currentDays)) || maxDay(Object.keys(normalized.days));
  const cutoff = anchor ? cutoffDay(anchor, retentionDays) : null;
  const retained = {};
  for (const day of Object.keys(merged).sort()) {
    if (cutoff && day < cutoff) continue;
    retained[day] = merged[day];
  }

  return { days: retained };
}
