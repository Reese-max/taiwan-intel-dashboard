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

  it("儀表板為首頁，globe 介面移至 /globe.html（/intel.html 保留別名，dev/prod 皆可開）", () => {
    const buildScript = readFileSync("scripts/build-static.mjs", "utf8");
    const viteConfig = readFileSync("vite.config.ts", "utf8");

    // 首頁＝美化後的儀表板
    expect(buildScript).toContain("writeFileSync(`${OUT}/index.html`, dashboardHtml)");
    // globe 介面移至 globe.html，intel.html 保留為別名
    expect(buildScript).toContain('copyFileSync("static/intel.html", `${OUT}/globe.html`)');
    expect(buildScript).toContain('copyFileSync("static/intel.html", `${OUT}/intel.html`)');
    expect(viteConfig).toContain("configureServer");
    expect(viteConfig).toContain("/intel.html");
    expect(viteConfig).toContain("static/intel.html");
  });

  it("世界地圖提供分析工具型關聯線控制", () => {
    const html = readFileSync("static/intel.html", "utf8");

    expect(html).toContain('id="net-controls"');
    expect(html).toContain('data-arc-type="same-incident"');
    expect(html).toContain('data-arc-type="same-entity"');
    expect(html).toContain('data-arc-type="same-topic"');
    expect(html).toContain('id="toggle-weak-arcs"');
    expect(html).toContain('id="arc-strength"');
    expect(html).toContain("同題情勢（弱關聯）");
    expect(html).toContain("function visibleNetworkArcs()");
    expect(html).toContain("function toggleArcType(type)");
    expect(html).toContain("function setShowWeakArcs(checked)");
    expect(html).toContain("function setArcMinWeight(value)");
    expect(html).toContain("g.arcsData(visibleNetworkArcs())");
  });

  it("世界地圖城市聚合點點擊後會開啟可讀詳情", () => {
    const html = readFileSync("static/intel.html", "utf8");

    expect(html).toContain("function clusterDetailHtml(c)");
    expect(html).toContain("城市聚合");
    expect(html).toContain("點下列單筆情報查看完整來源脈絡");
    expect(html).toContain("document.getElementById('detail-panel').classList.add('show')");
  });
});
