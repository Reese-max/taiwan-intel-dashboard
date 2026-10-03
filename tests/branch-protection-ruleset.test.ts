import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..");

describe("Branch protection ruleset validation", () => {
  it("PR check workflow exists and has test job", () => {
    const prCheckPath = resolve(REPO_ROOT, ".github/workflows/pr-check.yml");
    const content = readFileSync(prCheckPath, "utf8");
    expect(content).toContain("name: PR 檢查");
    expect(content).toContain("jobs:");
    expect(content).toContain("  test:");
  });

  it("Deploy workflow exists and has build-preview job", () => {
    const deployPath = resolve(REPO_ROOT, ".github/workflows/deploy.yml");
    const content = readFileSync(deployPath, "utf8");
    expect(content).toContain("name: Deploy");
    expect(content).toContain("jobs:");
    expect(content).toContain("  build-preview:");
  });

  it("Required check names match workflow job names", () => {
    const prCheckPath = resolve(REPO_ROOT, ".github/workflows/pr-check.yml");
    const deployPath = resolve(REPO_ROOT, ".github/workflows/deploy.yml");
    const prCheckContent = readFileSync(prCheckPath, "utf8");
    const deployContent = readFileSync(deployPath, "utf8");

    // PR 檢查 / test
    expect(prCheckContent).toMatch(/name:\s*PR 檢查/);
    expect(prCheckContent).toMatch(/jobs:\s*\n\s*test:/);

    // Deploy / build-preview
    expect(deployContent).toMatch(/name:\s*Deploy/);
    expect(deployContent).toMatch(/jobs:\s*\n\s*build-preview:/);
  });

  it("PR check workflow runs on pull_request to main and production", () => {
    const prCheckPath = resolve(REPO_ROOT, ".github/workflows/pr-check.yml");
    const content = readFileSync(prCheckPath, "utf8");
    expect(content).toContain("pull_request:");
    expect(content).toContain("branches: [main, production]");
  });

  it("Deploy workflow runs on pull_request to main and production", () => {
    const deployPath = resolve(REPO_ROOT, ".github/workflows/deploy.yml");
    const content = readFileSync(deployPath, "utf8");
    expect(content).toContain("pull_request:");
    expect(content).toContain("branches: [main, production]");
  });

  it("release-gate.md documents build-preview as required check (not check)", () => {
    const releaseGatePath = resolve(REPO_ROOT, "docs/operations/release-gate.md");
    const content = readFileSync(releaseGatePath, "utf8");
    // Should mention build-preview as required check
    expect(content).toContain("build-preview");
    // Should mention the correct required checks: test and build-preview
    expect(content).toMatch(/test.*build-preview|build-preview.*test/);
    // Should NOT mention the old 'check' job as a required status check
    expect(content).not.toMatch(/要求.*test.*check[^a-z]/i);
  });
});