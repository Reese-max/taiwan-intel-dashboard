import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

export const RECOVERY_DRILL_REPORT_DIR = join(REPO_ROOT, "docs", "operations", "reports", "recovery-prerequisites");

export const REQUIRED_ENV_VARS = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "TWINKLE_MCP_TOKEN",
  "DEPLOY_BASE_URL",
];

export const REQUIRED_WORKFLOW_FILES = [
  "pipeline-fetch.yml",
  "pipeline-audit.yml",
  "pipeline-dry-run.yml",
  "update-and-deploy.yml",
  "pr-check.yml",
];

export const DEFAULT_ENDPOINTS = [
  "https://taiwan-intel-dashboard.pages.dev",
  "https://opendata.cwa.gov.tw",
];

export const FORBIDDEN_OPERATIONS = Object.freeze([
  "fetch",
  "deploy",
  "writeProductionData",
  "enableWorkflow",
  "changeCloudflareSettings",
]);

function reportFileName(timestamp) {
  return `recovery-prerequisites-${String(timestamp).replace(/[:.]/g, "-")}.json`;
}

export function writeRecoveryPrerequisitesReport(
  result,
  { reportDir = RECOVERY_DRILL_REPORT_DIR, mkdir = mkdirSync, writeFile = writeFileSync } = {},
) {
  const reportPath = join(reportDir, reportFileName(result.timestamp));
  mkdir(reportDir, { recursive: true });
  writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return reportPath;
}

const READ_ONLY_OPERATIONS = Object.freeze(["exists", "readFile", "readDir"]);

export async function checkEnvSecrets({ env = process.env, strict = false } = {}) {
  const presentRequired = REQUIRED_ENV_VARS.filter((name) => Boolean(env[name]));
  const missingRequired = REQUIRED_ENV_VARS.filter((name) => !env[name]);
  return {
    id: "env-secrets",
    name: "必要環境變數／secrets 存在性",
    status: strict && missingRequired.length ? "fail" : "pass",
    detail: `已檢查環境變數（必要：${presentRequired.length}/${REQUIRED_ENV_VARS.length} 存在${
      missingRequired.length ? `，缺：${missingRequired.join("、")}` : ""
    }）`,
    metadata: { presentRequired, missingRequired },
  };
}

export async function checkDataEndpoints({ endpoints = DEFAULT_ENDPOINTS, endpointEvidence = [] } = {}) {
  const evidenceByUrl = new Map(endpointEvidence.map((evidence) => [evidence.url, evidence]));
  const results = endpoints.map((url) => {
    const evidence = evidenceByUrl.get(url);
    return evidence
      ? { url, status: evidence.status, ok: Boolean(evidence.ok), ...(evidence.error ? { error: evidence.error } : {}) }
      : { url, status: 0, ok: false, error: "純 dry-run 禁止對外 HTTP 端點探測；未提供本機端點證據" };
  });
  return {
    id: "data-endpoints",
    name: "資料端點證據檢視",
    status: results.every((result) => result.ok) ? "pass" : "fail",
    detail: results
      .map((result) => `${result.url}：${result.ok ? `HTTP ${result.status}` : result.error || `HTTP ${result.status}`}`)
      .join("；"),
    metadata: { endpoints: results },
  };
}

export async function checkCiWorkflows({
  rootDir = REPO_ROOT,
  exists = existsSync,
  readFile = readFileSync,
  readDir = readdirSync,
  parseYaml = parseDocument,
} = {}) {
  const workflowDir = join(rootDir, ".github", "workflows");
  const checkedFiles = [];
  const missingFiles = [];
  const invalidYaml = [];
  let workflowNames;
  try {
    workflowNames = readDir(workflowDir).filter((name) => /\.ya?ml$/i.test(name)).sort();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      id: "ci-workflows",
      name: "CI workflow 檔完整性",
      status: "fail",
      detail: `無法讀取 workflow 目錄：${reason}`,
      metadata: { checkedFiles, missingFiles, invalidYaml, workflowDirectoryError: reason },
    };
  }
  for (const name of [...new Set([...REQUIRED_WORKFLOW_FILES, ...workflowNames])]) {
    const path = join(workflowDir, name);
    if (!exists(path)) {
      missingFiles.push(name);
      continue;
    }
    const content = readFile(path, "utf8");
    if (!content.trim()) {
      missingFiles.push(`${name}（空白）`);
      continue;
    }
    try {
      const document = parseYaml(content, { prettyErrors: false });
      if (document.errors.length) {
        invalidYaml.push({ name, reason: document.errors.map((error) => error.message).join("；") });
      } else {
        checkedFiles.push(name);
      }
    } catch (error) {
      invalidYaml.push({ name, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  const failures = [
    missingFiles.length ? `缺少或空白：${missingFiles.join("、")}` : "",
    invalidYaml.length ? `YAML 解析失敗：${invalidYaml.map(({ name, reason }) => `${name}：${reason}`).join("；")}` : "",
  ].filter(Boolean);
  return {
    id: "ci-workflows",
    name: "CI workflow 檔完整性",
    status: failures.length ? "fail" : "pass",
    detail: failures.length ? failures.join("；") : `已確認並解析 ${checkedFiles.length} 個 workflow 檔案`,
    metadata: { checkedFiles, missingFiles, invalidYaml },
  };
}

export async function checkCloudflarePages({ rootDir = REPO_ROOT, exists = existsSync, readFile = readFileSync } = {}) {
  const path = join(rootDir, ".github", "workflows", "update-and-deploy.yml");
  if (!exists(path)) {
    return { id: "cloudflare-pages", name: "Cloudflare Pages 設定檢視", status: "fail", detail: "找不到 update-and-deploy.yml" };
  }
  const content = readFile(path, "utf8");
  const metadata = {
    hasProject: content.includes("project-name=taiwan-intel-dashboard"),
    hasBranch: content.includes("branch=main"),
    hasAccountId: content.includes("accountId"),
  };
  const ok = Object.values(metadata).every(Boolean);
  return {
    id: "cloudflare-pages",
    name: "Cloudflare Pages 設定檢視",
    status: ok ? "pass" : "fail",
    detail: ok ? "已唯讀檢視 Cloudflare Pages 專案、分支與 accountId" : "Cloudflare Pages workflow 設定不完整",
    metadata,
  };
}

export async function checkBuildArtifacts({ rootDir = REPO_ROOT, exists = existsSync, runDryBuild = false } = {}) {
  if (runDryBuild) {
    return {
      id: "build-artifacts",
      name: "建置產物檔案檢視",
      status: "fail",
      detail: "唯讀演練拒絕執行可能寫入產物的建置命令",
    };
  }
  const required = ["scripts/build-network.mjs", "scripts/build-static.mjs", "vite.config.ts", "tsconfig.json"];
  const missing = required.filter((name) => !exists(join(rootDir, name)));
  return {
    id: "build-artifacts",
    name: "建置產物檔案檢視",
    status: missing.length ? "fail" : "pass",
    detail: missing.length ? `缺少：${missing.join("、")}` : "建置腳本與設定檔均存在（未執行建置）",
    metadata: { missing, dryBuildExecuted: false },
  };
}

function createReadOnlyOperations(operations = {}) {
  const safe = Object.freeze({
    exists: typeof operations.exists === "function" ? operations.exists : existsSync,
    readFile: typeof operations.readFile === "function" ? operations.readFile : readFileSync,
    readDir: typeof operations.readDir === "function" ? operations.readDir : readdirSync,
  });
  return new Proxy(safe, {
    get(target, property, receiver) {
      if (FORBIDDEN_OPERATIONS.includes(String(property))) {
        throw new Error(`唯讀復原演練拒絕操作：${String(property)}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

export function createReadOnlyRecoveryExecutor({
  rootDir = REPO_ROOT,
  endpoints = DEFAULT_ENDPOINTS,
  env = process.env,
  endpointEvidence = [],
  operations = {},
  runDryBuild = false,
} = {}) {
  const readOnlyOperations = createReadOnlyOperations(operations);
  return Object.freeze({
    operations: readOnlyOperations,
    async run() {
      const checks = [
        {
          id: "read-only-capabilities",
          name: "唯讀能力封鎖",
          status: "pass",
          detail: "演練只暴露 exists、readFile、readDir；HTTP、部署、生產寫入、workflow 啟用與 Cloudflare 設定變更均不可用",
          metadata: { exposed: READ_ONLY_OPERATIONS, blocked: FORBIDDEN_OPERATIONS },
        },
        await checkEnvSecrets({ env, strict: true }),
        await checkDataEndpoints({ endpoints, endpointEvidence }),
        await checkCiWorkflows({
          rootDir,
          exists: readOnlyOperations.exists,
          readFile: readOnlyOperations.readFile,
          readDir: readOnlyOperations.readDir,
        }),
        await checkCloudflarePages({ rootDir, exists: readOnlyOperations.exists, readFile: readOnlyOperations.readFile }),
        await checkBuildArtifacts({ rootDir, exists: readOnlyOperations.exists, runDryBuild }),
      ];
      const summary = {
        total: checks.length,
        pass: checks.filter((check) => check.status === "pass").length,
        fail: checks.filter((check) => check.status === "fail").length,
        skip: checks.filter((check) => check.status === "skip").length,
      };
      return { timestamp: new Date().toISOString(), dryRun: true, ok: summary.fail === 0 && summary.skip === 0, summary, checks };
    },
  });
}

export async function runRecoveryPrerequisitesDrill(options = {}) {
  if (options.dryRun === false) {
    throw new Error("本演練腳本僅支援顯式唯讀 dry-run 模式");
  }
  return createReadOnlyRecoveryExecutor(options).run();
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help")) {
    console.log(
      "用法：node scripts/verify-recovery-prerequisites.mjs --dry-run [--json]；JSON 會寫入 docs/operations/reports/recovery-prerequisites/",
    );
    process.exit(0);
  }
  if (args.has("--live") || args.has("--write") || args.has("--deploy")) {
    console.error("錯誤：復原演練只允許唯讀 dry-run，拒絕 live、write、deploy 路徑。");
    process.exit(1);
  }
  runRecoveryPrerequisitesDrill({ dryRun: true })
    .then((result) => {
      const reportPath = writeRecoveryPrerequisitesReport(result);
      const reportLocation = relative(REPO_ROOT, reportPath).replaceAll("\\", "/");
      if (args.has("--json")) {
        console.log(JSON.stringify(result, null, 2));
        console.error(`演練報告：${reportLocation}`);
      } else {
        console.log(`復原演練：${result.ok ? "PASS" : "FAIL"}（報告：${reportLocation}）`);
      }
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
