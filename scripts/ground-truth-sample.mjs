#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PER_CELL = 5;
const DEFAULT_SEED = 42;

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function lcgNext(value) {
  return (Math.imul(value, 1664525) + 1013904223) >>> 0;
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sampleCell(rows, count, seed, cellKey) {
  if (rows.length <= count) {
    return [...rows].sort((a, b) => compareText(String(a.id ?? ""), String(b.id ?? "")));
  }

  return rows
    .map((row, index) => ({
      row,
      index,
      score: lcgNext(hashString(`${seed}|${cellKey}|${String(row.id ?? "")}|${index}`)),
    }))
    .sort((a, b) => a.score - b.score || compareText(String(a.row.id ?? ""), String(b.row.id ?? "")) || a.index - b.index)
    .slice(0, count)
    .map((entry) => entry.row)
    .sort((a, b) => compareText(String(a.category ?? ""), String(b.category ?? "")) || compareText(String(a.riskLevel ?? ""), String(b.riskLevel ?? "")) || compareText(String(a.id ?? ""), String(b.id ?? "")));
}

export function sampleGroundTruthRows(events, options = {}) {
  const perCell = Number.isFinite(Number(options.perCell)) ? Math.max(0, Math.floor(Number(options.perCell))) : DEFAULT_PER_CELL;
  const seed = Number.isFinite(Number(options.seed)) ? Math.floor(Number(options.seed)) : DEFAULT_SEED;
  const groups = new Map();

  for (const event of events ?? []) {
    const category = String(event?.category ?? "").trim();
    const riskLevel = String(event?.riskLevel ?? "").trim();
    if (!category || !riskLevel) continue;
    const key = `${category}\u0000${riskLevel}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }

  const stats = [];
  const rows = [];
  const keys = [...groups.keys()].sort(compareText);

  for (const key of keys) {
    const [category, riskLevel] = key.split("\u0000");
    const cellRows = groups.get(key);
    const sampled = sampleCell(cellRows, perCell, seed, key);
    stats.push({ category, riskLevel, available: cellRows.length, sampled: sampled.length });
    for (const event of sampled) {
      rows.push({
        id: String(event.id ?? ""),
        title: String(event.title ?? ""),
        summary: String(event.summary ?? ""),
        category,
        riskLevel,
        human_category: "",
        human_risk: "",
        notes: "",
      });
    }
  }

  return { rows, stats, total: rows.length };
}

export function parseSampleArgs(argv) {
  const args = {
    input: "public/data/domestic.json",
    out: "",
    perCell: DEFAULT_PER_CELL,
    seed: DEFAULT_SEED,
    date: "",
  };

  for (const arg of argv) {
    if (arg.startsWith("--input=")) args.input = arg.slice("--input=".length);
    else if (arg.startsWith("--out=")) args.out = arg.slice("--out=".length);
    else if (arg.startsWith("--per-cell=")) args.perCell = Number(arg.slice("--per-cell=".length));
    else if (arg.startsWith("--seed=")) args.seed = Number(arg.slice("--seed=".length));
    else if (arg.startsWith("--date=")) args.date = arg.slice("--date=".length);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

export function formatStats(stats, total) {
  return [
    "category\triskLevel\tavailable\tsampled",
    ...stats.map((stat) => `${stat.category}\t${stat.riskLevel}\t${stat.available}\t${stat.sampled}`),
    `total\t\t\t${total}`,
  ].join("\n");
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

function usage() {
  return [
    "Usage: node scripts/ground-truth-sample.mjs [--input=public/data/domestic.json] [--out=docs/ground-truth/sample-YYYYMMDD.jsonl] [--per-cell=5] [--seed=42] [--date=YYYYMMDD]",
  ].join("\n");
}

export function runSampleCli(argv = process.argv.slice(2)) {
  const args = parseSampleArgs(argv);
  if (args.help) {
    console.log(usage());
    return { outputPath: "", rows: [], stats: [], total: 0 };
  }

  const date = args.date || todayYmd();
  const outputPath = args.out || `docs/ground-truth/sample-${date}.jsonl`;
  const input = JSON.parse(readFileSync(args.input, "utf8"));
  const result = sampleGroundTruthRows(input, { perCell: args.perCell, seed: args.seed });
  const jsonl = result.rows.map((row) => JSON.stringify(row)).join("\n") + (result.rows.length ? "\n" : "");

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, jsonl, "utf8");
  console.log(formatStats(result.stats, result.total));
  return { outputPath, ...result };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runSampleCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
