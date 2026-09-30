import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { BUILD_REPLAY_FIXTURE, canUseBuildReplayFixture } from "../scripts/build-network.mjs";
import { isNewsLikeEvent } from "../scripts/lib/correlate.mjs";

const deployWorkflow = YAML.parse(readFileSync(".github/workflows/deploy.yml", "utf8"));
const refreshWorkflow = YAML.parse(readFileSync(".github/workflows/update-and-deploy.yml", "utf8"));
const auditWorkflow = YAML.parse(readFileSync(".github/workflows/pipeline-audit.yml", "utf8"));
const releaseGateDoc = readFileSync("docs/operations/release-gate.md", "utf8");

describe("release gate contract (Issue #42)", () => {
  it("makes the required production check validate the operating-state contract", () => {
    const previewBuild = deployWorkflow.jobs["build-preview"];
    const commands = previewBuild.steps
      .map((step: { run?: string }) => step.run)
      .filter((run: string | undefined): run is string => Boolean(run));

    expect(deployWorkflow.on.pull_request.branches).toContain("production");
    expect(commands).toContain("npm run ops:validate");
    expect(commands).toContain("npm run ops:verify-docs");
    expect(deployWorkflow.jobs.check.needs).toBe("build-preview");
  });

  it("includes Python regressions in the required production check", () => {
    const steps = deployWorkflow.jobs["build-preview"].steps;
    const pythonIndex = steps.findIndex((step: { run?: string }) =>
      step.run === "python3 -m unittest discover -s tests -p test_crime_weekly_parser.py");
    expect(pythonIndex).toBeGreaterThan(-1);
    expect(pythonIndex).toBeLessThan(steps.findIndex((step: { uses?: string }) =>
      step.uses?.startsWith("actions/upload-artifact")));
    expect(steps[pythonIndex].if).toBeUndefined();
    expect(steps[pythonIndex]["continue-on-error"]).not.toBe(true);
  });

  it("requires the pipeline data audits before publishing the preview artifact", () => {
    const steps = deployWorkflow.jobs["build-preview"].steps;
    const uploadIndex = steps.findIndex((step: { uses?: string }) =>
      step.uses?.startsWith("actions/upload-artifact"));
    const requiredAudits = auditWorkflow.jobs.audit.steps.filter(
      (step: { run?: string; "continue-on-error"?: boolean }) =>
        /^npm run (audit:|check:network-contract)/.test(step.run || "") && !step["continue-on-error"],
    );
    expect(requiredAudits.length).toBeGreaterThan(0);
    for (const { run } of requiredAudits) {
      const index = steps.findIndex((step: { run?: string }) => step.run?.split("\n").includes(run));
      expect(index, `Missing required preview audit: ${run}`).toBeGreaterThan(-1);
      expect(index).toBeLessThan(uploadIndex);
      expect(steps[index].if).toBeUndefined();
      expect(steps[index]["continue-on-error"]).not.toBe(true);
    }
  });

  it("keeps data publication behind operating-state, audit, and approved-build jobs", () => {
    expect(refreshWorkflow.jobs.fetch.needs).toBe("operating-state");
    expect(refreshWorkflow.jobs.audit.needs).toBe("fetch");
    expect(refreshWorkflow.jobs["build-approved"].needs).toEqual(["fetch", "audit"]);
    expect(refreshWorkflow.jobs.deploy.needs).toEqual([
      "operating-state",
      "audit",
      "save-state",
      "build-approved",
    ]);
  });

  it("documents break-glass accountability and the complete follow-up gate", () => {
    for (const requiredTerm of [
      "break-glass",
      "操作者",
      "原因",
      "時間",
      "commit SHA",
      "GitHub audit log",
      "npm run check",
      "npm test",
      "npm run build",
    ]) {
      expect(releaseGateDoc).toContain(requiredTerm);
    }
  });

  it("documents that post-deploy smoke does not roll back publication", () => {
    expect(refreshWorkflow.jobs.deploy.needs).toContain("save-state");
    const steps = refreshWorkflow.jobs.deploy.steps;
    expect(steps.findIndex((step: { run?: string }) => step.run === "node scripts/smoke-deployed.mjs"))
      .toBeGreaterThan(steps.findIndex((step: { uses?: string }) =>
        step.uses?.startsWith("cloudflare/wrangler-action")));
    expect(releaseGateDoc).toContain("smoke 失敗不會自動回復");
  });

  it("keeps the clean-replay build fixture unavailable in GitHub Actions", () => {
    expect(canUseBuildReplayFixture({ CI: "true" })).toBe(true);
    expect(canUseBuildReplayFixture({ CI: "true", GITHUB_ACTIONS: "true" })).toBe(false);
    expect(canUseBuildReplayFixture({ CI: "false" })).toBe(false);
  });

  it("uses network-eligible events for the local clean-replay fixture", () => {
    expect(Object.values(BUILD_REPLAY_FIXTURE).flat().every(isNewsLikeEvent)).toBe(true);
  });

  it("rejects persisted replay fixtures in ordinary and GitHub Actions builds", () => {
    const root = mkdtempSync(join(tmpdir(), "release-gate-replay-"));
    try {
      cpSync("scripts/lib", join(root, "scripts/lib"), { recursive: true });
      const script = join(root, "scripts/build-network.mjs");
      cpSync("scripts/build-network.mjs", script);
      const build = (env: Record<string, string>) => spawnSync(process.execPath, [script], {
        cwd: root,
        env: { ...process.env, ...env },
        encoding: "utf8",
        timeout: 10_000,
      });
      const replay = build({ CI: "true", GITHUB_ACTIONS: "false" });
      expect(replay.status, replay.stderr).toBe(0);
      for (const env of [
        { CI: "false", GITHUB_ACTIONS: "false" },
        { CI: "true", GITHUB_ACTIONS: "true" },
      ]) {
        const result = build(env);
        expect.soft(result.status, JSON.stringify(env)).toBe(1);
        expect.soft(result.stderr).toContain("build-replay-fixture");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
