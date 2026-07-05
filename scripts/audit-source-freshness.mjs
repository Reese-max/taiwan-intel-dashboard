// 來源新鮮度健康稽核。
// 目的：避免結構化來源長期失敗但持續沿用舊資料時，CI 仍誤判健康。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = join(ROOT, "public", "data", "provenance.json");
const DEFAULT_THRESHOLDS = { "gov-open-data": 48, cwa: 6 };
const STRUCTURED_TYPES = new Set(Object.keys(DEFAULT_THRESHOLDS));

function argValue(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

function numericThreshold(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseTime(value) {
  if (!value) return NaN;
  if (Number.isFinite(value)) return value;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : NaN;
}

function roundAgeHours(ageHours) {
  return Math.round(ageHours * 10) / 10;
}

function sourceField(value, fallback = "") {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

export function auditSourceFreshness(provenance, { now, thresholds } = {}) {
  const generatedAt = provenance?.generatedAt || "";
  const nowMs = now === undefined ? parseTime(generatedAt) : parseTime(now);
  const limits = { ...DEFAULT_THRESHOLDS, ...(thresholds || {}) };
  const sources = Array.isArray(provenance?.sources) ? provenance.sources : [];
  const staleStructured = [];
  let structuredChecked = 0;
  let newsStaleCount = 0;
  let worst = null;

  for (const source of sources) {
    if (!source) continue;
    const type = sourceField(source.type);
    const name = sourceField(source.name, "(未命名來源)");
    const category = sourceField(source.category);
    const ageBase = parseTime(source.lastSuccessAt || source.fetchedAt);
    const ageHours = Number.isFinite(nowMs) && Number.isFinite(ageBase) ? (nowMs - ageBase) / 3.6e6 : NaN;

    if (Number.isFinite(ageHours)) {
      const roundedAge = roundAgeHours(ageHours);
      if (!worst || roundedAge > worst.ageHours) worst = { name, ageHours: roundedAge };
    }

    if (STRUCTURED_TYPES.has(type)) {
      structuredChecked++;
      const threshold = numericThreshold(limits[type], DEFAULT_THRESHOLDS[type]);
      if (Number.isFinite(ageHours) && ageHours > threshold) {
        staleStructured.push({
          name,
          type,
          category,
          ageHours: roundAgeHours(ageHours),
          threshold,
        });
      }
      continue;
    }

    if (source.stale === true || (type === "news-rss" && Number.isFinite(ageHours) && ageHours > 0)) newsStaleCount++;
  }

  staleStructured.sort((a, b) => b.ageHours - a.ageHours || a.name.localeCompare(b.name, "zh-Hant"));

  return {
    ok: staleStructured.length === 0,
    generatedAt,
    structuredChecked,
    staleStructured,
    newsStaleCount,
    worst,
  };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = argValue("file") || DATA_FILE;
  let provenance = {};
  try {
    provenance = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`無法讀取 ${file}：${e.message}`);
    process.exit(1);
  }

  const result = auditSourceFreshness(provenance, {
    thresholds: {
      "gov-open-data": numericThreshold(process.env.SOURCE_FRESH_GOV_MAX_H, DEFAULT_THRESHOLDS["gov-open-data"]),
      cwa: numericThreshold(process.env.SOURCE_FRESH_CWA_MAX_H, DEFAULT_THRESHOLDS.cwa),
    },
  });

  console.log(`來源新鮮度稽核（generatedAt=${result.generatedAt || "未知"}）：`);
  console.log(`  結構化來源 ${result.structuredChecked} 筆；newsStaleCount=${result.newsStaleCount}（news-rss carry-over 僅資訊，不作 gate）`);
  if (result.worst) console.log(`  最舊來源：${result.worst.name} age=${result.worst.ageHours.toFixed(1)}h`);

  if (result.ok) {
    console.log("健康：無結構化來源超過 age 門檻");
  } else {
    console.error("結構化來源陳舊：");
    for (const row of result.staleStructured) {
      console.error(`  - ${row.name} (${row.type}/${row.category || "未分類"}) age=${row.ageHours.toFixed(1)}h > ${row.threshold}h`);
    }
    process.exit(1);
  }
}
