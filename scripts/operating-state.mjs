#!/usr/bin/env node
// 營運狀態契約（ops/operating-state.json）的單一判讀與閘門腳本。
// 支援狀態：PAUSED | RESTORING | ACTIVE | DEGRADED
// 規範與轉移規則詳見 docs/operations/operating-state.md。

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_STATE_PATH = "ops/operating-state.json";
export const EXPECTED_REPO = "Reese-max/taiwan-intel-dashboard";
export const VALID_STATES = ["PAUSED", "RESTORING", "ACTIVE", "DEGRADED"];

export const README_MARKERS = {
  PAUSED: "已暫停",
  RESTORING: "復原驗證中",
  ACTIVE: "運作中",
  DEGRADED: "降級運作中",
};

export const ALLOWED_RECEIPT_DIRS = [
  "docs/operations/receipts",
  "docs/operations/reports",
];

export function validateReceipt(receiptRelPath, repoRoot = REPO_ROOT) {
  const errors = [];
  if (typeof receiptRelPath !== "string" || !receiptRelPath.trim()) {
    return { ok: false, errors: ["receipt path must be a non-empty string"] };
  }

  const cleanPath = normalize(receiptRelPath).replace(/\\/g, "/");
  if (isAbsolute(cleanPath) || cleanPath.startsWith("../") || cleanPath.includes("/../")) {
    return { ok: false, errors: ["receipt path must be a relative path without directory traversal (..)"] };
  }

  const inAllowedDir = ALLOWED_RECEIPT_DIRS.some((d) => cleanPath === d || cleanPath.startsWith(`${d}/`));
  if (!inAllowedDir) {
    return {
      ok: false,
      errors: [`receipt path must be within ${ALLOWED_RECEIPT_DIRS.join(" or ")}, got: ${cleanPath}`],
    };
  }

  const fullPath = resolve(repoRoot, cleanPath);
  if (!existsSync(fullPath)) {
    return { ok: false, errors: [`restoreReceipt not found at: ${cleanPath}`] };
  }

  const content = readFileSync(fullPath, "utf8");
  if (cleanPath.endsWith(".json")) {
    try {
      const data = JSON.parse(content);
      if (data.repo && data.repo !== EXPECTED_REPO) {
        errors.push(`receipt belongs to unexpected repository: ${data.repo} (expected ${EXPECTED_REPO})`);
      }
      if (data.repository && data.repository !== EXPECTED_REPO) {
        errors.push(`receipt belongs to unexpected repository: ${data.repository} (expected ${EXPECTED_REPO})`);
      }
      const isSuccess = data.ok === true || data.conclusion === "success" || data.status === "pass";
      if (!isSuccess) {
        errors.push("receipt indicates failure or incomplete status (must have ok:true, conclusion:success, or status:pass)");
      }
      if (data.summary?.fail && data.summary.fail > 0) {
        errors.push(`receipt summary contains ${data.summary.fail} failures`);
      }
      if (data.summary?.required?.fail && data.summary.required.fail > 0) {
        errors.push(`receipt summary contains ${data.summary.required.fail} required check failures`);
      }
    } catch (e) {
      errors.push(`receipt JSON parsing failed: ${e.message}`);
    }
  } else {
    // Markdown or text receipt
    const expectedRepoUrlRegex = new RegExp(`https://github\\.com/${EXPECTED_REPO.replace("/", "\\/")}/actions/runs/\\d+`);
    if (!expectedRepoUrlRegex.test(content)) {
      errors.push(`receipt must reference a run URL in ${EXPECTED_REPO}`);
    }
    if (/(?:status|conclusion):\s*(?:fail|failure)/i.test(content) || /\bFAILED\b/.test(content)) {
      errors.push("receipt contains failure indications");
    }
    if (!/(?:status|conclusion):\s*success|pass|通過/i.test(content)) {
      errors.push("receipt must explicitly indicate successful run verification (success/pass/通過)");
    }
  }

  return { ok: errors.length === 0, errors, fullPath };
}

export function loadContract(statePath = resolve(REPO_ROOT, DEFAULT_STATE_PATH), repoRoot = REPO_ROOT) {
  if (!existsSync(statePath)) {
    return { doc: null, errors: [`contract missing: ${statePath}`], statePath };
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(statePath, "utf8"));
  } catch (e) {
    return { doc: null, errors: [`contract is not valid JSON: ${e.message}`], statePath };
  }

  const errors = [];
  if (doc.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!VALID_STATES.includes(doc.state)) {
    errors.push(`state must be one of ${VALID_STATES.join("/")}, got ${doc.state}`);
  }
  if (!doc.effectiveAt || Number.isNaN(Date.parse(doc.effectiveAt))) {
    errors.push("effectiveAt must be a valid ISO timestamp");
  }
  if (typeof doc.owner !== "string" || !doc.owner.trim()) {
    errors.push("owner is required");
  }
  if (typeof doc.reason !== "string" || !doc.reason.trim()) {
    errors.push("reason is required");
  }

  // ACTIVE 必須有受驗證的 restoreReceipt
  if (doc.state === "ACTIVE") {
    const receipt = doc.evidence?.restoreReceipt;
    if (!receipt) {
      errors.push("state=ACTIVE requires evidence.restoreReceipt");
    } else {
      const receiptRes = validateReceipt(receipt, repoRoot);
      if (!receiptRes.ok) {
        errors.push(...receiptRes.errors.map((e) => `ACTIVE restoreReceipt error: ${e}`));
      }
    }
  }

  return { doc, errors, statePath };
}

export function scheduleDecision(doc, purpose = "mutation") {
  const base = {
    contract: DEFAULT_STATE_PATH,
    state: doc.state,
    purpose,
    effectiveAt: doc.effectiveAt,
  };

  if (doc.state === "PAUSED") {
    return {
      allow: false,
      skipped: true,
      exitCode: 78,
      receipt: { ...base, skipped: true, why: doc.reason },
    };
  }

  if (doc.state === "RESTORING" && purpose !== "validation") {
    return {
      allow: false,
      skipped: true,
      exitCode: 78,
      receipt: {
        ...base,
        skipped: true,
        why: "RESTORING allows only the documented controlled validation path",
      },
    };
  }

  if (doc.state === "DEGRADED") {
    return {
      allow: true,
      skipped: false,
      exitCode: 0,
      receipt: {
        ...base,
        skipped: false,
        notice: "Operating in DEGRADED mode pending formal restore receipt",
      },
    };
  }

  return {
    allow: true,
    skipped: false,
    exitCode: 0,
    receipt: { ...base, skipped: false },
  };
}

export function verifyDocs(readmePath = resolve(REPO_ROOT, "README.md"), doc = loadContract().doc) {
  if (!doc || !doc.state) {
    return ["valid contract doc required for verifyDocs"];
  }
  if (!existsSync(readmePath)) {
    return [`README not found: ${readmePath}`];
  }
  const readme = readFileSync(readmePath, "utf8");
  const marker = README_MARKERS[doc.state];
  const statusLine = readme.split("\n").find((l) => l.includes("狀態"));
  const errors = [];

  if (!statusLine) {
    errors.push("README has no 狀態 line");
  } else if (!statusLine.includes(`**${marker}**`)) {
    errors.push(`README status must say **${marker}** for contract state ${doc.state}, got: ${statusLine.trim()}`);
  }

  if (statusLine && /503/.test(statusLine)) {
    if (doc.state !== "PAUSED") {
      errors.push(`README claims 503 but contract state is ${doc.state} (only PAUSED may claim 503)`);
    } else if (!statusLine.includes("ops/operating-state.json")) {
      errors.push("503 claim in README must reference ops/operating-state.json");
    }
  }

  return errors;
}

function arg(flag, argv = process.argv.slice(2)) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function hasFlag(flag, argv = process.argv.slice(2)) {
  return argv.includes(flag);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const cmd = process.argv[2];
  const statePath = arg("--state") ? resolve(arg("--state")) : undefined;
  const { doc, errors } = loadContract(statePath);

  if (cmd === "validate") {
    if (errors.length) {
      errors.forEach((e) => console.error(`INVALID ${e}`));
      process.exit(1);
    }
    console.log(`OPERATING_STATE_VALID state=${doc.state}`);
    process.exit(0);
  }

  if (errors.length) {
    errors.forEach((e) => console.error(`INVALID ${e}`));
    process.exit(2);
  }

  if (cmd === "guard-schedule") {
    const purpose = arg("--purpose") || "mutation";
    const softSkip = hasFlag("--soft-skip") || hasFlag("--exit-zero-on-skip");
    const decision = scheduleDecision(doc, purpose);

    console.log(`OPERATING_STATE_RECEIPT ${JSON.stringify(decision.receipt)}`);
    if (!decision.allow) {
      if (softSkip) {
        console.log(`OPERATING_STATE_SKIPPED state=${doc.state} purpose=${purpose} (${decision.receipt.why})`);
        process.exit(0);
      }
      console.error(`OPERATING_STATE_BLOCKED state=${doc.state} purpose=${purpose} (${decision.receipt.why})`);
      process.exit(decision.exitCode);
    }
    console.log(`OPERATING_STATE_ALLOWED state=${doc.state} purpose=${purpose}`);
    process.exit(0);
  }

  if (cmd === "verify-docs") {
    const readmePath = arg("--readme") ? resolve(arg("--readme")) : undefined;
    const docErrors = verifyDocs(readmePath, doc);
    if (docErrors.length) {
      docErrors.forEach((e) => console.error(`DOC_MISMATCH ${e}`));
      process.exit(1);
    }
    console.log(`OPERATING_STATE_DOCS_AGREE state=${doc.state}`);
    process.exit(0);
  }

  console.error("usage: operating-state.mjs validate|guard-schedule [--purpose mutation|validation] [--soft-skip]|verify-docs [--state p] [--readme p]");
  process.exit(2);
}
