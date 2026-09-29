// A weekly source must not stop all other live sources during a short upstream outage.
// Keep its prior events and original success time visible as stale; never call them fresh.
export const POLICE_CARRYOVER_MAX_HOURS = 14 * 24;

export function isTransientPoliceFailure(error) {
  return /HTTP(?: Error)?[: ]+\s*(?:429|5\d\d)\b|timed out|timeout|fetch failed|temporary failure|connection (?:reset|refused)/i
    .test(String(error?.message || error || ""));
}

export function policeCarryoverEvidence({ events = [], provenance = {}, now = Date.now() } = {}) {
  const weeklyEvents = events.filter((event) => event?.source?.datasetId === "13166");
  const sources = Array.isArray(provenance?.sources) ? provenance.sources : [];
  const source = sources.find((item) => item?.datasetId === "13166");
  const lastSuccessAt = source?.lastSuccessAt || (source?.stale === true ? "" : source?.fetchedAt);
  const ageHours = (Number(now) - Date.parse(lastSuccessAt)) / 3_600_000;
  if (!weeklyEvents.length || !Number.isFinite(ageHours) || ageHours < 0 || ageHours > POLICE_CARRYOVER_MAX_HOURS) {
    return null;
  }
  return { count: weeklyEvents.length, lastSuccessAt };
}

export function canCarryOverPolice(status, { now = Date.now(), maxHours = POLICE_CARRYOVER_MAX_HOURS } = {}) {
  if (status?.ok !== false || !isTransientPoliceFailure(status?.error)) return false;
  const count = Number(status?.carryOver?.count);
  const ageHours = (Number(now) - Date.parse(status?.carryOver?.lastSuccessAt)) / 3_600_000;
  return count >= 1 && Number.isFinite(ageHours) && ageHours >= 0 && ageHours <= maxHours;
}
