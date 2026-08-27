import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import {
  checkBuildArtifacts,
  checkCiWorkflows,
  checkCloudflarePages,
  checkDependencyIntegrity,
  checkDataEndpoints,
  checkEnvSecrets,
  createReadOnlyRecoveryExecutor,
  FORBIDDEN_OPERATIONS,
  REQUIRED_ENV_VARS,
  REQUIRED_WORKFLOW_FILES,
  runRecoveryPrerequisitesDrill,
} from "../scripts/verify-recovery-prerequisites.mjs";

describe("唯讀復原前提演練", () => {
  it("所有宣告依賴的 node_modules package.json 齊備時通過", () => {
    const rootDir = "dependency-fixture";
    const manifest = { dependencies: { leaflet: "^1.9.4" }, devDependencies: { "@scope/esm-only": "^1.0.0" } };
    const files = new Map([
      [join(rootDir, "package.json"), JSON.stringify(manifest)],
      [join(rootDir, "node_modules", "leaflet", "package.json"), "{}"],
      [join(rootDir, "node_modules", "@scope", "esm-only", "package.json"), "{}"],
    ]);
    const result = checkDependencyIntegrity({
      rootDir,
      exists: (path) => files.has(path),
      readFile: (path) => files.get(path),
    });

    expect(result.status).toBe("pass");
    expect(result.metadata.missingDependencies).toEqual([]);
  });

  it("刻意移除一個依賴時失敗並指出套件名", () => {
    const rootDir = "dependency-fixture";
    const missing = "@scope/esm-only";
    const packageJson = join(rootDir, "package.json");
    const installedPackage = join(rootDir, "node_modules", "leaflet", "package.json");
    const files = new Map([
      [packageJson, JSON.stringify({ dependencies: { leaflet: "^1.9.4" }, devDependencies: { [missing]: "^1.0.0" } })],
      [installedPackage, "{}"],
    ]);
    const result = checkDependencyIntegrity({
      rootDir,
      exists: (path) => files.has(path),
      readFile: (path) => files.get(path),
    });

    expect(result.status).toBe("fail");
    expect(result.detail).toContain(missing);
    expect(result.metadata.missingDependencies).toEqual([missing]);
  });

  it("所有 GitHub Actions secrets 已設定時 env-secrets 通過", async () => {
    const result = await checkEnvSecrets({ secretNames: REQUIRED_ENV_VARS });

    expect(result.status).toBe("pass");
    expect(REQUIRED_ENV_VARS).toEqual(["CLOUDFLARE_API_TOKEN"]);
    expect(REQUIRED_ENV_VARS).not.toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(REQUIRED_ENV_VARS).not.toContain("DEPLOY_BASE_URL");
  });

  it("缺少 GitHub Actions secret 時失敗並指出名稱", async () => {
    const missing = REQUIRED_ENV_VARS[0];
    const result = await checkEnvSecrets({ secretNames: [] });

    expect(result.status).toBe("fail");
    expect(result.detail).toContain(missing);
  });

  it("保留前提檢查的基本契約", async () => {
    expect(REQUIRED_WORKFLOW_FILES).toHaveLength(5);
    expect((await checkBuildArtifacts({ runDryBuild: false })).status).toBe("pass");
    expect((await checkCiWorkflows()).status).toBe("pass");
    expect((await checkCloudflarePages()).status).toBe("pass");
  });

  it("Cloudflare workflow 的 accountId 不可為空", async () => {
    const result = await checkCloudflarePages({
      rootDir: "fixture",
      exists: () => true,
      readFile: () => 'project-name=taiwan-intel-dashboard\nbranch=main\naccountId: ""',
    });

    expect(result.status).toBe("fail");
    expect(result.metadata.hasAccountId).toBe(false);
  });

  it("Cloudflare workflow 必須部署 Cloudflare 設定的 main 正式分支", async () => {
    const production = await checkCloudflarePages({
      rootDir: "fixture",
      exists: () => true,
      readFile: () => 'project-name=taiwan-intel-dashboard\nbranch=main\naccountId: "account"',
    });
    const previewBranch = await checkCloudflarePages({
      rootDir: "fixture",
      exists: () => true,
      readFile: () => 'project-name=taiwan-intel-dashboard\nbranch=production\naccountId: "account"',
    });

    expect(production.status).toBe("pass");
    expect(previewBranch.status).toBe("fail");
    expect(previewBranch.metadata.hasBranch).toBe(false);
  });

  it("無端點證據時標為選用 skip，且不使整體 ok 失敗", async () => {
    const result = await runRecoveryPrerequisitesDrill({ secretNames: REQUIRED_ENV_VARS });

    const check = await checkDataEndpoints();
    expect(check.status).toBe("skip");
    expect(check.detail).toContain("需以 --endpoint-evidence 注入");
    expect(result.checks.find((check) => check.id === "data-endpoints").status).toBe("skip");
    expect(result.summary.required.fail).toBe(0);
    expect(result.summary.optional.skip).toBe(1);
    expect(result.ok).toBe(true);
  });

  it("注入正常端點證據時資料端點通過", async () => {
    const result = await checkDataEndpoints({
      endpoints: ["https://example.test"],
      endpointEvidence: [{ url: "https://example.test", status: 200, ok: true }],
    });
    expect(result.status).toBe("pass");
  });

  it("把禁止操作 mock 注入真正演練執行器後，所有操作仍為零呼叫", async () => {
    const forbidden = Object.fromEntries(FORBIDDEN_OPERATIONS.map((name) => [name, vi.fn()]));
    const result = await runRecoveryPrerequisitesDrill({
      endpoints: ["https://example.test"],
      endpointEvidence: [{ url: "https://example.test", status: 200, ok: true }],
      operations: forbidden,
    });

    expect(result.dryRun).toBe(true);
    for (const name of FORBIDDEN_OPERATIONS) {
      expect(forbidden[name]).not.toHaveBeenCalled();
    }
  });

  it("公開的執行器能力物件不包含禁止操作", () => {
    const executor = createReadOnlyRecoveryExecutor();
    expect(Object.keys(executor.operations)).toEqual(["exists", "readFile", "readDir"]);
    for (const name of FORBIDDEN_OPERATIONS) expect(name in executor.operations).toBe(false);
  });

  it("不接受非 dry-run 模式，也不會觸發禁止操作", async () => {
    const forbidden = Object.fromEntries(FORBIDDEN_OPERATIONS.map((name) => [name, vi.fn()]));
    await expect(runRecoveryPrerequisitesDrill({ dryRun: false, operations: forbidden })).rejects.toThrow(
      "本演練腳本僅支援顯式唯讀 dry-run 模式",
    );
    for (const name of FORBIDDEN_OPERATIONS) expect(forbidden[name]).not.toHaveBeenCalled();
  });
});
