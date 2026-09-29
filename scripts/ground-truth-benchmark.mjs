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

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { correlateEvents, getCorrelationSettings, isNewsLikeEvent } from "./lib/correlate.mjs";
import {
  computeLocationMetrics,
  computeRelationMetrics,
  diffBenchmarkReports,
  loadLabeledJsonl,
  validateLocationRow,
  validatePairRow,
} from "./lib/ground-truth-relations.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadReplayEvents(snapshot, snapshotPath) {
  if (snapshot?.schema !== "ground-truth-events/1" || !Array.isArray(snapshot.events) ||
      typeof snapshot.cohortFile !== "string" || basename(snapshot.cohortFile) !== snapshot.cohortFile ||
      !/^[a-f0-9]{64}$/.test(snapshot.cohortSha256 || "")) {
    throw new Error("Benchmark snapshot must reference a versioned full-cohort replay file");
  }
  if (JSON.stringify(snapshot.correlationSettings) !== JSON.stringify(getCorrelationSettings())) {
    throw new Error("Benchmark correlation settings differ from pinned snapshot settings");
  }
  const cohortPath = join(dirname(snapshotPath), snapshot.cohortFile);
  const bytes = readFileSync(cohortPath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== snapshot.cohortSha256) throw new Error("Benchmark replay cohort SHA-256 mismatch");
  const cohort = JSON.parse(gunzipSync(bytes).toString("utf8"));
  if (cohort?.schema !== "ground-truth-cohort/1" || !Array.isArray(cohort.events)) {
    throw new Error("Unsupported benchmark replay cohort schema");
  }
  const events = cohort.events.filter(isNewsLikeEvent);
  if (events.length !== cohort.count || events.length !== snapshot.cohortCount || snapshot.count !== snapshot.events.length) {
    throw new Error("Benchmark replay cohort or candidate count mismatch");
  }
  const byId = new Map(events.map((event) => [event.id, event]));
  if (byId.size !== events.length) throw new Error("Duplicate event ID in benchmark replay cohort");
  for (const context of snapshot.events) {
    if (JSON.stringify(byId.get(context.id)) !== JSON.stringify(context)) {
      throw new Error(`Candidate event ${context.id} differs from benchmark replay cohort`);
    }
  }
  return { events, cohortPath };
}

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

  const snapshotPath = join(ROOT, args.events);
  const snapshotRaw = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const { events } = loadReplayEvents(snapshotRaw, snapshotPath);
  const net = correlateEvents(events);

  const pairs = loadLabeledJsonl(readFileSync(join(ROOT, args.pairs), "utf8"), validatePairRow);
  const report = {
    schema: "ground-truth-report/1",
    inputs: { pairs: args.pairs, locations: args.locations || null, events: args.events, cohortFile: snapshotRaw.cohortFile, cohortSha256: snapshotRaw.cohortSha256, sourceSha256: snapshotRaw.sourceSha256, correlationSettings: snapshotRaw.correlationSettings },
    counts: {
      events: events.length,
      pairs: pairs.rows.length,
      humanPairs: pairs.rows.filter((row) => row.labeledBy === "human").length,
      draftPairs: pairs.rows.filter((row) => row.labeledBy !== "human").length,
      unlabeledPairs: pairs.unlabeled.length,
    },
    relation: computeRelationMetrics(pairs.rows, net),
    errors: { pairs: pairs.errors, locations: [] },
  };

  if (args.locations) {
    const locations = loadLabeledJsonl(readFileSync(join(ROOT, args.locations), "utf8"), validateLocationRow);
    report.location = computeLocationMetrics(locations.rows, events);
    report.errors.locations = locations.errors;
    report.counts.locations = locations.rows.length;
    report.counts.humanLocations = report.location.labeled;
    report.counts.draftLocations = report.location.draftsExcluded;
    report.counts.unlabeledLocations = locations.unlabeled.length;
  }

  const totalErrors = report.errors.pairs.length + report.errors.locations.length;
  const r = report.relation;
  console.log(
    `ground-truth benchmark：pairs ${report.counts.pairs}（human ${report.counts.humanPairs}，draft ${report.counts.draftPairs}，evaluated ${r.evaluated}，uncertain ${r.uncertain}，待標註 ${report.counts.unlabeledPairs}）` +
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
