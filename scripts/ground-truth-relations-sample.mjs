#!/usr/bin/env node
// 產生 ground-truth 關聯標註候選（issue #43）：
//   node scripts/ground-truth-relations-sample.mjs [--input=public/data/domestic.json] \
//     [--network=public/data/network.json] [--ledger=curation/correlation-overrides.jsonl] \
//     [--out=docs/ground-truth/relations/pairs-YYYYMMDD.jsonl] [--events-out=docs/ground-truth/relations/events-YYYYMMDD.json] \
//     [--max=200] [--seed=43] [--date=YYYYMMDD]
//
// 輸出 pair 候選（label 留空給人工填）+ 被引用事件的 metadata 快照（固定 SHA 可重播）。
// 候選涵蓋：已連線邊、同群無邊成員（false merge 高風險）、同縣市未連線 pair（missed
// relation 候選）。ledger 命中的 pair 打 ledgerDecision 標記。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { correlateEvents, isNewsLikeEvent } from "./lib/correlate.mjs";
import { enumerateCandidatePairs, PAIR_SCHEMA } from "./lib/ground-truth-relations.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 快照只留標註與重播所需欄位——不存全文、不存個資
const SNAPSHOT_FIELDS = ["id", "title", "region", "timestamp", "category", "scope", "riskLevel", "summary", "lat", "lng", "locationPrecision", "locationRole", "locationNote", "entities", "aiEntities"];

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
    ledger: join(ROOT, "curation/correlation-overrides.jsonl"),
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

  const input = JSON.parse(readFileSync(join(ROOT, args.input), "utf8"));
  const events = (Array.isArray(input) ? input : input.events || []).filter(isNewsLikeEvent);

  let net;
  if (args.network) {
    const existing = JSON.parse(readFileSync(join(ROOT, args.network), "utf8"));
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

  mkdirSync(dirname(join(ROOT, outPath)), { recursive: true });
  writeFileSync(join(ROOT, outPath), pairs.map((r) => JSON.stringify(r)).join("\n") + (pairs.length ? "\n" : ""), "utf8");

  const referenced = new Set(pairs.flatMap((p) => [p.a, p.b]));
  const snapshot = events.filter((e) => referenced.has(e.id)).map(snapshotEvent);
  mkdirSync(dirname(join(ROOT, eventsPath)), { recursive: true });
  writeFileSync(
    join(ROOT, eventsPath),
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
