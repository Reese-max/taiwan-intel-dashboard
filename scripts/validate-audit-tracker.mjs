// 驗證 umbrella 50-persona tracker（#41）的機器可檢查會計。
// 用法：node scripts/validate-audit-tracker.mjs [tracker.md]
// 失敗（任何 invariant 違反）時 exit 1，讓 tracker 的錯誤無法靜默通過。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  blockingFindings,
  parseTracker,
  validateTracker,
} from "./lib/audit-tracker.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT_DIR = join(ROOT, "docs", "audits");
const DEFAULT_TRACKER = join(AUDIT_DIR, "50-persona-tracker.md");
const ROUND_REPORT_RE = /^50-persona-round-\d+-\d{4}-\d{2}-\d{2}\.md$/;

function roundReportsInRepo(auditDir = AUDIT_DIR) {
  if (!existsSync(auditDir)) return [];
  return readdirSync(auditDir)
    .filter((name) => ROUND_REPORT_RE.test(name))
    .map((name) => `docs/audits/${name}`)
    .sort();
}

// Round index 表格的資料列（`| 1 | 2026-09-06 | ...`），用來比對人讀表格與 JSON 是否一致。
const ROUND_ROW_RE = /^\|\s*(\d+)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|/gm;

export function roundIndexRows(markdown) {
  return [...String(markdown).matchAll(ROUND_ROW_RE)].map((match) => ({
    round: Number(match[1]),
    date: match[2],
  }));
}

export function validateTrackerFile(trackerPath, root = ROOT) {
  if (!existsSync(trackerPath)) return [`file: tracker 不存在：${relative(root, trackerPath)}`];
  const markdown = readFileSync(trackerPath, "utf8");
  const { tracker, errors } = parseTracker(markdown);
  if (errors.length) return errors;
  const auditDir = join(root, "docs", "audits");
  const findings = validateTracker(tracker, {
    reportExists: (path) => existsSync(join(root, path)),
    readReport: (path) => {
      const file = join(root, path);
      return existsSync(file) ? readFileSync(file, "utf8") : null;
    },
    orphanReports: roundReportsInRepo(auditDir),
  });

  // 人讀的 Round index 表格必須與 JSON 的輪次一致：只改 JSON 會讓兩處敘述漂移。
  const rows = roundIndexRows(markdown);
  if (rows.length !== tracker.rounds.length) {
    findings.push(
      `docs: Round index 表格列數（${rows.length}）與 JSON 輪數（${tracker.rounds.length}）不一致`,
    );
  } else {
    tracker.rounds.forEach((round, index) => {
      if (rows[index].round !== round.round || rows[index].date !== round.date) {
        findings.push(
          `docs: Round index 表格第 ${index + 1} 列（${rows[index].round}／${rows[index].date}）與 JSON（${round.round}／${round.date}）不一致`,
        );
      }
    });
  }
  return findings;
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
