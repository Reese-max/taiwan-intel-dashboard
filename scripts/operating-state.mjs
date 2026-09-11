#!/usr/bin/env node
// 營運狀態契約（ops/operating-state.json）的單一判讀點。
// 排程/mutation 工作流程先跑 `guard-schedule`；文件一致性走 `verify-docs`。
// 狀態值：PAUSED | RESTORING | ACTIVE | DEGRADED —— 轉移規則見契約檔與
// docs/operations/operating-state.md。

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_STATE_PATH = "ops/operating-state.json";
const VALID_STATES = ["PAUSED", "RESTORING", "ACTIVE", "DEGRADED"];
// README 狀態行的預期字樣（verify-docs 依此核對）
const README_MARKERS = {
  PAUSED: "已暫停",
  RESTORING: "復原驗證中",
  ACTIVE: "運作中",
  DEGRADED: "降級運作中",
};

function die(msg) {
  console.error(`OPERATING_STATE_ERROR ${msg}`);
  process.exit(2);
}

export function loadContract(statePath = resolve(REPO_ROOT, DEFAULT_STATE_PATH)) {
  if (!existsSync(statePath)) die(`contract missing: ${statePath}`);
  let doc;
  try {
    doc = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    die(`contract is not valid JSON: ${statePath}`);
  }
  const errors = [];
  if (doc.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!VALID_STATES.includes(doc.state)) errors.push(`state must be one of ${VALID_STATES.join("/")}, got ${doc.state}`);
  if (!doc.effectiveAt || Number.isNaN(Date.parse(doc.effectiveAt))) errors.push("effectiveAt must be an ISO timestamp");
  if (typeof doc.owner !== "string" || !doc.owner) errors.push("owner required");
  if (typeof doc.reason !== "string" || !doc.reason.trim()) errors.push("reason required");
  // ACTIVE 必須有 restore 收據（含 run URL 的檔案存在）
  const receipt = doc.evidence?.restoreReceipt ?? null;
  if (doc.state === "ACTIVE") {
    if (!receipt) errors.push("state=ACTIVE requires evidence.restoreReceipt");
    else if (!existsSync(resolve(REPO_ROOT, receipt))) errors.push(`restoreReceipt not found: ${receipt}`);
    else if (!/https:\/\/github\.com\/[^\s]+\/actions\/runs\/\d+/.test(readFileSync(resolve(REPO_ROOT, receipt), "utf8")))
      errors.push("restoreReceipt must contain a passing actions/runs/<id> URL");
  }
  return { doc, errors, statePath };
}

export function scheduleDecision(doc, purpose) {
  // 回傳 { allow, receipt }；receipt 一律產生，供工作流程留下稽核行。
  const base = {
    contract: DEFAULT_STATE_PATH,
    state: doc.state,
    purpose,
    effectiveAt: doc.effectiveAt,
  };
  if (doc.state === "PAUSED") {
    return { allow: false, receipt: { ...base, skipped: true, why: doc.reason } };
  }
  if (doc.state === "RESTORING" && purpose !== "validation") {
    return { allow: false, receipt: { ...base, skipped: true, why: "RESTORING allows only the documented controlled validation path" } };
  }
  return { allow: true, receipt: { ...base, skipped: false } };
}

export function verifyDocs(readmePath = resolve(REPO_ROOT, "README.md"), doc) {
  const readme = readFileSync(readmePath, "utf8");
  const marker = README_MARKERS[doc.state];
  const statusLine = readme.split("\n").find((l) => l.includes("狀態"));
  const errors = [];
  if (!statusLine) errors.push("README has no 狀態 line");
  else if (!statusLine.includes(`**${marker}**`))
    errors.push(`README status must say **${marker}** for contract state ${doc.state}, got: ${statusLine.trim()}`);
  // 不再允許無契約依據的 503 宣稱
  if (statusLine && /503/.test(statusLine) && !statusLine.includes("ops/operating-state.json"))
    errors.push("503 claim must reference ops/operating-state.json so it cannot drift");
  return errors;
}

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const cmd = process.argv[2];
  const statePath = arg("--state") ? resolve(arg("--state")) : undefined;
  const { doc, errors } = loadContract(statePath);
  if (cmd === "validate") {
    if (errors.length) { errors.forEach((e) => console.error(`INVALID ${e}`)); process.exit(1); }
    console.log(`OPERATING_STATE_VALID state=${doc.state}`);
    process.exit(0);
  }
  if (errors.length) { errors.forEach((e) => console.error(`INVALID ${e}`)); process.exit(2); }
  if (cmd === "guard-schedule") {
    const purpose = arg("--purpose") || "mutation";
    const { allow, receipt } = scheduleDecision(doc, purpose);
    console.log(`OPERATING_STATE_RECEIPT ${JSON.stringify(receipt)}`);
    if (!allow) { console.error(`OPERATING_STATE_BLOCKED state=${doc.state} purpose=${purpose}`); process.exit(78); }
    console.log(`OPERATING_STATE_ALLOWED state=${doc.state} purpose=${purpose}`);
    process.exit(0);
  }
  if (cmd === "verify-docs") {
    const readmePath = arg("--readme") ? resolve(arg("--readme")) : undefined;
    const docErrors = verifyDocs(readmePath, doc);
    if (docErrors.length) { docErrors.forEach((e) => console.error(`DOC_MISMATCH ${e}`)); process.exit(1); }
    console.log(`OPERATING_STATE_DOCS_AGREE state=${doc.state}`);
    process.exit(0);
  }
  die(`usage: operating-state.mjs validate|guard-schedule [--purpose mutation|validation]|verify-docs [--state p] [--readme p]`);
}
