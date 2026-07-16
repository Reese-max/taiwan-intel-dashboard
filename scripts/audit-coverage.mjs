// 每日 coverage 矩陣：把事件與 provenance 來源依 scope/category 對齊，供 CI 與人工盤點盲區。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COUNTY_CENTER } from "./lib/coords.mjs";

const OFFICIAL_TYPES = new Set(["gov-open-data", "cwa"]);
const SOURCE_KINDS = ["official", "news"];
const TAIWAN_COUNTIES = [...new Set(Object.keys(COUNTY_CENTER).map((name) => name.replace(/^台/, "臺")))];
const EXPECTED_DOMESTIC_CATEGORIES = [
  "治安", "社會", "反詐", "災防", "國防", "海事", "採購", "協尋",
  "交通", "食安", "衛生", "環境", "資安", "能源", "水情",
];

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

function lastSevenTaiwanDays(generatedAt) {
  const endDay = taiwanDay(generatedAt);
  const end = Date.parse(`${endDay}T00:00:00.000Z`);
  if (!Number.isFinite(end)) return [];
  return Array.from({ length: 7 }, (_, index) =>
    new Date(end - (6 - index) * 86400000).toISOString().slice(0, 10));
}

function sourceKind(source) {
  if (OFFICIAL_TYPES.has(source?.type)) return "official";
  if (source?.type === "news-rss" || source?.datasetId === "tw-news") return "news";
  return "";
}

function normalizedSourceName(name) {
  return String(name || "").replace(/^(?:台灣|國際)新聞：/, "").trim();
}

function buildFreshnessLookup(sources) {
  const byName = new Map();
  const byDataset = new Map();
  const add = (map, key, source) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(source);
  };
  for (const source of Array.isArray(sources) ? sources : []) {
    add(byName, normalizedSourceName(source?.name), source);
    add(byDataset, source?.datasetId, source);
  }
  return (source) => {
    const exact = byName.get(normalizedSourceName(source?.name));
    const candidates = exact?.length ? exact : byDataset.get(source?.datasetId) || [];
    return candidates.length && candidates.every((row) => row?.stale === true) ? "stale" : "fresh";
  };
}

function buildSevenDayMatrix({ generatedAt, events, sources }) {
  const days = lastSevenTaiwanDays(generatedAt);
  const dayIndex = new Map(days.map((day, index) => [day, index]));
  const categories = [...new Set([
    ...EXPECTED_DOMESTIC_CATEGORIES,
    ...(Array.isArray(events) ? events : [])
      .filter((event) => event?.scope === "domestic" && event?.category)
      .map((event) => event.category),
    ...(Array.isArray(sources) ? sources : [])
      .filter((source) => source?.scope === "domestic" && source?.category)
      .map((source) => source.category),
  ])].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  const rows = [];
  const rowsByKey = new Map();
  for (const region of TAIWAN_COUNTIES) {
    for (const category of categories) {
      for (const kind of SOURCE_KINDS) {
        const row = {
          region,
          category,
          sourceKind: kind,
          daily: days.map((day) => ({ day, fresh: 0, stale: 0 })),
          daysCovered: 0,
          events: 0,
          freshEvents: 0,
          staleEvents: 0,
        };
        rows.push(row);
        rowsByKey.set(`${region}\u0000${category}\u0000${kind}`, row);
      }
    }
  }

  const freshnessFor = buildFreshnessLookup(sources);
  let windowEvents = 0;
  let unmappedEvents = 0;
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.scope !== "domestic") continue;
    const day = taiwanDay(event.timestamp);
    const index = dayIndex.get(day);
    const region = String(event.region || "").replace(/^台/, "臺");
    const kind = sourceKind(event.source);
    if (index === undefined || !kind) continue;
    windowEvents++;
    if (!TAIWAN_COUNTIES.includes(region)) {
      unmappedEvents++;
      continue;
    }
    const row = rowsByKey.get(`${region}\u0000${event.category || "未分類"}\u0000${kind}`);
    if (!row) continue;
    row.daily[index][freshnessFor(event.source)]++;
  }

  for (const row of rows) {
    row.freshEvents = row.daily.reduce((sum, day) => sum + day.fresh, 0);
    row.staleEvents = row.daily.reduce((sum, day) => sum + day.stale, 0);
    row.events = row.freshEvents + row.staleEvents;
    row.daysCovered = row.daily.filter((day) => day.fresh + day.stale > 0).length;
  }
  const gapKey = ({ region, category, sourceKind: kind }) => ({ region, category, sourceKind: kind });
  const blindSpots = rows.filter((row) => row.events === 0).map(gapKey);
  const staleOnly = rows.filter((row) => row.events > 0 && row.freshEvents === 0).map(gapKey);
  // ponytail: 七日事件套用本輪 provenance 健康狀態；只有需要歷史 SLA 證據時才值得另存每日來源健康。
  return {
    days,
    regions: TAIWAN_COUNTIES,
    categories,
    sourceKinds: SOURCE_KINDS,
    freshness: ["fresh", "stale"],
    freshnessBasis: "current-provenance-health-over-7d-event-window",
    interpretation: "blindSpots 表示 7 日內無縣市級觀測事件，不代表現實中沒有事件；全國或無法定位事件另計 unmappedEvents。",
    summary: {
      rows: rows.length,
      coveredRows: rows.length - blindSpots.length,
      blindSpots: blindSpots.length,
      staleOnly: staleOnly.length,
      events: rows.reduce((sum, row) => sum + row.events, 0),
      windowEvents,
      unmappedEvents,
    },
    blindSpots,
    staleOnly,
    rows,
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
  return {
    generatedAt,
    day: taiwanDay(generatedAt),
    totals,
    rows: list,
    matrix7d: buildSevenDayMatrix({ generatedAt, events, sources }),
  };
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

  const matrix7d = matrix?.matrix7d;
  if (!matrix7d || typeof matrix7d !== "object") {
    errors.push("matrix7d must be an object");
  } else {
    const days = Array.isArray(matrix7d.days) ? matrix7d.days : [];
    const regions = Array.isArray(matrix7d.regions) ? matrix7d.regions : [];
    const categories = Array.isArray(matrix7d.categories) ? matrix7d.categories : [];
    const sourceKinds = Array.isArray(matrix7d.sourceKinds) ? matrix7d.sourceKinds : [];
    const matrixRows = Array.isArray(matrix7d.rows) ? matrix7d.rows : [];
    if (days.length !== 7 || days.some((day) => !/^\d{4}-\d{2}-\d{2}$/.test(String(day)))) errors.push("matrix7d days must contain 7 valid days");
    if (regions.length !== 22) errors.push(`matrix7d regions must contain 22 counties, got ${regions.length}`);
    if (sourceKinds.join(",") !== SOURCE_KINDS.join(",")) errors.push("matrix7d sourceKinds must be official,news");
    const expectedRows = regions.length * categories.length * sourceKinds.length;
    if (matrixRows.length !== expectedRows) errors.push(`matrix7d rows ${matrixRows.length} != expected ${expectedRows}`);
    const matrixSeen = new Set();
    for (const [index, row] of matrixRows.entries()) {
      const key = `${row?.region}\u0000${row?.category}\u0000${row?.sourceKind}`;
      if (matrixSeen.has(key)) errors.push(`duplicate matrix7d row ${row?.region}/${row?.category}/${row?.sourceKind}`);
      matrixSeen.add(key);
      if (!regions.includes(row?.region) || !categories.includes(row?.category) || !sourceKinds.includes(row?.sourceKind)) {
        errors.push(`matrix7d row ${index} has invalid dimensions`);
      }
      const daily = Array.isArray(row?.daily) ? row.daily : [];
      if (daily.length !== days.length || daily.some((cell, dayIndex) => cell?.day !== days[dayIndex])) {
        errors.push(`matrix7d row ${index} has invalid daily axis`);
      }
      for (const cell of daily) {
        if (!Number.isInteger(cell?.fresh) || cell.fresh < 0 || !Number.isInteger(cell?.stale) || cell.stale < 0) {
          errors.push(`matrix7d row ${index} has invalid freshness count`);
          break;
        }
      }
      const fresh = daily.reduce((sum, cell) => sum + (Number(cell?.fresh) || 0), 0);
      const stale = daily.reduce((sum, cell) => sum + (Number(cell?.stale) || 0), 0);
      if (fresh !== row?.freshEvents || stale !== row?.staleEvents || fresh + stale !== row?.events) {
        errors.push(`matrix7d row ${index} totals do not match daily cells`);
      }
    }
    const matrixEvents = matrixRows.reduce((sum, row) => sum + (Number(row?.events) || 0), 0);
    if (matrixEvents !== matrix7d?.summary?.events) errors.push(`matrix7d events ${matrix7d?.summary?.events} != row sum ${matrixEvents}`);
    if (matrixEvents + matrix7d?.summary?.unmappedEvents !== matrix7d?.summary?.windowEvents) {
      errors.push("matrix7d mapped and unmapped events do not match windowEvents");
    }
    const zeroRows = matrixRows.filter((row) => row?.events === 0).length;
    if (zeroRows !== matrix7d?.summary?.blindSpots || zeroRows !== matrix7d?.blindSpots?.length) {
      errors.push("matrix7d blind spot summary does not match zero rows");
    }
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
  console.log(`  7 日縣市矩陣：${matrix.matrix7d?.summary?.coveredRows || 0}/${matrix.matrix7d?.summary?.rows || 0} 組有覆蓋；觀測盲點 ${matrix.matrix7d?.summary?.blindSpots || 0}；僅 stale ${matrix.matrix7d?.summary?.staleOnly || 0}；全國／未定位 ${matrix.matrix7d?.summary?.unmappedEvents || 0}`);
  for (const row of matrix.rows || []) {
    console.log(`  ${row.scope}/${row.category}: events=${row.events} sources=${row.healthySources}/${row.sourceRows} official=${row.officialEvents}`);
  }
  if (!result.ok) {
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exit(1);
  }
}
