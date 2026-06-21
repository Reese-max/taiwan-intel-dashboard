const TAIWAN_OFFSET_MS = 8 * 60 * 60 * 1000;

export function taiwanLocalDate(isoLike) {
  const time = Date.parse(isoLike);
  if (!Number.isFinite(time)) return "";
  return new Date(time + TAIWAN_OFFSET_MS).toISOString().slice(0, 10);
}

function recordNode(event) {
  return {
    id: event.id,
    title: event.title,
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

function groupByCategoryAndSource(events, { includeRecords = false } = {}) {
  const categoryMap = new Map();

  for (const event of events) {
    const category = event.category || "未分類";
    const sourceName = event.source?.name || "未知來源";
    const datasetId = event.source?.datasetId;

    if (!categoryMap.has(category)) {
      categoryMap.set(category, { name: category, count: 0, sourceMap: new Map() });
    }
    const cat = categoryMap.get(category);
    cat.count += 1;

    const sourceKey = `${sourceName}\u0000${datasetId || ""}`;
    if (!cat.sourceMap.has(sourceKey)) {
      cat.sourceMap.set(sourceKey, { name: sourceName, datasetId, count: 0 });
    }
    const source = cat.sourceMap.get(sourceKey);
    source.count += 1;
    if (includeRecords) {
      if (!source.records) source.records = [];
      source.records.push(recordNode(event));
    }
  }

  return [...categoryMap.values()]
    .map((cat) => ({
      name: cat.name,
      count: cat.count,
      sources: [...cat.sourceMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function buildPoliceSourceTree({ generatedAt, events, minimumPerHour, todayMinimum = 150 }) {
  const localDate = taiwanLocalDate(generatedAt);
  const todayEvents = events.filter((event) => taiwanLocalDate(event.source?.fetchedAt || event.timestamp) === localDate);

  const total = events.length;
  return {
    generatedAt,
    minimumPerHour,
    todayMinimum,
    total,
    meetsHourlyMinimum: total >= minimumPerHour,
    today: {
      localDate,
      minimum: todayMinimum,
      total: todayEvents.length,
      meetsMinimum: todayEvents.length >= todayMinimum,
      categories: groupByCategoryAndSource(todayEvents, { includeRecords: true }),
    },
    categories: groupByCategoryAndSource(events, { includeRecords: true }),
  };
}
