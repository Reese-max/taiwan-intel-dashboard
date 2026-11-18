// Keep prior events and their original success time visible as stale.
export const POLICE_CARRYOVER_MAX_HOURS = 14 * 24;
export const SOURCE_CARRYOVER_POLICIES = Object.freeze({
  police: { datasetId: "13166", maxHours: POLICE_CARRYOVER_MAX_HOURS },
  missing: { datasetId: "14420", maxHours: 72 },
  cwa: { datasetId: "E-A0015-001", maxHours: 24 },
  cwaWarnings: { datasetId: "W-C0033-001", maxHours: 24 },
});

export function sourceCarryoverEvidence({ events = [], provenance = {}, datasetId, maxHours, now = Date.now() } = {}) {
  const count = events.filter((event) => event?.source?.datasetId === datasetId).length;
  const sources = Array.isArray(provenance?.sources) ? provenance.sources : [];
  const source = sources.find((item) => item?.datasetId === datasetId);
  const lastSuccessAt = source?.lastSuccessAt || (source?.stale === true ? "" : source?.fetchedAt);
  const carryOver = { count, lastSuccessAt };
  return canCarryOverSource({ ok: false, carryOver }, { now, maxHours }) ? carryOver : null;
}

export function canCarryOverSource(status, { now = Date.now(), maxHours } = {}) {
  if (status?.ok !== false) return false;
  const count = Number(status?.carryOver?.count);
  const ageHours = (Number(now) - Date.parse(status?.carryOver?.lastSuccessAt)) / 3_600_000;
  return Number.isInteger(count) && count >= 1 && Number.isFinite(ageHours) && ageHours >= 0 && ageHours <= maxHours;
}
