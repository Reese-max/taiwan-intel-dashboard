import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprintEvent } from "../scripts/lib/curation-ledger.mjs";
import { buildNetwork } from "../scripts/build-network.mjs";
import { RULES_VERSION } from "../scripts/lib/manifest.mjs";

describe("static build asset cache busting", () => {
  it("[PR68 regression] built UI snapshots replay valid location corrections without rewriting sources", () => {
    const root = mkdtempSync(join(tmpdir(), "pr68-static-"));
    try {
      for (const dir of ["src", "static"]) cpSync(dir, join(root, dir), { recursive: true });
      symlinkSync(resolve("node_modules"), join(root, "node_modules"), "junction");
      mkdirSync(join(root, "public/data"), { recursive: true });
      mkdirSync(join(root, "docs/curation"), { recursive: true });
      const patch = { region: "高雄市", lat: 22.63, lng: 120.3, locationRole: "agency", locationPrecision: "exact" };
      const sources: Record<string, any[]> = {};
      const records: any[] = [];
      for (const scope of ["domestic", "international"]) {
        const prefix = scope === "domestic" ? "twnews" : "intl";
        const events = ["valid", "stale", "government"].map((kind) => ({
          id: `${prefix}-${kind}`, scope, title: kind, summary: "人工核對的摘要", region: "臺北市",
          timestamp: "2026-09-30T00:00:00Z", category: "治安", riskLevel: "low",
          source: { name: "測試來源", type: kind === "government" ? "gov-open-data" : "news-rss" },
        }));
        records.push(...events.map((e) => ({
          id: `cur-${e.id}`, schemaVersion: 1, decision: "location_correction", subjects: [e.id],
          expect: { [e.id]: e.title === "stale" ? "0".repeat(64) : fingerprintEvent(e) },
          patch, reason: "修正定位", evidence: "https://example.invalid/review", reviewedAt: "2026-09-30T00:00:00Z", rulesVersion: RULES_VERSION,
        })));
        sources[scope] = events;
        writeFileSync(join(root, `public/data/${scope}.json`), JSON.stringify(events));
        writeFileSync(join(root, `public/data/${scope}.map.json`), JSON.stringify([{ id: "old-map-point", lat: 25, lng: 121 }]));
      }
      writeFileSync(join(root, "docs/curation/correlation-overrides.jsonl"), records.map((r) => JSON.stringify(r)).join("\n"));
      const network = buildNetwork(sources.domestic, sources.international, "2026-09-30T00:00:00Z", { curation: records });
      writeFileSync(join(root, "public/data/network.json"), JSON.stringify(network));
      const result = spawnSync(process.execPath, [resolve("scripts/build-static.mjs")], { cwd: root, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      for (const scope of ["domestic", "international"]) {
        const built = JSON.parse(readFileSync(join(root, `dist/data/${scope}.json`), "utf8"));
        const points = JSON.parse(readFileSync(join(root, `dist/data/${scope}.map.json`), "utf8"));
        expect(built[0]).toMatchObject(patch);
        expect(points).toEqual([expect.objectContaining({ id: built[0].id, ...patch })]);
        expect(built.slice(1).every((e: any) => e.region === "臺北市" && e.lat === undefined)).toBe(true);
        expect(readFileSync(join(root, `public/data/${scope}.json`), "utf8")).toBe(JSON.stringify(sources[scope]));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("首頁固定檔名資產應帶內容雜湊版本，避免部署後沿用舊 JS", () => {
    const buildScript = readFileSync("scripts/build-static.mjs", "utf8");

    expect(buildScript).toContain('import { createHash } from "node:crypto"');
    expect(buildScript).toContain("function assetVersion(name)");
    expect(buildScript).toContain('./assets/main.css?v=${assetVersion("main.css")}');
    expect(buildScript).toContain('./assets/main.js?v=${assetVersion("main.js")}');
    expect(buildScript).toMatch(/writeFileSync\(\r?\n\s+`\$\{OUT\}\/404\.html`/);
    expect(buildScript).not.toContain("src/query.ts");
    expect(buildScript).not.toContain("query.html");
  });

  it("拒絕將 BUILD_STATIC_OUT 指向來源目錄，且不清空既有檔案", () => {
    const sourceFile = "static/intel.html";
    const before = readFileSync(sourceFile, "utf8");
    const result = spawnSync(process.execPath, ["scripts/build-static.mjs"], {
      encoding: "utf8",
      env: { ...process.env, BUILD_STATIC_OUT: "static" },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("BUILD_STATIC_OUT 只能指定專用產物目錄 dist");
    expect(readFileSync(sourceFile, "utf8")).toBe(before);
  });
});
