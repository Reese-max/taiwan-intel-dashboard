import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("static/intel.html", () => {
  it("globe 詳情面板保留完整來源脈絡欄位", () => {
    const html = readFileSync("static/intel.html", "utf8");

    expect(html).toContain("sourceType");
    expect(html).toContain("sourceQuery");
    expect(html).toContain("recordRef");
    expect(html).toContain("完整脈絡");
    expect(html).toContain("資料集");
    expect(html).toContain("可重現查詢");
  });

  it("dev 與 production 都可用 /intel.html 開啟 globe 介面", () => {
    const buildScript = readFileSync("scripts/build-static.mjs", "utf8");
    const viteConfig = readFileSync("vite.config.ts", "utf8");

    expect(buildScript).toContain('copyFileSync("static/intel.html", `${OUT}/index.html`)');
    expect(buildScript).toContain('copyFileSync("static/intel.html", `${OUT}/intel.html`)');
    expect(viteConfig).toContain("configureServer");
    expect(viteConfig).toContain("/intel.html");
    expect(viteConfig).toContain("static/intel.html");
  });
});
