// 驗證 umbrella 50-persona tracker（#41）的機器可檢查會計。
// 用法：node scripts/validate-audit-tracker.mjs [tracker.md]
// 失敗（任何 invariant 違反）時 exit 1，讓 tracker 的錯誤無法靜默通過。
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  blockingFindings,
  parseTracker,
  validateTracker,
} from "./lib/audit-tracker.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TRACKER = join(ROOT, "docs", "audits", "50-persona-tracker.md");

export function validateTrackerFile(trackerPath, root = ROOT) {
  if (!existsSync(trackerPath)) return [`file: tracker 不存在：${relative(root, trackerPath)}`];
  const { tracker, errors } = parseTracker(readFileSync(trackerPath, "utf8"));
  if (errors.length) return errors;
  return validateTracker(tracker, {
    reportExists: (path) => existsSync(join(root, path)),
  });
}

function main(argv) {
  const trackerPath = argv[0] ? resolve(argv[0]) : DEFAULT_TRACKER;
  const errors = validateTrackerFile(trackerPath);
  if (errors.length) {
    for (const error of errors) console.error(`✗ ${error}`);
    console.error(`tracker 驗證失敗：${errors.length} 項問題（${relative(ROOT, trackerPath)}）`);
    process.exitCode = 1;
    return;
  }
  const { tracker } = parseTracker(readFileSync(trackerPath, "utf8"));
  const blocking = blockingFindings(tracker);
  console.log(
    `tracker 驗證通過：${tracker.rounds.length} 輪、${tracker.personas.length}/${tracker.personas.length} persona、` +
      `${tracker.findings.length} 筆 finding、未結案 ${blocking.length} 筆、streak ${tracker.clean.streak}/${tracker.clean.requiredStreak}（${tracker.clean.status}）`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2));
}
