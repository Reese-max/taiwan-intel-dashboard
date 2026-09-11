// Issue #17：operating-state 合約的機器檢查。
// 單一事實源 ops/operating-state.json；此檢查確保它與
// README 狀態文字、workflow schedule trigger、restore receipt 一致。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const CONTRACT_PATH = join(ROOT, "ops", "operating-state.json");
const VALID_STATES = new Set(["ACTIVE", "PAUSED"]);

export function checkOperatingState({
  contract,
  readme,
  workflowTexts,
  restoreReport,
}) {
  const failures = [];
  const warnings = [];

  if (!VALID_STATES.has(contract?.state)) {
    failures.push(`operating-state.json state 無效：${JSON.stringify(contract?.state)}（應為 ACTIVE 或 PAUSED）`);
    return { ok: false, state: contract?.state, failures, warnings };
  }
  const state = contract.state;

  // 1. workflow schedule 與宣告狀態一致
  const scheduled = workflowTexts.filter(
    (w) => /(^|\n)\s*schedule:/.test(w.text) && /cron:/.test(w.text),
  );
  if (state === "PAUSED" && scheduled.length) {
    failures.push(
      `宣告 PAUSED 但仍有 ${scheduled.length} 個 workflow 含 schedule trigger（${scheduled.map((w) => w.name).join("、")}）`,
    );
  }
  if (state === "ACTIVE" && !scheduled.length) {
    warnings.push("宣告 ACTIVE 但沒有任何 workflow 含 schedule trigger");
  }

  // 2. README 狀態文字
  const readmePaused = /已暫停|HTTP 503|PAUSED/i.test(readme);
  if (state === "ACTIVE" && readmePaused) {
    failures.push("宣告 ACTIVE 但 README 仍宣稱已暫停／503");
  }
  if (state === "PAUSED" && !readmePaused) {
    failures.push("宣告 PAUSED 但 README 未標示暫停狀態");
  }

  // 3. ACTIVE 必須保留 restore receipt，且報告 ok=true
  if (state === "ACTIVE") {
    if (!contract.restoreReceipt) {
      failures.push("ACTIVE 狀態缺少 restoreReceipt 欄位");
    } else if (!existsSync(join(ROOT, contract.restoreReceipt))) {
      failures.push(`restoreReceipt 檔案不存在：${contract.restoreReceipt}`);
    } else if (!restoreReport || restoreReport.ok !== true) {
      failures.push(`restoreReceipt 報告非通過狀態：${contract.restoreReceipt}`);
    }
  }

  return { ok: failures.length === 0, state, failures, warnings };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const workflowDir = join(ROOT, ".github", "workflows");
    const workflowTexts = readdirSync(workflowDir)
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
      .map((f) => ({ name: f, text: readFileSync(join(workflowDir, f), "utf8") }));
    const restoreReport =
      contract.restoreReceipt && existsSync(join(ROOT, contract.restoreReceipt))
        ? JSON.parse(readFileSync(join(ROOT, contract.restoreReceipt), "utf8"))
        : null;

    const result = checkOperatingState({
      contract,
      readme,
      workflowTexts,
      restoreReport,
    });
    // --require-active：部署前的硬閘門——PAUSED 永遠擋下（即使文件一致）。
    if (process.argv.includes("--require-active") && contract.state !== "ACTIVE") {
      result.failures.push(`部署守衛：operating state 為 ${contract.state}，非 ACTIVE`);
      result.ok = false;
    }
    for (const failure of result.failures) {
      console.log(`::error title=operating-state::${failure}`);
    }
    for (const warning of result.warnings) {
      console.log(`::warning title=operating-state::${warning}`);
    }
    console.log(
      `operating-state 檢查：${result.ok ? "pass" : "fail"}（state=${result.state}，fail=${result.failures.length}、warning=${result.warnings.length}）`,
    );
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`operating-state 檢查失敗：${error.message}`);
    process.exitCode = 1;
  }
}
