// Issue #18：summary.json 部署前語意完整性閘門。
// 規則：有事件時摘要不得為「（暫無資料）」或空白；
// 預設模式允許經驗證的確定性統計備援（提供警告），
// 嚴格模式（--require-narrative / --strict）才要求必須有完整 AI 敘述。
// 同時使用 incident-only 輸入（排除 reference-only rows），避免誤判。

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditSummary } from "./lib/summary-quality.mjs";
import { isReferenceEvent } from "./lib/event-contract.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function argValue(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

function hasFlag(name, argv = process.argv.slice(2)) {
  return argv.includes(`--${name}`);
}

function readJson(file, label, { optional = false } = {}) {
  if (!existsSync(file)) {
    if (optional) return null;
    throw new Error(`找不到 ${label}：${file}`);
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`無法讀取 ${label}：${error.message}`);
  }
}

export function countIncidentsFromFile(file) {
  const data = readJson(file, file, { optional: true });
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.events)
      ? data.events
      : Array.isArray(data?.items)
        ? data.items
        : [];
  return list.filter((e) => !isReferenceEvent(e)).length;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const dataDir = argValue("data-dir") || join(ROOT, "public", "data");
    const summary = readJson(join(dataDir, "summary.json"), "summary.json", { optional: true });
    const domesticCount = countIncidentsFromFile(join(dataDir, "domestic.json"));
    const internationalCount = countIncidentsFromFile(join(dataDir, "international.json"));
    const requireNarrative = hasFlag("require-narrative") || hasFlag("strict");

    const report = auditSummary({
      summary,
      domesticCount,
      internationalCount,
      requireNarrative,
    });

    for (const warning of report.warnings) {
      console.warn(`[audit:summary warning] ${warning.reason}`);
    }

    if (!report.ok) {
      for (const failure of report.failures) {
        console.error(`::error title=AI 摘要語意閘門::${failure.reason}`);
      }
      console.error(`SUMMARY_AUDIT_FAIL ${report.failures.map((f) => f.reason).join("；")}`);
      process.exit(1);
    }

    console.log(
      `SUMMARY_AUDIT_OK AI 摘要語意完整性檢查通過（國內事件 ${domesticCount}，國際事件 ${internationalCount}${report.warnings.length ? `，含 ${report.warnings.length} 項警告` : ""}）`,
    );
  } catch (err) {
    console.error(`::error title=AI 摘要審計異常::${err.message}`);
    process.exit(1);
  }
}
