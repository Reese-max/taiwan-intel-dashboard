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
import { isDeepStrictEqual } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { correlateEvents, isNewsLikeEvent } from "./lib/correlate.mjs";
import {
  computeLocationMetrics,
  computeRelationMetrics,
  diffBenchmarkReports,
  loadLabeledJsonl,
  pairKeyOf,
  splitLeakageErrors,
  LOCATION_SCHEMA,
  LOCATION_ROLES,
  LOCATION_PRECISIONS,
  validateLocationRow,
  validatePairRow,
} from "./lib/ground-truth-relations.mjs";
import { RULES_VERSION } from "./lib/manifest.mjs";
import { isValidCoordinate } from "./lib/geo-policy.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoPath = (value) => resolve(ROOT, value);
const read = (path) => readFileSync(repoPath(path), "utf8").replace(/\r\n/g, "\n");
const hash = (text) => createHash("sha256").update(text).digest("hex");
const LOCATION_FIELDS = new Set(["region", "locationRole", "locationPrecision", "lat", "lng", "locationNote"]);

function predictionEvents(path, events) {
  if (!path) return events;
  const input = JSON.parse(read(path));
  const predictions = Array.isArray(input) ? input : input.events;
  const byId = new Map((predictions || []).map((event) => [event.id, event]));
  if (!Array.isArray(predictions) || predictions.length !== events.length || byId.size !== events.length) throw new Error("Prediction identity mismatch");
  const identity = (event) => Object.fromEntries(Object.entries(event).filter(([key]) => !LOCATION_FIELDS.has(key)));
  for (const event of events) {
    const predicted = byId.get(event.id);
    if (!predicted || !isDeepStrictEqual(identity(event), identity(predicted))) throw new Error("Prediction source identity mismatch");
    if (predicted.locationRole !== undefined && !LOCATION_ROLES.has(predicted.locationRole)) throw new Error("Invalid prediction locationRole");
    if (predicted.locationPrecision !== undefined && !LOCATION_PRECISIONS.has(predicted.locationPrecision)) throw new Error("Invalid prediction locationPrecision");
    if (predicted.region !== undefined && (typeof predicted.region !== "string" || !predicted.region.trim())) throw new Error("Invalid prediction region");
    if ((predicted.lat != null || predicted.lng != null) && !isValidCoordinate(predicted.lat, predicted.lng)) throw new Error("Invalid prediction coordinates");
  }
  return events.map((event) => byId.get(event.id));
}

export function parseArgs(argv) {
  const args = { pairs: "", locations: "", events: "", predictions: "", baseline: "", out: "" };
  for (const arg of argv) {
    if (arg.startsWith("--pairs=")) args.pairs = arg.slice("--pairs=".length);
    else if (arg.startsWith("--locations=")) args.locations = arg.slice("--locations=".length);
    else if (arg.startsWith("--events=")) args.events = arg.slice("--events=".length);
    else if (arg.startsWith("--predictions=")) args.predictions = arg.slice("--predictions=".length);
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
    console.log("Usage: node scripts/ground-truth-benchmark.mjs --pairs=<jsonl> --events=<snapshot.json> [--locations=<jsonl>] [--predictions=<json>] [--baseline=<json>] [--out=<json>]");
    if (!args.help) process.exitCode = 1;
    return null;
  }

  const snapshotRaw = JSON.parse(read(args.events));
  if (!Array.isArray(snapshotRaw) && (snapshotRaw.schema !== "ground-truth-events/1" || !Array.isArray(snapshotRaw.events))) throw new Error("Invalid events snapshot schema");
  const events = (Array.isArray(snapshotRaw) ? snapshotRaw : snapshotRaw.events || []).filter(isNewsLikeEvent);
  const eventIds = new Set(events.map((event) => event.id));
  if (eventIds.size !== events.length || events.some((event) => typeof event.id !== "string" || !event.id)) throw new Error("Invalid or duplicate event identity");
  const predictedEvents = predictionEvents(args.predictions, events);
  const net = correlateEvents(predictedEvents);

  const pairs = loadLabeledJsonl(read(args.pairs), validatePairRow, (row) => pairKeyOf(row.a, row.b));
  const pairReferenceErrors = [];
  const validPair = (row) => {
    if (eventIds.has(row.a) && eventIds.has(row.b)) return true;
    pairReferenceErrors.push({ line: row._line, error: "missing-event-reference" });
    return false;
  };
  const pairRows = pairs.rows.filter(validPair);
  pairs.unlabeled = pairs.unlabeled.filter(validPair);
  const environment = Object.fromEntries(["SAME_ENTITY_UNION_BLOCKLIST", "CLUSTER_INCOHERENT_DOMINANT_SHARE", "CLUSTER_INCOHERENT_CATEGORY_ENTROPY", "CLUSTER_INCOHERENT_TOPIC_RATIO", "CLUSTER_GEO_DISTANCE_KM"]
    .map((name) => [name, process.env[name] ?? null]));
  const report = {
    schema: "ground-truth-report/1",
    inputs: { pairs: args.pairs, locations: args.locations || null, events: args.events, predictions: args.predictions || null },
    inputHashes: Object.fromEntries(["pairs", "locations", "events"].map((key) => [key, args[key] ? hash(read(args[key])) : null])),
    predictionsHash: args.predictions ? hash(read(args.predictions)) : null,
    policy: { rulesVersion: RULES_VERSION, environment, sha256: hash(JSON.stringify(environment) +
      ["correlate", "cluster-signals", "geo-policy", "curation-ledger", "manifest", "ground-truth-relations"].map((name) => read(`scripts/lib/${name}.mjs`)).join("\n")) },
    counts: { events: events.length, pairs: pairRows.length, unlabeledPairs: pairs.unlabeled.length },
    relation: computeRelationMetrics(pairRows, net),
    errors: { pairs: [...pairs.errors, ...pairReferenceErrors], locations: [] },
  };

  let locationRows = [];
  if (args.locations) {
    const locations = loadLabeledJsonl(read(args.locations), validateLocationRow, (row) => row.event);
    const locationReferenceErrors = [];
    locationRows = locations.rows.filter((row) => {
      if (eventIds.has(row.event)) return true;
      locationReferenceErrors.push({ line: row._line, error: "missing-event-reference" });
      return false;
    });
    report.location = computeLocationMetrics(locationRows, predictedEvents);
    report.errors.locations = [...locations.errors, ...locationReferenceErrors];
    report.counts.locations = locationRows.length;
  }

  const leaks = splitLeakageErrors([...pairRows, ...pairs.unlabeled, ...locationRows], events);
  for (const { row, line, error } of leaks) report.errors[row.schema === LOCATION_SCHEMA ? "locations" : "pairs"].push({ line, error });

  const totalErrors = report.errors.pairs.length + report.errors.locations.length;
  report.status = totalErrors ? "invalid" : report.relation.evaluated || report.location?.role.total || report.location?.precision.total ? "baseline" : "needs_review";
  if (totalErrors) process.exitCode = 1;
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
    const before = JSON.parse(read(args.baseline));
    if (before.schema !== report.schema || !isDeepStrictEqual(before.inputHashes, report.inputHashes)) throw new Error("Baseline input mismatch: use the same source snapshot and labels");
    if (before.status === "invalid" || report.status === "invalid") throw new Error("Cannot compare an invalid benchmark");
    const diffs = diffBenchmarkReports({ relation: before.relation, location: before.location }, { relation: report.relation, location: report.location });
    report.diff = diffs.filter((d) => d.direction !== "unchanged");
    report.errorChanges = {};
    const locationsById = new Map(locationRows.map((row) => [row.event, row]));
    const predictionsById = new Map(predictedEvents.map((event) => [event.id, event]));
    for (const [kind, section] of [["falseMerges", "relation"], ["sameEventFalseNegatives", "relation"], ["missedRelations", "relation"], ["roleErrors", "location"], ["precisionErrors", "location"], ["regionErrors", "location"]]) {
      const keys = (value) => (value?.[section]?.examples?.[kind] || []).map((entry) => typeof entry === "string" ? entry : entry.event);
      const previous = keys(before);
      const current = keys(report);
      const field = { roleErrors: "locationRole", precisionErrors: "locationPrecision", regionErrors: "region" }[kind];
      report.errorChanges[kind] = {
        resolved: previous.filter((key) => !current.includes(key) && (!field || predictionsById.get(key)?.[field] === locationsById.get(key)?.[field])),
        introduced: current.filter((key) => !previous.includes(key)),
      };
    }
    for (const d of report.diff) {
      console.log(`  ${d.direction === "improved" ? "▲" : d.direction === "regressed" ? "▼" : "◆"} ${d.metric}: ${d.before} → ${d.after}`);
    }
  }

  if (args.out) {
    mkdirSync(dirname(repoPath(args.out)), { recursive: true });
    writeFileSync(repoPath(args.out), JSON.stringify(report, null, 2) + "\n", "utf8");
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
