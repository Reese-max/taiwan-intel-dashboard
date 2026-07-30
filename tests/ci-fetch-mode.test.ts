import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FETCH_MODE_CHOICES,
  resolveFetchMode,
  writeGithubOutput,
} from "../scripts/ci-fetch-mode.mjs";

describe("resolveFetchMode", () => {
  it("maps hourly cron to CWA + police + missing + Taiwan news + international RSS", () => {
    const mode = resolveFetchMode({ schedule: "5 * * * *" });
    expect(mode.label).toBe("hourly");
    expect(mode.args).toBe("--sources=cwa,police,missing,twnews,rss,gdelt,mofa,ncdr,mnd,cga,twcert,taipower,wra,wraRiver,moenvAir,parkingHsinchu,parkingTaoyuan,economy");
    expect(mode.assertArgs).toBe("--require=cwa,cwaWarnings,international,police,twnews --min-international-feeds=10 --min-international-raw=50");
  });

  it("maps daily refresh cron to full exclusive refresh including CWA and international RSS", () => {
    const mode = resolveFetchMode({ schedule: "30 18 * * *" });
    expect(mode.label).toBe("refresh");
    expect(mode.args).toBe("--sources=cwa,pcc,police,missing,twnews,rss,gdelt,judicial,mofa,ncdr,mnd,cdc,tfda,cga,twcert,taipower,wra,wraRiver,moenvAir,parkingHsinchu,parkingTaoyuan,economy,agriPrices,healthFacilities,fireStats,legislature,tourismStat,socialPopulation,education,financeDerivatives,laborStats --exclusive");
    expect(mode.assertArgs).toBe("--require=cwa,cwaWarnings,international,pcc,police,judicial,twnews --min-international-feeds=10 --min-international-raw=50");
  });

  it("accepts explicit daily mode alias", () => {
    const mode = resolveFetchMode({ mode: "daily" });
    expect(mode.label).toBe("refresh");
    expect(mode.args).toContain("judicial");
    expect(mode.args).toContain("--exclusive");
  });

  it("supports a manual CWA-only mode with matching assertions", () => {
    const mode = resolveFetchMode({ mode: "cwa" });
    expect(mode.label).toBe("cwa");
    expect(mode.args).toBe("--sources=cwa");
    expect(mode.assertArgs).toBe("--require=cwa,cwaWarnings");
  });

  it("supports a manual international-only RSS mode with feed diversity assertions", () => {
    const mode = resolveFetchMode({ mode: "international" });
    expect(mode.label).toBe("international");
    expect(mode.args).toBe("--sources=rss,gdelt");
    expect(mode.assertArgs).toBe("--require=international --min-international-feeds=10 --min-international-raw=50");
    expect(mode.internationalFeedTier).toBe("expanded");
    expect(mode.internationalFeedTopic).toBe("all");
  });

  it("supports explicit expanded and core international tier modes", () => {
    const expanded = resolveFetchMode({ mode: "international-expanded" });
    expect(expanded.label).toBe("international");
    expect(expanded.internationalFeedTier).toBe("expanded");
    expect(expanded.assertArgs).toBe("--require=international --min-international-feeds=10 --min-international-raw=50");

    const core = resolveFetchMode({ mode: "international-core" });
    expect(core.label).toBe("international-core");
    expect(core.args).toBe("--sources=rss");
    expect(core.internationalFeedTier).toBe("core");
    expect(core.internationalFeedTopic).toBe("all");
    expect(core.assertArgs).toBe("--require=international --min-international-feeds=3 --min-international-raw=10");
  });

  it("supports manual international topic modes with topic-specific assertions", () => {
    const cyber = resolveFetchMode({ mode: "international-cyber" });
    expect(cyber.label).toBe("international-cyber");
    expect(cyber.args).toBe("--sources=rss,gdelt");
    expect(cyber.internationalFeedTier).toBe("expanded");
    expect(cyber.internationalFeedTopic).toBe("cyber");
    expect(cyber.assertArgs).toBe("--require=international --min-international-feeds=4 --min-international-raw=10");

    const finance = resolveFetchMode({ mode: "international-finance" });
    expect(finance.label).toBe("international-finance");
    expect(finance.internationalFeedTopic).toBe("finance");
    expect(finance.assertArgs).toBe("--require=international --min-international-feeds=1 --min-international-raw=3");

    const general = resolveFetchMode({ mode: "international-general" });
    expect(general.label).toBe("international-general");
    expect(general.internationalFeedTopic).toBe("general");
    expect(general.assertArgs).toBe("--require=international --min-international-feeds=10 --min-international-raw=50");

    const police = resolveFetchMode({ mode: "international-police" });
    expect(police.label).toBe("international-police");
    expect(police.internationalFeedTopic).toBe("police");
    expect(police.assertArgs).toBe("--require=international --min-international-feeds=7 --min-international-raw=20");
  });

  it("accepts rss as an alias for international-only mode", () => {
    const mode = resolveFetchMode({ mode: "rss" });
    expect(mode.label).toBe("international");
    expect(mode.args).toBe("--sources=rss,gdelt");
  });

  it("supports a manual CWA + international smoke mode", () => {
    const mode = resolveFetchMode({ mode: "cwa-international" });
    expect(mode.label).toBe("cwa-international");
    expect(mode.args).toBe("--sources=cwa,rss,gdelt");
    expect(mode.assertArgs).toBe("--require=cwa,cwaWarnings,international --min-international-feeds=10 --min-international-raw=50");
  });

  it("supports a manual Taiwan news mode with source-specific assertions", () => {
    const mode = resolveFetchMode({ mode: "twnews" });
    expect(mode.label).toBe("twnews");
    expect(mode.args).toBe("--sources=twnews,missing");
    expect(mode.assertArgs).toBe("--require=twnews");
  });

  it("keeps legacy manual police mode as hourly-compatible mode", () => {
    const mode = resolveFetchMode({ mode: "police" });
    expect(mode.label).toBe("hourly");
    expect(mode.args).toContain("cwa");
    expect(mode.args).toContain("rss");
  });

  it("accepts uppercase mode and preserves hourly behavior", () => {
    const mode = resolveFetchMode({ mode: "POLICE" });
    expect(mode.label).toBe("hourly");
    expect(mode.args).toContain("cwa");
  });

  it("maps manual refresh to full exclusive refresh", () => {
    const mode = resolveFetchMode({ mode: "refresh" });
    expect(mode.label).toBe("refresh");
    expect(mode.args).toContain("cwa");
    expect(mode.args).toContain("rss");
    expect(mode.args).toContain("--exclusive");
  });

  it("defaults to hourly mode when mode is empty and schedule is hourly", () => {
    const mode = resolveFetchMode({ mode: "", schedule: "5 * * * *" });
    expect(mode.label).toBe("hourly");
    expect(mode.args).toBe("--sources=cwa,police,missing,twnews,rss,gdelt,mofa,ncdr,mnd,cga,twcert,taipower,wra,wraRiver,moenvAir,parkingHsinchu,parkingTaoyuan,economy");
  });

  it("defaults to hourly mode when only schedule is missing", () => {
    const mode = resolveFetchMode({});
    expect(mode.label).toBe("hourly");
    expect(mode.args).toContain("cwa");
  });

  it("defaults unknown modes to hourly for backward-compatible safety", () => {
    const mode = resolveFetchMode({ mode: "legacy-only" });
    expect(mode.label).toBe("hourly");
  });

  it("prefers manual daily override when both schedule and mode are provided", () => {
    const mode = resolveFetchMode({ schedule: "5 * * * *", mode: "daily" });
    expect(mode.label).toBe("refresh");
    expect(mode.args).toContain("judicial");
    expect(mode.args).toContain("--exclusive");
  });

  it("keeps workflow_dispatch choices in sync with resolver choices", () => {
    const workflow = readFileSync(".github/workflows/update-and-deploy.yml", "utf8");
    const match = workflow.match(/options:\s*\[([^\]]+)\]/);
    expect(match?.[1]).toBeTruthy();
    const workflowChoices = match![1].split(",").map((s) => s.trim());
    expect(workflowChoices).toEqual(FETCH_MODE_CHOICES);
  });

  it("runs Taiwan news contribution audit as a CI warning step when twnews is fetched", () => {
    const workflow = readFileSync(".github/workflows/pipeline-fetch.yml", "utf8");
    expect(workflow).toContain("if: contains(steps.mode.outputs.args, 'twnews')");
    expect(workflow).toContain("npm run audit:news-source-contribution");
  });

  it("wires the existing NVIDIA credentials into the primary LLM fallback", () => {
    const workflow = readFileSync(".github/workflows/pipeline-fetch.yml", "utf8");
    expect(workflow).toContain("LLM_FALLBACK_API_KEY: ${{ secrets.NVIDIA_API_KEY }}");
    expect(workflow).toContain("LLM_FALLBACK_BASE_URL: ${{ secrets.NVIDIA_BASE_URL }}");
    expect(workflow).toContain("LLM_FALLBACK_MODEL: ${{ secrets.NVIDIA_MODEL }}");
  });

  it("gates source freshness and the generated coverage matrix before deploy", () => {
    const workflow = readFileSync(".github/workflows/pipeline-audit.yml", "utf8");
    expect(workflow).toContain("npm run audit:source-freshness");
    expect(workflow).toContain("npm run audit:coverage");
  });

  it("keeps the pipeline dry run manual, read-only, full-source, and deployment-free", () => {
    const workflow = readFileSync(".github/workflows/pipeline-dry-run.yml", "utf8");

    expect(workflow).toMatch(/on:\r?\n  workflow_dispatch:/);
    expect(workflow).not.toMatch(/^  (?:schedule|push|pull_request):/m);
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toContain("contents: write");
    expect(workflow).toContain("uses: ./.github/workflows/pipeline-fetch.yml");
    expect(workflow).toContain("uses: ./.github/workflows/pipeline-audit.yml");
    expect(workflow).toContain("mode: refresh");
    expect(workflow).toContain("publish_dist: false");

    for (const deployCommand of [
      "peaceiris/actions-gh-pages",
      "cloudflare/wrangler-action",
      "pages deploy",
      "git push",
      "smoke-deployed.mjs",
    ]) {
      expect(workflow).not.toContain(deployCommand);
    }
  });

  it("separates fetch, state persistence, audit, and deploy", () => {
    const workflow = readFileSync(".github/workflows/update-and-deploy.yml", "utf8");
    const fetchWorkflow = readFileSync(".github/workflows/pipeline-fetch.yml", "utf8");
    const auditWorkflow = readFileSync(".github/workflows/pipeline-audit.yml", "utf8");
    const state = workflow.match(/^  save-state:\r?\n[\s\S]*?(?=^  audit:)/m)?.[0] ?? "";
    const audit = workflow.match(/^  audit:\r?\n[\s\S]*?(?=^  deploy:)/m)?.[0] ?? "";
    const deploy = workflow.match(/^  deploy:\r?\n[\s\S]*?(?=^  notify:)/m)?.[0] ?? "";

    expect(workflow).toContain("uses: ./.github/workflows/pipeline-fetch.yml");
    expect(state).toContain("needs: fetch");
    expect(state).toContain("contents: write");
    expect(state).toContain("publish_branch: pipeline-state");
    expect(audit).toContain("needs: fetch");
    expect(audit).toContain("contents: read");
    expect(audit).toContain("uses: ./.github/workflows/pipeline-audit.yml");
    expect(deploy).toContain("needs: [fetch, save-state, audit]");
    expect(deploy).toContain("needs.save-state.result == 'success'");
    expect(deploy).toContain("needs.audit.result == 'success'");
    expect(fetchWorkflow).not.toContain("contents: write");
    expect(auditWorkflow).not.toContain("contents: write");
  });

  it("writes GitHub output for label, fetch args, and assertion args", () => {
    const dir = mkdtempSync(join(tmpdir(), "ci-fetch-mode-"));
    const out = join(dir, "output");
    try {
      writeGithubOutput(resolveFetchMode({ mode: "international" }), out);
      expect(readFileSync(out, "utf8")).toBe(
        [
          "label=international",
          "args=--sources=rss,gdelt",
          "assert_args=--require=international --min-international-feeds=10 --min-international-raw=50",
          "international_feed_tier=expanded",
          "international_feed_topic=all",
          "",
        ].join("\n"),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
