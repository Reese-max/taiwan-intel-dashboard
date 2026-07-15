// 每日 coverage 矩陣：把事件與 provenance 來源依 scope/category 對齊，供 CI 與人工盤點盲區。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OFFICIAL_TYPES = new Set(["gov-open-data", "cwa"]);

function taiwanDay(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 10) : "";
}

function blankRow(scope, category) {
  return {
    scope,
    category,
    events: 0,
    elevatedEvents: 0,
    locatedEvents: 0,
    officialEvents: 0,
    newsEvents: 0,
    sourceRows: 0,
    healthySources: 0,
    contributingSources: 0,
    officialSources: 0,
  };
}

export function buildCoverageMatrix({ generatedAt = new Date().toISOString(), events = [], sources = [] } = {}) {
  const rows = new Map();
  const get = (scope, category) => {
    const key = `${scope || "unknown"}\u0000${category || "未分類"}`;
    if (!rows.has(key)) rows.set(key, blankRow(scope || "unknown", category || "未分類"));
    return rows.get(key);
  };

  for (const event of Array.isArray(events) ? events : []) {
    if (!event) continue;
    const row = get(event.scope, event.category);
    row.events++;
    if (event.riskLevel === "high" || event.riskLevel === "critical") row.elevatedEvents++;
    if (Number.isFinite(event.lat) && Number.isFinite(event.lng)) row.locatedEvents++;
    if (OFFICIAL_TYPES.has(event.source?.type)) row.officialEvents++;
    if (event.source?.type === "news-rss" || event.source?.datasetId === "tw-news") row.newsEvents++;
  }

  for (const source of Array.isArray(sources) ? sources : []) {
    if (!source) continue;
    const row = get(source.scope, source.category);
    row.sourceRows++;
    if (source.stale !== true) row.healthySources++;
    if (Number(source.count || 0) > 0) row.contributingSources++;
    if (OFFICIAL_TYPES.has(source.type)) row.officialSources++;
  }

  const list = [...rows.values()].sort(
    (a, b) => a.scope.localeCompare(b.scope) || a.category.localeCompare(b.category, "zh-Hant"),
  );
  const fields = [
    "events", "elevatedEvents", "locatedEvents", "officialEvents", "newsEvents",
    "sourceRows", "healthySources", "contributingSources", "officialSources",
  ];
  const totals = Object.fromEntries(fields.map((field) => [field, list.reduce((sum, row) => sum + row[field], 0)]));
  return { generatedAt, day: taiwanDay(generatedAt), totals, rows: list };
}

export function auditCoverageMatrix(matrix) {
  const errors = [];
  if (!matrix || typeof matrix !== "object") errors.push("matrix must be an object");
  if (!matrix?.generatedAt || !Number.isFinite(Date.parse(matrix.generatedAt))) errors.push("generatedAt is invalid");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(matrix?.day || ""))) errors.push("day is invalid");
  const rows = Array.isArray(matrix?.rows) ? matrix.rows : [];
  if (!Array.isArray(matrix?.rows)) errors.push("rows must be an array");
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    const key = `${row?.scope}\u0000${row?.category}`;
    if (!row?.scope || !row?.category) errors.push(`row ${index} lacks scope/category`);
    if (seen.has(key)) errors.push(`duplicate row ${row?.scope}/${row?.category}`);
    seen.add(key);
    for (const field of ["events", "sourceRows", "healthySources", "officialEvents"]) {
      if (!Number.isInteger(row?.[field]) || row[field] < 0) errors.push(`row ${index} has invalid ${field}`);
    }
  }
  for (const field of ["events", "sourceRows"]) {
    const sum = rows.reduce((total, row) => total + (Number(row?.[field]) || 0), 0);
    if (sum !== matrix?.totals?.[field]) errors.push(`${field} total ${matrix?.totals?.[field]} != row sum ${sum}`);
  }
  return { ok: errors.length === 0, errors };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const fileArg = process.argv.find((arg) => arg.startsWith("--file="));
  const file = fileArg?.slice("--file=".length) || "public/data/coverage.json";
  let matrix;
  try {
    matrix = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`無法讀取 coverage 矩陣 ${file}：${error.message}`);
    process.exit(1);
  }
  const result = auditCoverageMatrix(matrix);
  console.log(`Coverage 矩陣 ${matrix.day || "未知日期"}：${matrix.totals?.events || 0} 事件／${matrix.totals?.sourceRows || 0} 來源列`);
  for (const row of matrix.rows || []) {
    console.log(`  ${row.scope}/${row.category}: events=${row.events} sources=${row.healthySources}/${row.sourceRows} official=${row.officialEvents}`);
  }
  if (!result.ok) {
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exit(1);
  }
}
