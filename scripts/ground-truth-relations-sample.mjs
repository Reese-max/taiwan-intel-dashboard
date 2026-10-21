#!/usr/bin/env node
// 產生 ground-truth 關聯標註候選（issue #43）：
//   node scripts/ground-truth-relations-sample.mjs [--input=public/data/domestic.json] \
//     [--network=public/data/network.json] [--ledger=curation/correlation-overrides.jsonl] \
//     [--out=docs/ground-truth/relations/pairs-YYYYMMDD.jsonl] [--events-out=docs/ground-truth/relations/events-YYYYMMDD.json] \
//     [--max=200] [--seed=43] [--date=YYYYMMDD]
//
// 輸出 pair 候選（label 留空給人工填）+ 完整新聞語料的 metadata 快照（固定 SHA 可重播）。
// 候選涵蓋：已連線邊、同群無邊成員（false merge 高風險）、同縣市未連線 pair（missed
// relation 候選）。ledger 命中的 pair 打 ledgerDecision 標記。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { correlateEvents, isNewsLikeEvent } from "./lib/correlate.mjs";
import { enumerateCandidatePairs, PAIR_SCHEMA } from "./lib/ground-truth-relations.mjs";
import { CURATED_LEDGER_REL_PATH, loadCurationLedger, ledgerBenchmarkEvidence } from "./lib/curation-ledger.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoPath = (value) => resolve(ROOT, value);

// 快照只留標註與重播所需欄位——不存全文、不存個資。
// 必須涵蓋 correlate.mjs extractSignals 讀取的欄位（含 aiTopic——Pass 3
// 同題語意邊的來源），否則 benchmark 重播時會少算系統真實會連的邊。
export const SNAPSHOT_FIELDS = ["id", "title", "region", "timestamp", "category", "scope", "riskLevel", "summary", "lat", "lng", "locationPrecision", "locationRole", "locationNote", "entities", "aiEntities", "aiTopic"];

function snapshotEvent(e) {
  const out = {};
  for (const key of SNAPSHOT_FIELDS) if (e[key] !== undefined) out[key] = e[key];
  // 摘要是標註上下文所需，但只留前 300 字——不複製完整新聞全文（issue #43 規則）
  if (typeof out.summary === "string" && out.summary.length > 300) out.summary = `${out.summary.slice(0, 300)}…`;
  if (e?.source) {
    out.source = { name: e.source.name, type: e.source.type, datasetId: e.source.datasetId, recordRef: e.source.recordRef, fetchedAt: e.source.fetchedAt };
  }
  return out;
}

export function parseArgs(argv) {
  const args = {
    input: "public/data/domestic.json",
    network: "",
    ledger: repoPath(CURATED_LEDGER_REL_PATH),
    out: "",
    eventsOut: "",
    max: 200,
    seed: 43,
    date: "",
  };
  for (const arg of argv) {
    if (arg.startsWith("--input=")) args.input = arg.slice("--input=".length);
    else if (arg.startsWith("--network=")) args.network = arg.slice("--network=".length);
    else if (arg.startsWith("--ledger=")) args.ledger = arg.slice("--ledger=".length);
    else if (arg.startsWith("--out=")) args.out = arg.slice("--out=".length);
    else if (arg.startsWith("--events-out=")) args.eventsOut = arg.slice("--events-out=".length);
    else if (arg.startsWith("--max=")) args.max = Number(arg.slice("--max=".length));
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
    console.log("Usage: node scripts/ground-truth-relations-sample.mjs [--input=...] [--network=...] [--ledger=...] [--out=...] [--events-out=...] [--max=200] [--seed=43]");
    return { pairs: [], stats: {} };
  }
  const date = args.date || new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const outPath = args.out || `docs/ground-truth/relations/pairs-${date}.jsonl`;
  const eventsPath = args.eventsOut || `docs/ground-truth/relations/events-${date}.json`;

  const input = JSON.parse(readFileSync(repoPath(args.input), "utf8"));
  const events = (Array.isArray(input) ? input : input.events || []).filter(isNewsLikeEvent);

  let net;
  if (args.network) {
    const existing = JSON.parse(readFileSync(repoPath(args.network), "utf8"));
    net = existing.domestic || existing; // 支援整份 network.json 或單 scope
  } else {
    net = correlateEvents(events);
  }

  const pairs = enumerateCandidatePairs(events, net, { maxPairs: args.max, seed: args.seed });

  // Only explicitly admitted ledger records are referenced, never auto-labeled.
  const ledger = loadCurationLedger(repoPath(args.ledger));
  if (ledger.entries.some((entry) => entry.error)) throw new Error("Invalid curation ledger");
  const ledgerByPair = new Map(ledgerBenchmarkEvidence(ledger)
    .filter((record) => record.subjects.length === 2)
    .map((record) => [[...record.subjects].sort().join("|"), record]));
  const familySplits = new Map();
  for (const row of pairs) {
    const record = ledgerByPair.get([row.a, row.b].sort().join("|"));
    if (!record) continue;
    const split = familySplits.get(row.family);
    if (split && split !== record.benchmark) throw new Error(`Conflicting benchmark splits for family: ${row.family}`);
    familySplits.set(row.family, record.benchmark);
    Object.assign(row, { ledgerDecision: record.decision, ledgerId: record.id, benchmark: record.benchmark });
  }
  for (const row of pairs) if (familySplits.has(row.family)) row.benchmark = familySplits.get(row.family);

  mkdirSync(dirname(repoPath(outPath)), { recursive: true });
  writeFileSync(repoPath(outPath), pairs.map((r) => JSON.stringify(r)).join("\n") + (pairs.length ? "\n" : ""), "utf8");

  const snapshot = events.map(snapshotEvent);
  mkdirSync(dirname(repoPath(eventsPath)), { recursive: true });
  writeFileSync(
    repoPath(eventsPath),
    JSON.stringify({ schema: "ground-truth-events/1", generatedFrom: args.input, count: snapshot.length, events: snapshot }, null, 2) + "\n",
    "utf8",
  );

  const stats = {
    events: events.length,
    pairs: pairs.length,
    ledgerTagged: pairs.filter((p) => p.ledgerDecision).length,
    bySource: Object.fromEntries([...new Set(pairs.map((p) => p.candidateSource))].map((s) => [s, pairs.filter((p) => p.candidateSource === s).length])),
  };
  console.log(`候選 pair ${stats.pairs} 筆（schema ${PAIR_SCHEMA}）→ ${outPath}`);
  console.log(`事件快照 ${snapshot.length} 筆 → ${eventsPath}`);
  console.log(`來源分佈 ${JSON.stringify(stats.bySource)}；ledger 命中 ${stats.ledgerTagged} 筆`);
  return { pairs, stats, outPath, eventsPath };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runSample();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
