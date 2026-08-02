import { describe, expect, it, vi } from "vitest";
import {
  FORBIDDEN_OPERATIONS,
  REQUIRED_ENV_VARS,
  REQUIRED_WORKFLOW_FILES,
  runRecoveryPrerequisitesDrill,
} from "../scripts/verify-recovery-prerequisites.mjs";

const ROOT = "restore-drill-test-root";
const ENDPOINTS = ["https://dashboard.test", "https://data.test"];
const REQUIRED_FILES = [
  ...REQUIRED_WORKFLOW_FILES.map((name) => `.github/workflows/${name}`),
  "scripts/build-network.mjs",
  "scripts/build-static.mjs",
  "vite.config.ts",
  "tsconfig.json",
];
const REPORT_KEYS = ["checks", "dryRun", "ok", "summary", "timestamp"];
const SUMMARY_KEYS = ["fail", "pass", "skip", "total"];
const CHECK_KEYS = ["detail", "id", "metadata", "name", "status"];

function createHarness() {
  const files = new Map(
    REQUIRED_FILES.map((relativePath) => [
      `${ROOT}/${relativePath}`,
      relativePath.endsWith("update-and-deploy.yml")
        ? "project-name=taiwan-intel-dashboard branch=main accountId"
        : "name: test",
    ]),
  );
  const exists = vi.fn((filePath: string) => files.has(filePath.replaceAll("\\", "/")));
  const readFile = vi.fn((filePath: string) => files.get(filePath.replaceAll("\\", "/")) ?? "");
  const endpointProbe = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  const commandExecutor = Object.fromEntries(FORBIDDEN_OPERATIONS.map((name) => [name, vi.fn()]));
  const env = Object.fromEntries(REQUIRED_ENV_VARS.map((name) => [name, `test-${name}`]));

  return {
    files,
    exists,
    readFile,
    endpointProbe,
    commandExecutor,
    options: {
      dryRun: true,
      strict: true,
      rootDir: ROOT,
      endpoints: ENDPOINTS,
      env,
      operations: { ...commandExecutor, fetch: endpointProbe, exists, readFile },
    },
  };
}

function statuses(result: Awaited<ReturnType<typeof runRecoveryPrerequisitesDrill>>) {
  return Object.fromEntries(result.checks.map((check: { id: string; status: string }) => [check.id, check.status]));
}

function expectReportSchema(result: Awaited<ReturnType<typeof runRecoveryPrerequisitesDrill>>) {
  expect(Object.keys(result).sort()).toEqual(REPORT_KEYS.sort());
  expect(Object.keys(result.summary).sort()).toEqual(SUMMARY_KEYS.sort());
  expect(result.checks.map((check: { id: string }) => check.id)).toEqual([
    "read-only-capabilities",
    "env-secrets",
    "data-endpoints",
    "ci-workflows",
    "cloudflare-pages",
    "build-artifacts",
  ]);
  for (const check of result.checks) {
    expect(Object.keys(check).sort()).toEqual(CHECK_KEYS.sort());
    expect(["pass", "fail", "skip"]).toContain(check.status);
    expect(typeof check.detail).toBe("string");
  }
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
}

describe("復原演練注入式判定", () => {
  it("完整前提通過並輸出固定 JSON schema", async () => {
    const harness = createHarness();
    const result = await runRecoveryPrerequisitesDrill(harness.options);

    expect(result.ok).toBe(true);
    expect(result.summary).toEqual({ total: 6, pass: 6, fail: 0, skip: 0 });
    expectReportSchema(result);
    expect(harness.endpointProbe).toHaveBeenCalledTimes(ENDPOINTS.length);
    expect(harness.exists).toHaveBeenCalled();
    expect(harness.readFile).toHaveBeenCalled();
    for (const command of Object.values(harness.commandExecutor)) expect(command).not.toHaveBeenCalled();
  });

  it("缺少 secret 只使環境檢查失敗，其他前提仍獨立執行", async () => {
    const harness = createHarness();
    harness.options.env = { ...harness.options.env, [REQUIRED_ENV_VARS[0]]: "" };
    const result = await runRecoveryPrerequisitesDrill(harness.options);

    expect(statuses(result)).toEqual({
      "read-only-capabilities": "pass",
      "env-secrets": "fail",
      "data-endpoints": "pass",
      "ci-workflows": "pass",
      "cloudflare-pages": "pass",
      "build-artifacts": "pass",
    });
    expect(result.ok).toBe(false);
    expect(harness.endpointProbe).toHaveBeenCalledTimes(ENDPOINTS.length);
    expect(harness.readFile).toHaveBeenCalled();
  });

  it("端點不可達只使端點檢查失敗，仍完成檔案前提檢查", async () => {
    const harness = createHarness();
    harness.endpointProbe.mockImplementation(async (url: string) => {
      if (url === ENDPOINTS[1]) throw new Error("endpoint unreachable");
      return { ok: true, status: 200 };
    });
    const result = await runRecoveryPrerequisitesDrill(harness.options);

    expect(statuses(result)["env-secrets"]).toBe("pass");
    expect(statuses(result)["data-endpoints"]).toBe("fail");
    expect(statuses(result)["ci-workflows"]).toBe("pass");
    expect(statuses(result)["cloudflare-pages"]).toBe("pass");
    expect(statuses(result)["build-artifacts"]).toBe("pass");
    expect(result.checks.find((check: { id: string }) => check.id === "data-endpoints").metadata.endpoints[1]).toMatchObject({
      url: ENDPOINTS[1],
      status: 0,
      ok: false,
      error: "endpoint unreachable",
    });
    expect(harness.readFile).toHaveBeenCalled();
  });

  it("檔案系統缺少一個 workflow 只影響檔案判定", async () => {
    const harness = createHarness();
    harness.files.delete(`${ROOT}/.github/workflows/pipeline-audit.yml`);
    const result = await runRecoveryPrerequisitesDrill(harness.options);

    expect(statuses(result)).toMatchObject({
      "env-secrets": "pass",
      "data-endpoints": "pass",
      "ci-workflows": "fail",
      "cloudflare-pages": "pass",
      "build-artifacts": "pass",
    });
    expect(result.ok).toBe(false);
    expect(result.checks.find((check: { id: string }) => check.id === "ci-workflows").metadata.missingFiles).toEqual([
      "pipeline-audit.yml",
    ]);
  });
});
