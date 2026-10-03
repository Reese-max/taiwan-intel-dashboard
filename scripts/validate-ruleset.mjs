#!/usr/bin/env node
// Validates that the required branch protection rulesets exist on GitHub

import { execSync } from "node:child_process";

const REPO = "Reese-max/taiwan-intel-dashboard";
const REQUIRED_RULESETS = [
  { name: "protect-main", branch: "refs/heads/main" },
  { name: "protect-production", branch: "refs/heads/production" },
];
const REQUIRED_CHECKS = ["test", "build-preview"];

function runGhApi(endpoint) {
  try {
    const output = execSync(`gh api "${endpoint}"`, { encoding: "utf8" });
    return JSON.parse(output);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

function getRulesetIdByName(name) {
  const rulesets = runGhApi(`repos/${REPO}/rulesets`);
  if (!rulesets) return null;
  const found = rulesets.find((r) => r.name === name);
  return found?.id || null;
}

function validateRuleset(rulesetConfig) {
  console.log(`\nValidating ruleset: ${rulesetConfig.name} for ${rulesetConfig.branch}`);
  const rulesetId = getRulesetIdByName(rulesetConfig.name);
  if (!rulesetId) {
    console.error(`❌ Ruleset "${rulesetConfig.name}" not found`);
    return { valid: false, reason: `Ruleset "${rulesetConfig.name}" not found` };
  }

  const ruleset = runGhApi(`repos/${REPO}/rulesets/${rulesetId}`);
  if (!ruleset) {
    console.error(`❌ Failed to fetch ruleset ${rulesetConfig.name}`);
    return { valid: false, reason: `Failed to fetch ruleset ${rulesetConfig.name}` };
  }

  console.log(`✅ Found ruleset: ${ruleset.name} (ID: ${rulesetId})`);

  // Check target branch
  const conditions = ruleset.conditions || {};
  const refName = conditions.ref_name || {};
  const includeBranches = refName.include || [];
  if (!includeBranches.includes(rulesetConfig.branch)) {
    console.error(`❌ Ruleset does not target ${rulesetConfig.branch}`);
    return { valid: false, reason: `Ruleset does not target ${rulesetConfig.branch}` };
  }
  console.log(`✅ Ruleset targets ${rulesetConfig.branch}`);

  // Check required status checks
  const rules = ruleset.rules || [];
  const statusCheckRule = rules.find((r) => r.type === "required_status_checks");
  if (!statusCheckRule) {
    console.error("❌ No required_status_checks rule found");
    return { valid: false, reason: "No required_status_checks rule" };
  }

  const requiredChecks = statusCheckRule.parameters?.required_status_checks?.map((c) => c.context) || [];
  console.log("Required checks in ruleset:", requiredChecks);

  const missingChecks = REQUIRED_CHECKS.filter((c) => !requiredChecks.includes(c));
  if (missingChecks.length > 0) {
    console.error("❌ Missing required checks:", missingChecks);
    return { valid: false, reason: `Missing required checks: ${missingChecks.join(", ")}` };
  }
  console.log("✅ All required checks present");

  // Check PR requirements
  const prRule = rules.find((r) => r.type === "pull_request");
  if (!prRule) {
    console.error("❌ No pull_request rule found");
    return { valid: false, reason: "No pull_request rule" };
  }
  console.log("✅ Pull request requirements configured");

  // Check bypass actors for break-glass
  const bypassActors = ruleset.bypass_actors || [];
  console.log("Bypass actors:", bypassActors.length > 0 ? bypassActors : "none");

  return { valid: true, ruleset };
}

function validateAll() {
  console.log("Fetching repository rulesets...");
  const rulesets = runGhApi(`repos/${REPO}/rulesets`);
  console.log("Available rulesets:", rulesets?.map((r) => r.name).join(", ") || "none");

  const results = REQUIRED_RULESETS.map((config) => ({
    ...config,
    ...validateRuleset(config),
  }));

  const allValid = results.every((r) => r.valid);
  if (!allValid) {
    const failures = results.filter((r) => !r.valid).map((r) => `${r.name}: ${r.reason}`);
    console.error("\nVALIDATION FAILED:");
    failures.forEach((f) => console.error(`  - ${f}`));
    return false;
  }

  console.log("\n✅ ALL VALIDATIONS PASSED");
  return true;
}

const success = validateAll();
process.exit(success ? 0 : 1);