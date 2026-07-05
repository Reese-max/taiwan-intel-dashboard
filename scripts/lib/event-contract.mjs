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
