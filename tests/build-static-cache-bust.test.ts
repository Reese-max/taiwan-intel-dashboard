import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("static build asset cache busting", () => {
  it("首頁與查詢頁的固定檔名資產應帶內容雜湊版本，避免部署後沿用舊 JS", () => {
    const buildScript = readFileSync("scripts/build-static.mjs", "utf8");

    expect(buildScript).toContain('import { createHash } from "node:crypto"');
    expect(buildScript).toContain("function assetVersion(name)");
    expect(buildScript).toContain('./assets/main.css?v=${assetVersion("main.css")}');
    expect(buildScript).toContain('./assets/main.js?v=${assetVersion("main.js")}');
    expect(buildScript).toContain('./assets/query.css?v=${assetVersion("query.css")}');
    expect(buildScript).toContain('./assets/query.js?v=${assetVersion("query.js")}');
  });
});
