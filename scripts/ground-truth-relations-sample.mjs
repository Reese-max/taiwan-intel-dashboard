#!/usr/bin/env node
// 產生 ground-truth 關聯標註候選（issue #43）：
//   node scripts/ground-truth-relations-sample.mjs [--input=public/data/domestic.json] \
//     [--network=public/data/network.json] [--ledger=curation/correlation-overrides.jsonl] \
//     [--out=docs/ground-truth/relations/pairs-YYYYMMDD.jsonl] [--events-out=docs/ground-truth/relations/events-YYYYMMDD.json] \
//     [--max=200] [--seed=43] [--date=YYYYMMDD]
//
// 輸出 pair 候選（label 留空給人工填）+ 被引用事件的 metadata 快照（固定 SHA 可重播）。
// 候選涵蓋：已連線邊、同群無邊成員（false merge 高風險）、同縣市未連線 pair（missed
// relation 候選），另有跨縣市同名地點 hard negatives。地點候選從完整輸入獨立抽樣。
// ledger 命中的 pair 打 ledgerDecision 標記。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { correlateEvents, isNewsLikeEvent } from "./lib/correlate.mjs";
import { enumerateCandidatePairs, LOCATION_SCHEMA, PAIR_SCHEMA } from "./lib/ground-truth-relations.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 快照只留標註與重播所需欄位——不存全文、不存個資。
// correlateEvents 的輸入欄位必須完整保留，否則重播的邊／群集會與抽樣時不同。
const SNAPSHOT_FIELDS = ["id", "title", "region", "timestamp", "category", "scope", "riskLevel", "summary", "lat", "lng", "locationPrecision", "locationRole", "locationNote", "entities", "aiEntities", "aiTopic"];

function snapshotEvent(e) {
  const out = {};
  for (const key of SNAPSHOT_FIELDS) if (e[key] !== undefined) out[key] = e[key];
  // 摘要超過界限時拒絕產生不忠實的 replay，也避免複製可能受版權限制的全文。
  if (typeof out.summary === "string" && out.summary.length > 300) {
    throw new Error(`Event ${e.id} summary exceeds 300 characters; cannot preserve correlation input safely`);
  }
  if (e?.source) {
    out.source = { name: e.source.name, type: e.source.type, datasetId: e.source.datasetId, recordRef: e.source.recordRef, fetchedAt: e.source.fetchedAt };
  }
  return out;
}

export function parseArgs(argv) {
  const args = {
    input: "public/data/domestic.json",
    network: "",
    ledger: join(ROOT, "curation/correlation-overrides.jsonl"),
    out: "",
    eventsOut: "",
    cohortOut: "",
    locationsOut: "",
    max: 200,
    maxLocations: 40,
    seed: 43,
    date: "",
  };
  for (const arg of argv) {
    if (arg.startsWith("--input=")) args.input = arg.slice("--input=".length);
    else if (arg.startsWith("--network=")) args.network = arg.slice("--network=".length);
    else if (arg.startsWith("--ledger=")) args.ledger = arg.slice("--ledger=".length);
    else if (arg.startsWith("--out=")) args.out = arg.slice("--out=".length);
    else if (arg.startsWith("--events-out=")) args.eventsOut = arg.slice("--events-out=".length);
    else if (arg.startsWith("--cohort-out=")) args.cohortOut = arg.slice("--cohort-out=".length);
    else if (arg.startsWith("--locations-out=")) args.locationsOut = arg.slice("--locations-out=".length);
    else if (arg.startsWith("--max=")) args.max = Number(arg.slice("--max=".length));
    else if (arg.startsWith("--max-locations=")) args.maxLocations = Number(arg.slice("--max-locations=".length));
    else if (arg.startsWith("--seed=")) args.seed = Number(arg.slice("--seed=".length));
    else if (arg.startsWith("--date=")) args.date = arg.slice("--date=".length);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

export async function runSample(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log("Usage: node scripts/ground-truth-relations-sample.mjs [--input=...] [--network=...] [--ledger=...] [--out=...] [--events-out=...] [--cohort-out=...] [--locations-out=...] [--max=200] [--max-locations=40] [--seed=43]");
    return { pairs: [], stats: {} };
  }
  const date = args.date || new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const outPath = args.out || `docs/ground-truth/relations/pairs-${date}.jsonl`;
  const eventsPath = args.eventsOut || `docs/ground-truth/relations/events-${date}.json`;
  const cohortPath = args.cohortOut || eventsPath.replace(/\.json$/, ".cohort.json.gz");
  const locationsPath = args.locationsOut || `docs/ground-truth/relations/locations-${date}-candidates.jsonl`;
  if (dirname(join(ROOT, cohortPath)) !== dirname(join(ROOT, eventsPath))) {
    throw new Error("--cohort-out must be in the same directory as --events-out");
  }

  const inputBytes = readFileSync(join(ROOT, args.input));
  const input = JSON.parse(inputBytes.toString("utf8"));
  const events = (Array.isArray(input) ? input : input.events || []).filter(isNewsLikeEvent);

  let net;
  let networkSha256 = null;
  if (args.network) {
    const networkBytes = readFileSync(join(ROOT, args.network));
    networkSha256 = createHash("sha256").update(networkBytes).digest("hex");
    const existing = JSON.parse(networkBytes.toString("utf8"));
    net = existing.domestic || existing; // 支援整份 network.json 或單 scope
  } else {
    net = correlateEvents(events);
  }

  const pairs = enumerateCandidatePairs(events, net, { maxPairs: args.max, seed: args.seed });

  // ledger 命中的 pair 打標記（供 report 分開計數；不影響 family 切分）。
  // curation.mjs 屬 #44——未合併的 checkout 上動態 import 失敗時優雅略過標記。
  let loadCurationLedger = null;
  try {
    ({ loadCurationLedger } = await import("./lib/curation.mjs"));
  } catch {
    /* correction ledger 尚未落地 */
  }
  const ledger = loadCurationLedger ? loadCurationLedger(args.ledger) : { records: [] };
  const ledgerByPair = new Map();
  for (const record of ledger.records) {
    if (record.ids?.length === 2) ledgerByPair.set([...record.ids].sort().join("|"), record.decision);
  }
  for (const row of pairs) {
    const decision = ledgerByPair.get([row.a, row.b].sort().join("|"));
    if (decision) row.ledgerDecision = decision;
  }

  // 地點候選獨立從完整輸入抽樣，避免只覆蓋關聯候選已引用的事件。
  const locationSelections = events
    .filter((event) => event.id)
    .map((event) => ({ event, score: createHash("sha256").update(`${args.seed}|${event.id}`).digest("hex") }))
    .sort((a, b) => a.score.localeCompare(b.score) || a.event.id.localeCompare(b.event.id))
    .slice(0, args.maxLocations);
  const referenced = new Set([...pairs.flatMap((p) => [p.a, p.b]), ...locationSelections.map(({ event }) => event.id)]);
  const cohort = events.map(snapshotEvent);
  const snapshot = cohort.filter((e) => referenced.has(e.id));
  const cohortBytes = gzipSync(Buffer.from(JSON.stringify({ schema: "ground-truth-cohort/1", count: cohort.length, events: cohort }), "utf8"), { level: 9, mtime: 0 });
  mkdirSync(dirname(join(ROOT, outPath)), { recursive: true });
  writeFileSync(join(ROOT, outPath), pairs.map((r) => JSON.stringify(r)).join("\n") + (pairs.length ? "\n" : ""), "utf8");
  mkdirSync(dirname(join(ROOT, cohortPath)), { recursive: true });
  writeFileSync(join(ROOT, cohortPath), cohortBytes);
  mkdirSync(dirname(join(ROOT, eventsPath)), { recursive: true });
  writeFileSync(
    join(ROOT, eventsPath),
    JSON.stringify({
      schema: "ground-truth-events/1",
      generatedFrom: args.input,
      sourceSha256: createHash("sha256").update(inputBytes).digest("hex"),
      networkSha256,
      cohortFile: basename(cohortPath),
      cohortSha256: createHash("sha256").update(cohortBytes).digest("hex"),
      cohortCount: cohort.length,
      count: snapshot.length,
      events: snapshot,
    }, null, 2) + "\n",
    "utf8",
  );

  // 地點候選只帶系統建議；role/precision/region 必須由人工對來源核對。
  const locationCandidates = locationSelections
    .map(({ event }) => ({
      schema: LOCATION_SCHEMA,
      event: event.id,
      locationRole: "",
      locationPrecision: "",
      region: "",
      evidence: "",
      labeledAt: "",
      labeledBy: "",
      sourceIdentity: event.source?.recordRef || null,
      suggestedLocationRole: event.locationRole || null,
      suggestedLocationPrecision: event.locationPrecision || null,
      suggestedRegion: event.region || null,
    }));
  mkdirSync(dirname(join(ROOT, locationsPath)), { recursive: true });
  writeFileSync(join(ROOT, locationsPath), locationCandidates.map((r) => JSON.stringify(r)).join("\n") + (locationCandidates.length ? "\n" : ""), "utf8");

  const stats = {
    events: events.length,
    pairs: pairs.length,
    locations: locationCandidates.length,
    ledgerTagged: pairs.filter((p) => p.ledgerDecision).length,
    bySource: Object.fromEntries([...new Set(pairs.map((p) => p.candidateSource))].map((s) => [s, pairs.filter((p) => p.candidateSource === s).length])),
  };
  console.log(`候選 pair ${stats.pairs} 筆（schema ${PAIR_SCHEMA}）→ ${outPath}`);
  console.log(`事件快照 ${snapshot.length} 筆 → ${eventsPath}`);
  console.log(`重播 cohort ${cohort.length} 筆 → ${cohortPath}`);
  console.log(`地點候選 ${locationCandidates.length} 筆（schema ${LOCATION_SCHEMA}）→ ${locationsPath}`);
  console.log(`來源分佈 ${JSON.stringify(stats.bySource)}；ledger 命中 ${stats.ledgerTagged} 筆`);
  return { pairs, locationCandidates, stats, outPath, eventsPath, cohortPath, locationsPath };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runSample();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
