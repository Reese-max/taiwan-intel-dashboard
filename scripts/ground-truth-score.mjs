#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RISK_ORDER = new Map([
  ["low", 0],
  ["medium", 1],
  ["high", 2],
  ["critical", 3],
]);

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function nonEmpty(value) {
  return String(value ?? "").trim() !== "";
}

function makeMetric(matches, total) {
  return { matches, count: matches, total, rate: total === 0 ? 0 : matches / total };
}

function addConfusion(confusions, type, pipeline, human) {
  if (pipeline === human) return;
  const pair = `${pipeline}→${human}`;
  const key = `${type}\u0000${pair}`;
  confusions.set(key, (confusions.get(key) ?? 0) + 1);
}

export function scoreGroundTruthRows(rows) {
  let categoryTotal = 0;
  let categoryMatches = 0;
  let riskTotal = 0;
  let riskMatches = 0;
  let severeUnderCount = 0;
  const confusionCounts = new Map();

  for (const row of rows ?? []) {
    const pipelineCategory = String(row?.category ?? "").trim();
    const humanCategory = String(row?.human_category ?? "").trim();
    const pipelineRisk = String(row?.riskLevel ?? "").trim();
    const humanRisk = String(row?.human_risk ?? "").trim();

    if (nonEmpty(humanCategory)) {
      categoryTotal += 1;
      if (pipelineCategory === humanCategory) categoryMatches += 1;
      addConfusion(confusionCounts, "category", pipelineCategory, humanCategory);
    }

    if (nonEmpty(humanRisk)) {
      riskTotal += 1;
      if (pipelineRisk === humanRisk) riskMatches += 1;
      addConfusion(confusionCounts, "risk", pipelineRisk, humanRisk);

      const pipelineRank = RISK_ORDER.get(pipelineRisk);
      const humanRank = RISK_ORDER.get(humanRisk);
      if (pipelineRank !== undefined && humanRank !== undefined && humanRank - pipelineRank >= 2) {
        severeUnderCount += 1;
      }
    }
  }

  const confusions = [...confusionCounts.entries()]
    .map(([key, count]) => {
      const [type, pair] = key.split("\u0000");
      return { type, pair, count };
    })
    .sort((a, b) => b.count - a.count || compareText(a.type, b.type) || compareText(a.pair, b.pair))
    .slice(0, 10);

  return {
    category: makeMetric(categoryMatches, categoryTotal),
    risk: makeMetric(riskMatches, riskTotal),
    severeUnderestimation: makeMetric(severeUnderCount, riskTotal),
    confusions,
  };
}

export function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function parseScoreArgs(argv) {
  const args = { file: "" };
  for (const arg of argv) {
    if (arg.startsWith("--file=")) args.file = arg.slice("--file=".length);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function formatRate(metric) {
  return `${metric.matches}/${metric.total} (${(metric.rate * 100).toFixed(2)}%)`;
}

export function formatScore(result) {
  return [
    `category 一致率: ${formatRate(result.category)}`,
    `risk 一致率: ${formatRate(result.risk)}`,
    `風險嚴重低估率: ${result.severeUnderestimation.matches}/${result.severeUnderestimation.total} (${(result.severeUnderestimation.rate * 100).toFixed(2)}%)`,
    "混淆對 top 10:",
    ...(result.confusions.length ? result.confusions.map((item) => `${item.type} ${item.pair}: ${item.count}`) : ["(none)"]),
  ].join("\n");
}

function usage() {
  return "Usage: node scripts/ground-truth-score.mjs --file=docs/ground-truth/sample-YYYYMMDD.jsonl";
}

export function runScoreCli(argv = process.argv.slice(2)) {
  const args = parseScoreArgs(argv);
  if (args.help) {
    console.log(usage());
    return null;
  }
  if (!args.file) throw new Error("Missing required --file= path");

  const rows = parseJsonl(readFileSync(args.file, "utf8"));
  const result = scoreGroundTruthRows(rows);
  console.log(formatScore(result));
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runScoreCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
