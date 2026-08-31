import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// @ts-expect-error — JS ESM module without types
import { DEFAULT_SOURCE_KEYS, createSourcePlan } from "../scripts/lib/source-plan.mjs";
// @ts-expect-error — JS ESM module without types
import { buildDomainCoverage } from "../scripts/domain-coverage.mjs";
// @ts-expect-error — JS ESM module without types
import {
  DIRECT_OFFICIAL_SOURCES,
  DIRECT_OFFICIAL_SOURCE_KEYS,
  fetchDirectOfficialSources,
} from "../scripts/lib/direct-official-sources.mjs";

describe("source plan", () => {
  it("keeps source selection and EXCLUSIVE policy outside the orchestrator", () => {
    const plan = createSourcePlan({
      argv: ["node", "fetch-live.mjs", "--sources= police, cwa,police ", "--exclusive"],
      env: { SOURCES: "rss", EXCLUSIVE: "0" },
    });

    expect(plan.sourceKeys).toEqual(["police", "cwa"]);
    expect(plan.wants("police")).toBe(true);
    expect(plan.wants("rss")).toBe(false);
    expect(plan.exclusive).toBe(true);
    expect(plan.dropStale({ skipped: true })).toBe(true);
    expect(plan.dropStale({ ok: false })).toBe(false);
  });

  it("has no retired MCP-only source in the default plan", () => {
    expect(DEFAULT_SOURCE_KEYS).not.toEqual(expect.arrayContaining([
      "pcc",
      "judicial",
      "moenvAir",
      "parkingHsinchu",
      "parkingTaoyuan",
      "economy",
    ]));
  });

  it("keeps npm refresh on the complete default source plan", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    const refresh = manifest.scripts.refresh;
    const plan = createSourcePlan({
      argv: ["node", "fetch-live.mjs", "--exclusive"],
      env: {},
    });

    expect(refresh).toBe("node --env-file=.env scripts/fetch-live.mjs --exclusive");
    expect(refresh).not.toContain("--sources=");
    expect(plan.sourceKeys).toEqual([...DEFAULT_SOURCE_KEYS]);
  });

  it("keeps pipeline attachments independent from hourly source selection", () => {
    const plan = createSourcePlan({
      argv: ["node", "fetch-live.mjs", "--sources=cwa,police,missing,twnews,rss,mofa,ncdr,mnd,cga,twcert,taipower,wra,wraRiver"],
      env: {},
    });
    const report = buildDomainCoverage({ enabledSourceKeys: plan.attachedSourceKeys });

    expect(plan.sourceKeys).not.toEqual(expect.arrayContaining(["cdc", "tfda"]));
    expect(plan.attachedSourceKeys).toEqual(DEFAULT_SOURCE_KEYS);
    expect(report.validation).toMatchObject({ ok: true, failures: [] });
    expect(report.rows.find((row: { key: string }) => row.key === "衛生／食安")?.enabledSourceCount).toBe(2);
  });
});

describe("direct official source registry", () => {
  it("keeps registry keys and execution status aligned", async () => {
    const messages: string[] = [];
    const sources = {
      ok: {
        label: "成功來源",
        fetch: async () => [{ source: { datasetId: "ok-dataset", fallbackFrom: "weekly" } }],
      },
      failed: { label: "失敗來源", fetch: async () => { throw new Error("offline"); } },
      skipped: { label: "略過來源", fetch: async () => [] },
    };

    const result = await fetchDirectOfficialSources({
      wants: (key: string) => key !== "skipped",
      sources,
      logger: {
        log: (message: string) => messages.push(message),
        error: (message: string) => messages.push(message),
      },
    });

    expect(result.freshByKey.ok).toHaveLength(1);
    expect(result.statusByKey.ok).toMatchObject({ ok: true, count: 1, datasetId: "ok-dataset" });
    expect(result.statusByKey.failed).toEqual({ ok: false, configured: true, error: "offline" });
    expect(result.statusByKey.skipped).toEqual({ skipped: true });
    expect(messages).toEqual(expect.arrayContaining([
      expect.stringContaining("成功來源：1 筆"),
      "失敗來源失敗：offline",
    ]));
  });

  it("uses one canonical production registry", () => {
    expect(DIRECT_OFFICIAL_SOURCE_KEYS).toEqual(Object.keys(DIRECT_OFFICIAL_SOURCES));
  });
});
