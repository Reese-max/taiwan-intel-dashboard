import { describe, expect, it, vi } from "vitest";
import {
  checkBuildArtifacts,
  checkCiWorkflows,
  checkCloudflarePages,
  checkDataEndpoints,
  checkEnvSecrets,
  createReadOnlyRecoveryExecutor,
  FORBIDDEN_OPERATIONS,
  REQUIRED_ENV_VARS,
  REQUIRED_WORKFLOW_FILES,
  runRecoveryPrerequisitesDrill,
} from "../scripts/verify-recovery-prerequisites.mjs";

describe("唯讀復原前提演練", () => {
  it("保留前提檢查的基本契約", async () => {
    expect((await checkEnvSecrets({ env: {}, strict: false })).status).toBe("pass");
    expect((await checkEnvSecrets({ env: {}, strict: true })).status).toBe("fail");
    expect(REQUIRED_ENV_VARS).toHaveLength(4);
    expect(REQUIRED_WORKFLOW_FILES).toHaveLength(5);
    expect((await checkBuildArtifacts({ runDryBuild: false })).status).toBe("pass");
    expect((await checkCiWorkflows()).status).toBe("pass");
    expect((await checkCloudflarePages()).status).toBe("pass");
  });

  it("以注入的本機端點證據檢查資料端點，不執行 HTTP", async () => {
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
