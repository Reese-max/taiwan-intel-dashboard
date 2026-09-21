#!/usr/bin/env node
// Ground-truth benchmark runner（issue #43）：
//   node scripts/ground-truth-benchmark.mjs --pairs=docs/ground-truth/relations/pairs-v1.jsonl \
//     [--locations=docs/ground-truth/relations/locations-v1.jsonl] \
//     --events=docs/ground-truth/relations/events-v1.json \
//     [--baseline=report-before.json] [--out=report.json]
//
// 對固定事件快照跑 correlateEvents，對照人工標註產生 deterministic metrics：
// same-event precision/recall、false merge rate、missed relation rate、
// location role/precision accuracy、uncertain rate；並依 family 分 tuning/holdout。
// --baseline 時輸出逐指標 before/after diff（改善/退化方向）。

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { correlateEvents, isNewsLikeEvent } from "./lib/correlate.mjs";
import {
  computeLocationMetrics,
  computeRelationMetrics,
  diffBenchmarkReports,
  loadLabeledJsonl,
  validateLocationRow,
  validatePairRow,
} from "./lib/ground-truth-relations.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(argv) {
  const args = { pairs: "", locations: "", events: "", baseline: "", out: "" };
  for (const arg of argv) {
    if (arg.startsWith("--pairs=")) args.pairs = arg.slice("--pairs=".length);
    else if (arg.startsWith("--locations=")) args.locations = arg.slice("--locations=".length);
    else if (arg.startsWith("--events=")) args.events = arg.slice("--events=".length);
    else if (arg.startsWith("--baseline=")) args.baseline = arg.slice("--baseline=".length);
    else if (arg.startsWith("--out=")) args.out = arg.slice("--out=".length);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

export function runBenchmark(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.pairs || !args.events) {
    console.log("Usage: node scripts/ground-truth-benchmark.mjs --pairs=<jsonl> --events=<snapshot.json> [--locations=<jsonl>] [--baseline=<json>] [--out=<json>]");
    if (!args.help) process.exitCode = 1;
    return null;
  }

  const snapshotRaw = JSON.parse(readFileSync(join(ROOT, args.events), "utf8"));
  const events = (Array.isArray(snapshotRaw) ? snapshotRaw : snapshotRaw.events || []).filter(isNewsLikeEvent);
  const net = correlateEvents(events);

  const pairs = loadLabeledJsonl(readFileSync(join(ROOT, args.pairs), "utf8"), validatePairRow);
  const report = {
    schema: "ground-truth-report/1",
    generatedAt: new Date().toISOString(),
    inputs: { pairs: args.pairs, locations: args.locations || null, events: args.events },
    counts: { events: events.length, pairs: pairs.rows.length, unlabeledPairs: pairs.unlabeled.length },
    relation: computeRelationMetrics(pairs.rows, net),
    errors: { pairs: pairs.errors, locations: [] },
  };

  if (args.locations) {
    const locations = loadLabeledJsonl(readFileSync(join(ROOT, args.locations), "utf8"), validateLocationRow);
    report.location = computeLocationMetrics(locations.rows, events);
    report.errors.locations = locations.errors;
    report.counts.locations = locations.rows.length;
  }

  const totalErrors = report.errors.pairs.length + report.errors.locations.length;
  const r = report.relation;
  console.log(
    `ground-truth benchmark：pairs ${report.counts.pairs}（evaluated ${r.evaluated}，uncertain ${r.uncertain}，待標註 ${report.counts.unlabeledPairs}）` +
      `｜same-event P=${fmt(r.sameEvent.precision)} R=${fmt(r.sameEvent.recall)}` +
      `｜falseMerge ${r.falseMerge.count}（rate ${fmt(r.falseMerge.rate)}）` +
      `｜missedRelation ${r.missedRelation.count}（rate ${fmt(r.missedRelation.rate)}）`,
  );
  if (report.location) {
    console.log(
      `location：role acc=${fmt(report.location.role.accuracy)} precision acc=${fmt(report.location.precision.accuracy)} region acc=${fmt(report.location.region.accuracy)} unknownRate=${fmt(report.location.unknownRate)}`,
    );
  }
  if (totalErrors) console.warn(`標註檔有 ${totalErrors} 行被略過（詳見 report.errors）`);

  if (args.baseline) {
    const before = JSON.parse(readFileSync(join(ROOT, args.baseline), "utf8"));
    const diffs = diffBenchmarkReports({ relation: before.relation, location: before.location }, { relation: report.relation, location: report.location });
    report.diff = diffs.filter((d) => d.direction !== "unchanged");
    for (const d of report.diff) {
      console.log(`  ${d.direction === "improved" ? "▲" : d.direction === "regressed" ? "▼" : "◆"} ${d.metric}: ${d.before} → ${d.after}`);
    }
  }

  if (args.out) {
    mkdirSync(dirname(join(ROOT, args.out)), { recursive: true });
    writeFileSync(join(ROOT, args.out), JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log(`報告 → ${args.out}`);
  }
  return report;
}

function fmt(v) {
  return typeof v === "number" ? v.toFixed(3) : "n/a";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runBenchmark();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
