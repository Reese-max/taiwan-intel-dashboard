// summary.json 語意閘門（issue #18）：有事件資料但 AI 摘要仍是「（暫無資料）」
// 佔位 → 候選內容不完整，部署必須失敗，不得把降級偽裝成「無資料」。

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EMPTY_BRIEF = "（暫無資料）";

const argValue = (name, fallback) => {
  const found = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

function readJsonOr(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

const dataDir = argValue("data-dir", join(ROOT, "public/data"));
const summary = readJsonOr(join(dataDir, "summary.json"), null);
const domestic = readJsonOr(join(dataDir, "domestic.json"), []);
const intl = readJsonOr(join(dataDir, "international.json"), []);

const problems = [];
if (!summary) {
  problems.push("summary.json 不存在或無法解析");
} else {
  const domEvents = Array.isArray(domestic) ? domestic.length : 0;
  const intlEvents = Array.isArray(intl) ? intl.length : 0;
  const domEmpty = !summary.domestic || summary.domestic.trim() === EMPTY_BRIEF;
  const intlEmpty = !summary.international || summary.international.trim() === EMPTY_BRIEF;
  if (domEvents > 0 && domEmpty)
    problems.push(`domestic 有 ${domEvents} 則事件但摘要為空（佔位）`);
  if (intlEvents > 0 && intlEmpty)
    problems.push(`international 有 ${intlEvents} 則事件但摘要為空（佔位）`);
}

if (problems.length) {
  for (const p of problems) console.log(`::error title=AI 摘要語意閘門::${p}`);
  console.log(`SUMMARY_AUDIT_FAIL ${problems.join("；")}`);
  process.exit(1);
}
console.log("SUMMARY_AUDIT_OK 摘要與事件資料一致");
