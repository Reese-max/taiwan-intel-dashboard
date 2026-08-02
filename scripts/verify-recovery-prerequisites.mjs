import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

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
  "deploy",
  "writeProductionData",
  "enableWorkflow",
  "changeCloudflareSettings",
]);

const READ_ONLY_OPERATIONS = Object.freeze(["fetch", "exists", "readFile"]);

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

export async function checkDataEndpoints({
  endpoints = DEFAULT_ENDPOINTS,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
} = {}) {
  const results = [];
  for (const url of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "HEAD",
        signal: controller.signal,
        headers: { "cache-control": "no-cache" },
      });
      results.push({ url, status: response.status, ok: response.ok || [301, 302, 403, 503].includes(response.status) });
    } catch (error) {
      results.push({ url, status: 0, ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    id: "data-endpoints",
    name: "資料端點可達性",
    status: results.every((result) => result.ok) ? "pass" : "fail",
    detail: results
      .map((result) => `${result.url}：${result.ok ? `HTTP ${result.status}` : result.error || `HTTP ${result.status}`}`)
      .join("；"),
    metadata: { endpoints: results },
  };
}

export async function checkCiWorkflows({ rootDir = REPO_ROOT, exists = existsSync, readFile = readFileSync } = {}) {
  const checkedFiles = [];
  const missingFiles = [];
  for (const name of REQUIRED_WORKFLOW_FILES) {
    const path = join(rootDir, ".github", "workflows", name);
    if (!exists(path)) {
      missingFiles.push(name);
      continue;
    }
    if (!readFile(path, "utf8").trim()) missingFiles.push(`${name}（空白）`);
    else checkedFiles.push(name);
  }
  return {
    id: "ci-workflows",
    name: "CI workflow 檔完整性",
    status: missingFiles.length ? "fail" : "pass",
    detail: missingFiles.length ? `缺少或空白：${missingFiles.join("、")}` : `已確認 ${checkedFiles.length} 個 workflow 檔案`,
    metadata: { checkedFiles, missingFiles },
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
    fetch: typeof operations.fetch === "function" ? operations.fetch : globalThis.fetch,
    exists: typeof operations.exists === "function" ? operations.exists : existsSync,
    readFile: typeof operations.readFile === "function" ? operations.readFile : readFileSync,
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
  timeoutMs = 5000,
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
          detail: "演練只暴露 fetch、exists、readFile；部署、生產寫入、workflow 啟用與 Cloudflare 設定變更均不可用",
          metadata: { exposed: READ_ONLY_OPERATIONS, blocked: FORBIDDEN_OPERATIONS },
        },
        await checkEnvSecrets({ env, strict: true }),
        await checkDataEndpoints({ endpoints, fetchImpl: readOnlyOperations.fetch, timeoutMs }),
        await checkCiWorkflows({ rootDir, exists: readOnlyOperations.exists, readFile: readOnlyOperations.readFile }),
        await checkCloudflarePages({ rootDir, exists: readOnlyOperations.exists, readFile: readOnlyOperations.readFile }),
        await checkBuildArtifacts({ rootDir, exists: readOnlyOperations.exists, runDryBuild }),
      ];
      const summary = {
        total: checks.length,
        pass: checks.filter((check) => check.status === "pass").length,
        fail: checks.filter((check) => check.status === "fail").length,
        skip: checks.filter((check) => check.status === "skip").length,
      };
      return { timestamp: new Date().toISOString(), dryRun: true, ok: summary.fail === 0, summary, checks };
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
    console.log("用法：node scripts/verify-recovery-prerequisites.mjs --dry-run [--json]");
    process.exit(0);
  }
  if (args.has("--live") || args.has("--write") || args.has("--deploy")) {
    console.error("錯誤：復原演練只允許唯讀 dry-run，拒絕 live、write、deploy 路徑。");
    process.exit(1);
  }
  runRecoveryPrerequisitesDrill({ dryRun: true })
    .then((result) => {
      console.log(args.has("--json") ? JSON.stringify(result, null, 2) : `復原演練：${result.ok ? "PASS" : "FAIL"}`);
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
