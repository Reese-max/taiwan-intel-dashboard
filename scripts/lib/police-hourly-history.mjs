const TAIWAN_OFFSET_MS = 8 * 60 * 60 * 1000;

export function taiwanLocalHour(isoLike) {
  const time = Date.parse(isoLike);
  if (!Number.isFinite(time)) return "";
  return `${new Date(time + TAIWAN_OFFSET_MS).toISOString().slice(0, 13).replace("T", " ")}:00`;
}

export function eventFingerprint(event) {
  const datasetId = event?.source?.datasetId || "no-dataset";
  const recordRef = event?.source?.recordRef || event?.id || event?.title || "no-record";
  return `${datasetId}:${recordRef}`;
}

function recordNode(event, fingerprint) {
  return {
    fingerprint,
    id: event.id,
    title: event.title,
    category: event.category,
    region: event.region,
    timestamp: event.timestamp,
    riskLevel: event.riskLevel,
    sourceName: event.source?.name,
    datasetId: event.source?.datasetId,
    recordRef: event.source?.recordRef,
    fetchedAt: event.source?.fetchedAt,
    url: event.source?.url,
  };
}

function categoriesFromRecords(records) {
  const categoryMap = new Map();
  for (const record of records) {
    const category = record.category || "未分類";
    const sourceName = record.sourceName || "未知來源";
    const datasetId = record.datasetId;
    if (!categoryMap.has(category)) {
      categoryMap.set(category, { name: category, count: 0, sourceMap: new Map() });
    }
    const cat = categoryMap.get(category);
    cat.count += 1;
    const sourceKey = `${sourceName}\u0000${datasetId || ""}`;
    if (!cat.sourceMap.has(sourceKey)) {
      cat.sourceMap.set(sourceKey, { name: sourceName, datasetId, count: 0, records: [] });
    }
    const source = cat.sourceMap.get(sourceKey);
    source.count += 1;
    source.records.push(record);
  }

  return [...categoryMap.values()]
    .map((cat) => ({
      name: cat.name,
      count: cat.count,
      sources: [...cat.sourceMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function seenFromInputs(previousHistory, previousLedger) {
  const seen = new Set(Array.isArray(previousLedger?.seen) ? previousLedger.seen : []);
  for (const run of previousHistory?.runs || []) {
    for (const record of run.newRecords || []) {
      if (record.fingerprint) seen.add(record.fingerprint);
    }
  }
  return seen;
}

function mergeRun(existing, incoming, minimumNewPerHour) {
  if (!existing) return incoming;
  const recordsByFingerprint = new Map();
  for (const record of existing.newRecords || []) recordsByFingerprint.set(record.fingerprint, record);
  for (const record of incoming.newRecords || []) recordsByFingerprint.set(record.fingerprint, record);
  const newRecords = [...recordsByFingerprint.values()];
  const duplicateFromPriorCount = (existing.duplicateFromPriorCount || 0) + incoming.duplicateFromPriorCount;
  const deferredNewCandidateCount = incoming.deferredNewCandidateCount;
  const totalFetchedPoliceRelated = Math.max(
    existing.totalFetchedPoliceRelated || 0,
    incoming.totalFetchedPoliceRelated || 0,
  );
  return {
    ...existing,
    generatedAt: incoming.generatedAt,
    totalFetchedPoliceRelated,
    uniqueFetchedPoliceRelated: Math.max(
      existing.uniqueFetchedPoliceRelated || 0,
      incoming.uniqueFetchedPoliceRelated || 0,
    ),
    newPoliceRelatedCount: newRecords.length,
    duplicateFromPriorCount,
    deferredNewCandidateCount,
    minimumNewPerHour,
    meetsNewHourlyMinimum: newRecords.length >= minimumNewPerHour,
    runAttempts: (existing.runAttempts || 1) + 1,
    newRecords,
    categories: categoriesFromRecords(newRecords),
  };
}

export function applyPoliceHourlyRun({
  generatedAt,
  events,
  previousHistory = { runs: [] },
  previousLedger = { seen: [] },
  minimumNewPerHour = 200,
  maxNewPerRun = Number.POSITIVE_INFINITY,
  retentionDays = Number.POSITIVE_INFINITY,
}) {
  const hourLocal = taiwanLocalHour(generatedAt);
  const previousRuns = Array.isArray(previousHistory?.runs) ? previousHistory.runs : [];
  const existing = previousRuns.find((run) => run.hourLocal === hourLocal);
  const existingNewCount = existing?.newRecords?.length || 0;
  const remainingNewSlots = Number.isFinite(maxNewPerRun)
    ? Math.max(0, maxNewPerRun - existingNewCount)
    : Number.POSITIVE_INFINITY;
  const seen = seenFromInputs(previousHistory, previousLedger);
  const fetchedFingerprints = new Set();
  const newRecords = [];
  let duplicateFromPriorCount = 0;
  let deferredNewCandidateCount = 0;

  for (const event of events) {
    const fingerprint = eventFingerprint(event);
    fetchedFingerprints.add(fingerprint);
    if (seen.has(fingerprint)) {
      duplicateFromPriorCount += 1;
      continue;
    }
    if (newRecords.length >= remainingNewSlots) {
      deferredNewCandidateCount += 1;
      continue;
    }
    seen.add(fingerprint);
    newRecords.push(recordNode(event, fingerprint));
  }

  const incomingRun = {
    generatedAt,
    hourLocal,
    totalFetchedPoliceRelated: events.length,
    uniqueFetchedPoliceRelated: fetchedFingerprints.size,
    newPoliceRelatedCount: newRecords.length,
    duplicateFromPriorCount,
    deferredNewCandidateCount,
    minimumNewPerHour,
    meetsNewHourlyMinimum: newRecords.length >= minimumNewPerHour,
    runAttempts: 1,
    newRecords,
    categories: categoriesFromRecords(newRecords),
  };

  const mergedRun = mergeRun(existing, incomingRun, minimumNewPerHour);
  const otherRuns = previousRuns.filter((run) => run.hourLocal !== hourLocal);
  const runs = [...otherRuns, mergedRun].sort((a, b) => String(b.hourLocal).localeCompare(String(a.hourLocal)));
  const cutoffLocal =
    Number.isFinite(retentionDays) && Number.isFinite(Date.parse(generatedAt))
      ? taiwanLocalHour(new Date(Date.parse(generatedAt) - retentionDays * 86400000).toISOString())
      : "";
  const retainedRuns = Number.isFinite(retentionDays)
    ? runs.filter((run) => String(run.hourLocal) >= cutoffLocal)
    : runs;

  return {
    run: mergedRun,
    history: {
      generatedAt,
      minimumNewPerHour,
      runs: retainedRuns,
    },
    ledger: {
      generatedAt,
      seen: [...seen].sort(),
    },
  };
}
