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
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function loadReplayEvents(snapshot, snapshotPath) {
  if (snapshot?.schema !== "ground-truth-events/1" || !Array.isArray(snapshot.events) ||
      typeof snapshot.cohortFile !== "string" || basename(snapshot.cohortFile) !== snapshot.cohortFile ||
      !/^[a-f0-9]{64}$/.test(snapshot.cohortSha256 || "") ||
      !/^[a-f0-9]{64}$/.test(snapshot.sourceSha256 || "")) {
    throw new Error("Benchmark snapshot must reference a versioned full-cohort replay file");
  }
  if (JSON.stringify(snapshot.correlationSettings) !== JSON.stringify(getCorrelationSettings())) {
    throw new Error("Benchmark correlation settings differ from pinned snapshot settings");
  }
  const cohortPath = join(dirname(snapshotPath), snapshot.cohortFile);
  const bytes = readFileSync(cohortPath);
  const digest = sha256(bytes);
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

function loadLocationPredictions(bytes, humanRows, cohortEvents) {
  if (!bytes) {
    if (humanRows.length) throw new Error("Human location labels require --location-predictions from the current policy run");
    return [];
  }
  const parsed = JSON.parse(bytes.toString("utf8"));
  const predictions = Array.isArray(parsed) ? parsed : parsed?.events;
  if (!Array.isArray(predictions)) throw new Error("Location predictions must be an event array or an object with events");
  const byPredictionId = new Map();
  for (const event of predictions) {
    if (!event || typeof event.id !== "string" || !event.id || byPredictionId.has(event.id)) {
      throw new Error("Location predictions contain a missing or duplicate event ID");
    }
    byPredictionId.set(event.id, event);
  }
  const byCohortId = new Map(cohortEvents.map((event) => [event.id, event]));
  for (const row of humanRows) {
    const original = byCohortId.get(row.event);
    const predicted = byPredictionId.get(row.event);
    if (!original) throw new Error(`Location references event ${row.event} absent from benchmark cohort`);
    if (!predicted) throw new Error(`Current location predictions omit event ${row.event}`);
    const expectedIdentity = original.source?.recordRef;
    const actualIdentity = predicted.sourceIdentity || predicted.source?.recordRef;
    if (!expectedIdentity || actualIdentity !== expectedIdentity) {
      throw new Error(`Current location prediction identity mismatch for event ${row.event}`);
    }
  }
  return predictions;
}

function assertBaselineCompatible(before, current) {
  if (before?.schema !== "ground-truth-report/1") throw new Error("Unsupported baseline report schema");
  // Prediction bytes may differ intentionally after a policy change; cohort, labels and replay settings may not.
  for (const key of ["eventsSha256", "cohortSha256", "sourceSha256", "pairLabelsSha256", "locationLabelsSha256", "correlationSettings"]) {
    if (JSON.stringify(before.inputs?.[key]) !== JSON.stringify(current.inputs?.[key]) || before.inputs?.[key] === undefined) {
      throw new Error(`Baseline input mismatch: ${key}`);
    }
  }
}

export function parseArgs(argv) {
  const args = { pairs: "", locations: "", locationPredictions: "", events: "", baseline: "", out: "" };
  for (const arg of argv) {
    if (arg.startsWith("--pairs=")) args.pairs = arg.slice("--pairs=".length);
    else if (arg.startsWith("--locations=")) args.locations = arg.slice("--locations=".length);
    else if (arg.startsWith("--location-predictions=")) args.locationPredictions = arg.slice("--location-predictions=".length);
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
    console.log("Usage: node scripts/ground-truth-benchmark.mjs --pairs=<jsonl> --events=<snapshot.json> [--locations=<jsonl> --location-predictions=<current-event-json>] [--baseline=<json>] [--out=<json>]");
    if (!args.help) process.exitCode = 1;
    return null;
  }

  const snapshotPath = join(ROOT, args.events);
  const snapshotBytes = readFileSync(snapshotPath);
  const snapshotRaw = JSON.parse(snapshotBytes.toString("utf8"));
  const { events } = loadReplayEvents(snapshotRaw, snapshotPath);
  const net = correlateEvents(events);

  const pairBytes = readFileSync(join(ROOT, args.pairs));
  const pairs = loadLabeledJsonl(pairBytes.toString("utf8"), validatePairRow);
  const locationBytes = args.locations ? readFileSync(join(ROOT, args.locations)) : null;
  const locations = locationBytes ? loadLabeledJsonl(locationBytes.toString("utf8"), validateLocationRow) : null;
  const predictionBytes = args.locationPredictions ? readFileSync(join(ROOT, args.locationPredictions)) : null;
  const predictions = loadLocationPredictions(predictionBytes, (locations?.rows || []).filter((row) => row.labeledBy === "human"), events);
  const report = {
    schema: "ground-truth-report/1",
    inputs: {
      pairs: args.pairs, pairLabelsSha256: sha256(pairBytes),
      locations: args.locations || null, locationLabelsSha256: locationBytes ? sha256(locationBytes) : null,
      locationPredictions: args.locationPredictions || null, locationPredictionsSha256: predictionBytes ? sha256(predictionBytes) : null,
      events: args.events, eventsSha256: sha256(snapshotBytes),
      cohortFile: snapshotRaw.cohortFile, cohortSha256: snapshotRaw.cohortSha256,
      sourceSha256: snapshotRaw.sourceSha256, correlationSettings: snapshotRaw.correlationSettings,
    },
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

  if (locations) {
    report.location = computeLocationMetrics(locations.rows, predictions);
    report.errors.locations = locations.errors;
    report.counts.locations = locations.rows.length;
    report.counts.humanLocations = report.location.labeled;
    report.counts.draftLocations = report.location.draftsExcluded;
    report.counts.unlabeledLocations = locations.unlabeled.length;
  }

  if (args.baseline) {
    const before = JSON.parse(readFileSync(join(ROOT, args.baseline), "utf8"));
    assertBaselineCompatible(before, report);
    const diffs = diffBenchmarkReports({ relation: before.relation, location: before.location }, { relation: report.relation, location: report.location });
    report.diff = diffs.filter((d) => d.direction !== "unchanged");
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

  if (report.diff) {
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
