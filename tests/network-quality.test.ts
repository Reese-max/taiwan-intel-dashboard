import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { networkQualityWarnings } from "../scripts/lib/network-quality.mjs";

describe("networkQualityWarnings", () => {
  it("warns when a scope's largest cluster exceeds the threshold", () => {
    const warnings = networkQualityWarnings(
      {
        domestic: { stats: { events: 1200, largestCluster: 601, clusters: 40 } },
        international: { stats: { events: 80, largestCluster: 12, clusters: 6 } },
      },
      { maxLargestCluster: 500 },
    );

    expect(warnings).toEqual([
      {
        scope: "domestic",
        largestCluster: 601,
        threshold: 500,
        events: 1200,
        clusters: 40,
      },
    ]);
  });

  it("does not warn when largest clusters stay below the threshold", () => {
    const warnings = networkQualityWarnings(
      {
        domestic: { stats: { events: 1200, largestCluster: 202, clusters: 1000 } },
      },
      { maxLargestCluster: 500 },
    );

    expect(warnings).toEqual([]);
  });

  it("exposes package and CI hooks for network quality audit", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const workflow = readFileSync(new URL("../.github/workflows/update-and-deploy.yml", import.meta.url), "utf8");

    expect(pkg.scripts["audit:network-quality"]).toBe("node scripts/audit-network-quality.mjs");
    expect(workflow).toContain("npm run audit:network-quality");
  });
});
