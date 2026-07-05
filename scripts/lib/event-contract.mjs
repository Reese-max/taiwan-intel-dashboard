const REQUIRED_SCOPE = new Set(["domestic", "international"]);
const REQUIRED_RISK_LEVEL = new Set(["low", "medium", "high", "critical"]);

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

const eventReason = (event) => {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return "非物件";
  }
  if (!isNonEmptyString(event.id)) return "缺 id";
  if (!isNonEmptyString(event.title)) return "缺 title";
  if (!isNonEmptyString(event.region)) return "缺 region";
  if (!isNonEmptyString(event.timestamp)) return "缺 timestamp";
  if (!isNonEmptyString(event.category)) return "缺 category";
  if (!isNonEmptyString(event.summary)) return "缺 summary";
  if (!isNonEmptyString(event.scope)) return "缺 scope";
  if (!REQUIRED_SCOPE.has(event.scope)) return `scope 非法:${event.scope}`;
  if (!isNonEmptyString(event.riskLevel)) return "缺 riskLevel";
  if (!REQUIRED_RISK_LEVEL.has(event.riskLevel)) return `riskLevel 非法:${event.riskLevel}`;
  if (!event.source || typeof event.source !== "object" || Array.isArray(event.source)) return "缺 source";
  if (!isNonEmptyString(event.source.name)) return "缺 source.name";
  if (!isNonEmptyString(event.source.fetchedAt)) return "缺 source.fetchedAt";

  return "";
};

// 遠未來時間戳（> now + horizonDays）幾乎必為來源解析錯誤（如民國→西元誤植：民國155→2066），
// 會在時序排序冒充「最新」排到最頂並破壞保留窗。保守夾住到 source.fetchedAt（保留事件、修正不可能日期）。
// 只夾「遠未來」；不動過去時間戳（歷史 gov 開放資料為合法舊紀錄）。合法排程未來（集會遊行）多在數天~數月內、遠低於門檻。
export function clampImplausibleTimestamps(events, { now = Date.now(), horizonDays = 400 } = {}) {
  const input = Array.isArray(events) ? events : [];
  const limit = now + horizonDays * 864e5;
  let clamped = 0;
  const out = input.map((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return event;
    const t = Date.parse(event.timestamp);
    if (!Number.isFinite(t) || t <= limit) return event;
    clamped++;
    const fetchedAt = event.source?.fetchedAt;
    const fallback = isNonEmptyString(fetchedAt) && Number.isFinite(Date.parse(fetchedAt))
      ? fetchedAt
      : new Date(now).toISOString();
    return { ...event, timestamp: fallback, timestampClamped: true };
  });
  return { events: out, clamped };
}

export function validateEventContract(events) {
  const input = Array.isArray(events) ? events : [];
  const valid = [];
  const invalid = [];

  for (const event of input) {
    const reason = eventReason(event);
    if (reason) {
      invalid.push({
        id: event && typeof event === "object" && !Array.isArray(event) && isNonEmptyString(event.id) ? event.id : "(no-id)",
        reason,
      });
      continue;
    }
    valid.push(event);
  }

  return { valid, invalid };
}
