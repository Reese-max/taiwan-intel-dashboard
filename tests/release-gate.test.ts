import { readFileSync } from "node:fs";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { BUILD_REPLAY_FIXTURE, canUseBuildReplayFixture } from "../scripts/build-network.mjs";
import { isNewsLikeEvent } from "../scripts/lib/correlate.mjs";

const deployWorkflow = YAML.parse(readFileSync(".github/workflows/deploy.yml", "utf8"));
const refreshWorkflow = YAML.parse(readFileSync(".github/workflows/update-and-deploy.yml", "utf8"));
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

  it("keeps the clean-replay build fixture unavailable in GitHub Actions", () => {
    expect(canUseBuildReplayFixture({ CI: "true" })).toBe(true);
    expect(canUseBuildReplayFixture({ CI: "true", GITHUB_ACTIONS: "true" })).toBe(false);
    expect(canUseBuildReplayFixture({ CI: "false" })).toBe(false);
  });

  it("uses network-eligible events for the local clean-replay fixture", () => {
    expect(Object.values(BUILD_REPLAY_FIXTURE).flat().every(isNewsLikeEvent)).toBe(true);
  });
});
