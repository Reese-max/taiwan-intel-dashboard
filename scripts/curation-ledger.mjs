// 人工更正 Ledger 工具（#44）：
//   node scripts/curation-ledger.mjs check [--file=ledger.jsonl] [--data-dir=public/data]
//     → 對目前 public/data 快照解析每筆記錄狀態（applied/needs_review/conflict/invalid），
//       conflict/invalid → exit 1（fail closed 審核）。
//   node scripts/curation-ledger.mjs fingerprint <eventId> [...] [--data-dir=public/data]
//     → 輸出可貼進 expect 的指紋行（含找不到 id 的提示）。
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURATED_LEDGER_REL_PATH,
  fingerprintEvent,
  loadCurationLedger,
  resolveCurationLedger,
} from "./lib/curation-ledger.mjs";
import { isNewsLikeEvent } from "./lib/correlate.mjs";
import { RULES_VERSION } from "./lib/manifest.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DATA_DIR = join(ROOT, "public", "data");

function argValue(args, name) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function loadScopeEvents(dataDir, scope) {
  const p = join(dataDir, `${scope}.json`);
  if (!existsSync(p)) return { events: [], warning: `${p} 不存在` };
  try {
    const events = JSON.parse(readFileSync(p, "utf8"));
    return { events: Array.isArray(events) ? events.filter(isNewsLikeEvent) : [], warning: null };
  } catch (e) {
    return { events: [], warning: `${p} 解析失敗：${e.message}` };
  }
}

function cmdFingerprint(ids, dataDir) {
  const domestic = loadScopeEvents(dataDir, "domestic").events;
  const international = loadScopeEvents(dataDir, "international").events;
  const byId = new Map([...domestic, ...international].map((e) => [e.id, e]));
  let missing = 0;
  for (const id of ids) {
    const event = byId.get(id);
    if (!event) {
      console.log(`  ${id}  // 找不到（不在 public/data/{domestic,international}.json 的新聞事件中）`);
      missing++;
      continue;
    }
    console.log(`  "${id}": "${fingerprintEvent(event)}"`);
  }
  if (missing) console.log(`\n注意：${missing} 個 id 不存在，請確認是 event id（不是標題）。`);
  return missing;
}

function cmdCheck(file, dataDir) {
  const ledger = loadCurationLedger(file);
  if (!ledger.exists) {
    console.log(`ledger 不存在：${file}（視為空 ledger，無記錄）`);
    return 0;
  }
  console.log(`ledger：${file}（${ledger.entries.length} 行記錄）`);
  const allDecisions = [];
  const totals = { applied: 0, needsReview: 0, conflicts: 0, invalid: 0, outOfScope: 0 };
  for (const scope of ["domestic", "international"]) {
    const { events, warning } = loadScopeEvents(dataDir, scope);
    if (warning) console.log(`  [${scope}] ${warning}（該 scope 全部記錄視為無 subject 評估）`);
    const r = resolveCurationLedger(ledger.entries, events, { rulesVersion: RULES_VERSION, scope });
    for (const k of Object.keys(totals)) totals[k] += r.stats[k];
    for (const d of r.decisions) allDecisions.push({ ...d, scope });
  }
  for (const d of allDecisions) {
    const where = d.line != null ? `L${d.line}` : "-";
    const subj = Array.isArray(d.subjects) ? d.subjects.join(" × ") : "";
    console.log(`  [${d.status}] ${where} ${d.id ?? "(無 id)"} ${d.decision ?? ""} ${subj}${d.note ? ` ← ${d.note}` : ""}（${d.scope}）`);
  }
  console.log(
    `合計：套用 ${totals.applied}／待複審 ${totals.needsReview}／衝突 ${totals.conflicts}／無效 ${totals.invalid}`,
  );
  return totals.conflicts + totals.invalid > 0 ? 1 : 0;
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] && !args[0].startsWith("--") ? args[0] : "check";
  const rest = cmd === args[0] ? args.slice(1) : args;
  const file = argValue(rest, "file") || join(ROOT, CURATED_LEDGER_REL_PATH);
  const dataDir = argValue(rest, "data-dir") || DEFAULT_DATA_DIR;
  if (cmd === "fingerprint") {
    const ids = rest.filter((a) => !a.startsWith("--"));
    if (!ids.length) {
      console.error("用法：node scripts/curation-ledger.mjs fingerprint <eventId> [...]");
      process.exitCode = 2;
      return;
    }
    process.exitCode = cmdFingerprint(ids, dataDir) > 0 ? 1 : 0;
    return;
  }
  if (cmd === "check") {
    process.exitCode = cmdCheck(file, dataDir);
    return;
  }
  console.error(`未知指令：${cmd}（支援 check / fingerprint）`);
  process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
