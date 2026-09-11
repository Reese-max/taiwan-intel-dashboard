import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditSummary } from "./lib/summary-quality.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function argValue(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
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

function countEvents(file) {
  const data = readJson(file, file, { optional: true });
  if (Array.isArray(data)) return data.length;
  if (Array.isArray(data?.events)) return data.events.length;
  if (Array.isArray(data?.items)) return data.items.length;
  return 0;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const dataDir = argValue("data-dir") || join(ROOT, "public", "data");
    const summary = readJson(join(dataDir, "summary.json"), "summary.json", { optional: true });
    const domesticCount = countEvents(join(dataDir, "domestic.json"));
    const internationalCount = countEvents(join(dataDir, "international.json"));
    const result = auditSummary({ summary, domesticCount, internationalCount });
    for (const failure of result.failures) {
      console.log(`::error title=摘要完整性::${failure.reason}`);
    }
    for (const warning of result.warnings) {
      console.log(`::warning title=摘要完整性::${warning.reason}`);
    }
    console.log(
      `摘要完整性稽核：${result.status}（國內 ${domesticCount} 筆、國際 ${internationalCount} 筆、fail=${result.failures.length}、warning=${result.warnings.length}）`,
    );
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`摘要完整性稽核失敗：${error.message}`);
    process.exitCode = 1;
  }
}
