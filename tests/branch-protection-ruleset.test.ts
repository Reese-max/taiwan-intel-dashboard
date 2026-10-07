import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join, delimiter } from "node:path";
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

  it("release-gate.md requires the downstream deployed-preview check", () => {
    const releaseGatePath = resolve(REPO_ROOT, "docs/operations/release-gate.md");
    const content = readFileSync(releaseGatePath, "utf8");
    // Should mention build-preview as required check
    expect(content).toContain("build-preview");
    // The artifact build is upstream; only check verifies a deployed preview.
    expect(content).toMatch(/`test` 與 `check`/);
    expect(content).toContain("Verify Preview");
  });
});

function protectionFixture() {
  return ["main","production"].map((branch,index)=>({id:index+1,name:`protect-${branch}`,target:"branch",enforcement:"active",conditions:{ref_name:{include:[`refs/heads/${branch}`],exclude:[]}},bypass_actors:[],rules:[
    {type:"deletion"},{type:"non_fast_forward"},
    {type:"pull_request",parameters:{required_approving_review_count:1,require_code_owner_review:true,dismiss_stale_reviews_on_push:true,require_last_push_approval:true,required_review_thread_resolution:true}},
    {type:"required_status_checks",parameters:{strict_required_status_checks_policy:true,required_status_checks:[{context:"test"},{context:"check"},{context:"build-preview"}]}}
  ]}));
}

function runValidator(fixtures:ReturnType<typeof protectionFixture>) {
  const directory=mkdtempSync(join(tmpdir(),"taiwan-ruleset-cli-"));
  try {
    const file=join(directory,"fixtures.json");writeFileSync(file,JSON.stringify(fixtures));
    const gh=join(directory,"gh");writeFileSync(gh,`#!/usr/bin/env node\nconst fs=require('node:fs');const values=JSON.parse(fs.readFileSync(process.env.SYNTHETIC_RULESETS_FILE,'utf8'));const endpoint=process.argv.at(-1);process.stdout.write(JSON.stringify(endpoint.endsWith('/rulesets')?values.map(({id,name})=>({id,name})):values.find(value=>String(value.id)===endpoint.split('/').at(-1))));\n`);chmodSync(gh,0o755);
    return spawnSync(process.execPath,[resolve(REPO_ROOT,"scripts/validate-ruleset.mjs")],{encoding:"utf8",env:{...process.env,PATH:directory+delimiter+process.env.PATH,SYNTHETIC_RULESETS_FILE:file}});
  } finally {rmSync(directory,{recursive:true,force:true});}
}

describe("Actual validator CLI against synthetic GitHub rulesets",()=>{
  it("requires the downstream deployed-preview check job",()=>{
    const fixtures=protectionFixture();fixtures[0].rules[3].parameters!.required_status_checks=[{context:"test"},{context:"build-preview"}];
    expect(runValidator(fixtures).status).toBe(1);
  });
  it("accepts the complete active policy with verified-preview check",()=>{const fixtures=protectionFixture();for(const rule of fixtures)rule.rules[3].parameters!.required_status_checks=[{context:"test"},{context:"check"}];expect(runValidator(fixtures).status).toBe(0);});
  for(const mutation of ["disabled","zero-approvals","missing-deletion","missing-nonfastforward","review-flags-off","non-strict-checks","excluded-branch","always-bypass"]){
    it(`rejects ${mutation} despite present check names`,()=>{
      const fixtures=protectionFixture();const bad=fixtures[0];
      // The old validator accepts build-preview, so preserve its otherwise-valid names in the negative controls.
      bad.rules[3].parameters!.required_status_checks=[{context:"test"},{context:"check"},{context:"build-preview"}];
      if(mutation==="disabled")bad.enforcement="disabled";
      if(mutation==="zero-approvals")bad.rules[2].parameters!.required_approving_review_count=0;
      if(mutation==="missing-deletion")bad.rules=bad.rules.filter(rule=>rule.type!=="deletion");
      if(mutation==="missing-nonfastforward")bad.rules=bad.rules.filter(rule=>rule.type!=="non_fast_forward");
      if(mutation==="review-flags-off")for(const key of ["require_code_owner_review","dismiss_stale_reviews_on_push","require_last_push_approval","required_review_thread_resolution"])bad.rules[2].parameters![key]=false;
      if(mutation==="non-strict-checks")bad.rules[3].parameters!.strict_required_status_checks_policy=false;
      if(mutation==="excluded-branch")bad.conditions.ref_name.exclude=["refs/heads/main"];
      if(mutation==="always-bypass")bad.bypass_actors=[{actor_id:5,actor_type:"RepositoryRole",bypass_mode:"always"}];
      expect(runValidator(fixtures).status).toBe(1);
    });
  }
});
