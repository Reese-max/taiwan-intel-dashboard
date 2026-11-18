// Keep prior events and their original success time visible as stale.
export const POLICE_CARRYOVER_MAX_HOURS = 14 * 24;
export const SOURCE_CARRYOVER_POLICIES = Object.freeze({
  police: { datasetId: "13166", maxHours: POLICE_CARRYOVER_MAX_HOURS },
  missing: { datasetId: "14420", maxHours: 72 },
  cwa: { datasetId: "E-A0015-001", maxHours: 24 },
  cwaWarnings: { datasetId: "W-C0033-001", maxHours: 24 },
  // 旅遊警示每輪重抓且同檔輸出，不能拿它的時間冒充國際新聞上次成功。
  international: { evidenceFromEvents: true, excludeDatasetId: "mofa-travel-warning", maxHours: 24 },
});

export function sourceCarryoverEvidence({ events = [], provenance = {}, datasetId, evidenceFromEvents = false, excludeDatasetId, maxHours, now = Date.now() } = {}) {
  if (evidenceFromEvents) events = events.filter((event) => event?.source?.datasetId !== excludeDatasetId);
  const count = evidenceFromEvents ? events.length : events.filter((event) => event?.source?.datasetId === datasetId).length;
  const sources = Array.isArray(provenance?.sources) ? provenance.sources : [];
  const source = sources.find((item) => item?.datasetId === datasetId);
  const lastSuccessAt = evidenceFromEvents
    ? events.reduce((latest, event) => {
      const fetchedAt = event?.source?.fetchedAt;
      return Date.parse(fetchedAt) > (latest ? Date.parse(latest) : -Infinity) ? fetchedAt : latest;
    }, undefined)
    : source?.lastSuccessAt || (source?.stale === true ? "" : source?.fetchedAt);
  const carryOver = { count, lastSuccessAt };
  return canCarryOverSource({ ok: false, carryOver }, { now, maxHours }) ? carryOver : null;
}

export function canCarryOverSource(status, { now = Date.now(), maxHours } = {}) {
  if (status?.ok !== false) return false;
  const count = Number(status?.carryOver?.count);
  const ageHours = (Number(now) - Date.parse(status?.carryOver?.lastSuccessAt)) / 3_600_000;
  return Number.isInteger(count) && count >= 1 && Number.isFinite(ageHours) && ageHours >= 0 && ageHours <= maxHours;
}
