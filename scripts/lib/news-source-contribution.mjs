const UNKNOWN_LABEL = "未標示來源";

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function getLabel(rowOrItem) {
  const label = rowOrItem?.source || rowOrItem?.label || rowOrItem?.sourceName;
  return String(label || UNKNOWN_LABEL).trim() || UNKNOWN_LABEL;
}

function getRow(rows, label) {
  const key = String(label || UNKNOWN_LABEL).trim() || UNKNOWN_LABEL;
  if (!rows.has(key)) {
    rows.set(key, {
      label: key,
      raw: 0,
      rawUnique: 0,
      policeRelevant: 0,
      finalEvents: 0,
    });
  }
  return rows.get(key);
}

function count(rows, label, field) {
  const row = getRow(rows, label);
  row[field] += 1;
}

function countByLabel(map, label) {
  const key = String(label || UNKNOWN_LABEL).trim() || UNKNOWN_LABEL;
  map.set(key, (map.get(key) || 0) + 1);
}

function sourceQueryFeedLabel(query = "") {
  const text = String(query || "").trim();
  const match = text.match(/^(GN [^｜|]+)[｜|]\s*RSS\b/);
  return match?.[1]?.trim();
}

export function eventFeedLabel(event, { recordRefToLabel } = {}) {
  const source = event?.source || {};
  const ref = source.recordRef || source.url;
  if (ref && recordRefToLabel?.has(ref)) return recordRefToLabel.get(ref);

  const queryLabel = sourceQueryFeedLabel(source.query);
  if (queryLabel) return queryLabel;

  return String(source.name || UNKNOWN_LABEL).trim() || UNKNOWN_LABEL;
}

export function buildNewsSourceContribution({
  rawItems = [],
  uniqueItems = [],
  policeItems = [],
  preRetentionEvents = null,
  finalEvents = [],
  feedStatus = [],
} = {}) {
  const rows = new Map();
  const recordRefToLabel = new Map();
  const preRetentionByLabel = new Map();

  for (const feed of feedStatus || []) getRow(rows, getLabel(feed));

  for (const item of rawItems || []) {
    const label = getLabel(item);
    count(rows, label, "raw");
    if (item?.link) recordRefToLabel.set(item.link, label);
  }

  for (const item of uniqueItems || []) count(rows, getLabel(item), "rawUnique");
  for (const item of policeItems || []) count(rows, getLabel(item), "policeRelevant");
  for (const event of preRetentionEvents || finalEvents || []) {
    const label = eventFeedLabel(event, { recordRefToLabel });
    getRow(rows, label);
    countByLabel(preRetentionByLabel, label);
  }
  for (const event of finalEvents || []) count(rows, eventFeedLabel(event, { recordRefToLabel }), "finalEvents");

  const totalFinalEvents = Array.from(rows.values()).reduce((sum, row) => sum + row.finalEvents, 0);
  const finalRows = Array.from(rows.values()).map((row) => {
    const dedupedAway = Math.max(0, row.raw - row.rawUnique);
    const nonPolice = Math.max(0, row.rawUnique - row.policeRelevant);
    const beforeRetention = preRetentionByLabel.get(row.label) || row.finalEvents;
    const droppedByRetention = Math.max(0, beforeRetention - row.finalEvents);
    const droppedAfterPolice = Math.max(0, row.policeRelevant - row.finalEvents);
    const lowBecauseDroppedByRetention = row.policeRelevant > 0 && row.finalEvents === 0 && droppedByRetention > 0;
    const lowBecauseZero = row.raw >= 3 && row.finalEvents === 0;
    const lowBecauseTiny = row.raw >= 10 && row.finalEvents <= 1;
    const lowContribution = lowBecauseDroppedByRetention || lowBecauseZero || lowBecauseTiny;
    return {
      ...row,
      dedupedAway,
      nonPolice,
      droppedByRetention,
      droppedAfterPolice,
      uniqueRate: row.raw ? round(row.rawUnique / row.raw) : 0,
      relevanceRate: row.rawUnique ? round(row.policeRelevant / row.rawUnique) : 0,
      finalShare: totalFinalEvents ? round(row.finalEvents / totalFinalEvents) : 0,
      lowContribution,
      lowContributionReason: lowContribution
        ? lowBecauseDroppedByRetention
          ? "dropped_by_retention"
          : lowBecauseZero
          ? "raw_without_final"
          : "low_final_events"
        : undefined,
    };
  });

  finalRows.sort(
    (a, b) =>
      b.finalEvents - a.finalEvents ||
      b.policeRelevant - a.policeRelevant ||
      b.rawUnique - a.rawUnique ||
      b.raw - a.raw ||
      a.label.localeCompare(b.label, "zh-Hant"),
  );

  return {
    rows: finalRows,
    lowContributionFeeds: finalRows.filter((row) => row.lowContribution).map((row) => row.label),
    totals: {
      raw: finalRows.reduce((sum, row) => sum + row.raw, 0),
      rawUnique: finalRows.reduce((sum, row) => sum + row.rawUnique, 0),
      policeRelevant: finalRows.reduce((sum, row) => sum + row.policeRelevant, 0),
      finalEvents: totalFinalEvents,
      droppedByRetention: finalRows.reduce((sum, row) => sum + row.droppedByRetention, 0),
    },
  };
}

export function formatNewsSourceContributionReport(contribution, { limit = 20 } = {}) {
  const rows = contribution?.rows || [];
  if (!rows.length) return "台灣新聞來源貢獻：無資料";

  const totals = contribution?.totals || {};
  const shown = rows.slice(0, limit);
  const lines = [
    `台灣新聞來源貢獻（落地/原始）：${totals.finalEvents || 0}/${totals.raw || 0}；去重後 ${totals.rawUnique || 0}；警政相關 ${totals.policeRelevant || 0}；保留窗丟棄 ${totals.droppedByRetention || 0}`,
  ];

  for (const [idx, row] of shown.entries()) {
    const pct = `${round(row.finalShare * 100, 1)}%`;
    const warning = row.lowContribution ? " ⚠低貢獻" : "";
    const retention = row.droppedByRetention ? `，保留窗丟 ${row.droppedByRetention}` : "";
    lines.push(
      `${idx + 1}. ${row.label}：${row.finalEvents}/${row.raw}（去重後 ${row.rawUnique}，警政 ${row.policeRelevant}，去重掉 ${row.dedupedAway}${retention}，占比 ${pct}）${warning}`,
    );
  }

  if (rows.length > shown.length) lines.push(`…另 ${rows.length - shown.length} 個來源未列出`);
  if (contribution?.lowContributionFeeds?.length) {
    lines.push(`低貢獻來源：${contribution.lowContributionFeeds.join("、")}`);
  }
  return lines.join("\n");
}

export function findLowContributionRows(rows = [], { rawMin = 10, finalMax = 1 } = {}) {
  return (rows || [])
    .filter((row) => Number(row.raw || 0) >= rawMin && Number(row.finalEvents || 0) <= finalMax)
    .map((row) => ({
      label: row.label,
      raw: Number(row.raw || 0),
      finalEvents: Number(row.finalEvents || 0),
    }));
}
