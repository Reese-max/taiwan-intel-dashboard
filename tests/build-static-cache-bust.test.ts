import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("static build asset cache busting", () => {
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
