import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function snapshot(label: string, generatedAt: string) {
  const events = ["high", "low"].map((risk, i) => ({
    id: `${label}-${risk}`, title: `合成${label}${risk}事件`, summary: "僅供回歸測試，非真實案件。",
    region: "臺北市", timestamp: new Date().toISOString(), category: i ? "治安" : "反詐",
    scope: "domestic", riskLevel: risk, lat: 25.03, lng: 121.56,
    source: { name: `測試來源${i}`, type: "news-rss", fetchedAt: new Date().toISOString() },
  }));
  const network = JSON.stringify({
    snapshotId: label, generatedAt, rulesVersion: "fixture-v1",
    domestic: { nodes: [], edges: [], stats: {}, clusters: [{
      id: "c0", members: events.map((event) => event.id), size: 2, representativeTitle: `測試情報群${label}`,
      topCategory: "反詐", latestTs: generatedAt, sourceCount: 2,
    }] },
    international: { nodes: [], edges: [], clusters: [], stats: {} },
  });
  const bodies: Record<string, string> = {
    "domestic.json": JSON.stringify(events), "domestic.map.json": JSON.stringify(events),
    "international.json": "[]", "international.map.json": "[]", "network.json": network,
  };
  const manifest = {
    manifestVersion: 1, snapshotId: label, generatedAt, rulesVersion: "fixture-v1",
    scopes: {
      domestic: { events: "domestic.json", map: "domestic.map.json", network: "network.json" },
      international: { events: "international.json", map: "international.map.json", network: "network.json" },
    },
    files: Object.fromEntries(Object.entries(bodies).map(([path, body]) => [path, { path, sha256: sha(body), bytes: Buffer.byteLength(body) }])),
  };
  const summary = {
    domestic: `國內事件共 2 起。（AI 摘要暫時無法生成，事件資料仍可查閱；此為系統統計備援）`,
    international: `國際${label}摘要`, generatedAt, model: `current-${label}`,
    degraded: { domestic: true, international: false }, degradedReason: { domestic: "測試端點失敗" },
    clusterSummaries: {},
    lastSuccessful: {
      domestic: `國內${label}前期摘要`, international: `國際${label}摘要`, generatedAt: "2026-10-01T01:00:00Z", model: "old-model",
      scopeMetadata: { domestic: { generatedAt: "2026-10-01T01:00:00Z", model: "old-model" }, international: { generatedAt, model: `current-${label}` } },
      clusterSummaries: { c0: "不應出現在新情報群的舊摘要" },
    },
  };
  return { bodies, manifest, summary };
}

async function triggerRefresh(page: Page) {
  await page.evaluate(() => (window as unknown as { __summaryRefresh: () => void }).__summaryRefresh());
}

for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`${viewport.name}: delayed partial failure and repeated same-size refresh retain filters`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const original = window.setInterval.bind(window);
      window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        if (timeout === 300_000 && typeof handler === "function") {
          (window as unknown as { __summaryRefresh: () => void }).__summaryRefresh = () => handler(...args);
          return 0;
        }
        return original(handler, timeout, ...args);
      }) as typeof window.setInterval;
    });
    let current = snapshot("甲", "2026-10-30T10:00:00Z");
    let releaseFirst!: () => void;
    const firstSummary = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let summaryRequests = 0;
    const origin = new URL(testInfo.project.use.baseURL!).origin;
    await page.route(/^https:\/\//, (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.route("**/data/*.json", async (route) => {
      const file = new URL(route.request().url()).pathname.split("/").pop()!;
      const response = current;
      if (file === "summary.json") {
        summaryRequests++;
        if (summaryRequests === 1) await firstSummary;
        return route.fulfill({ json: response.summary });
      }
      if (file === "manifest.json") return route.fulfill({ json: response.manifest });
      if (response.bodies[file]) return route.fulfill({ body: response.bodies[file], contentType: "application/json" });
      return route.fulfill({ status: 404 });
    });
    await page.goto("/#scope=domestic", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#eventlist")).toContainText("合成甲high事件");
    await expect(page.locator("#topclusters")).toContainText("測試情報群甲");

    if (viewport.name === "mobile") await page.locator("#mobile-filter-trigger").click();
    await page.locator("#f-cat").selectOption("反詐");
    await page.locator("#f-risk").selectOption("high");
    await expect(page.locator("#eventlist")).not.toContainText("合成甲low事件");
    if (viewport.name === "mobile") {
      await page.locator("#filter-sheet-close").click();
      await page.locator('[data-mobile-view="insights"]').click();
    }
    releaseFirst();
    await expect(page.locator("#aibrief")).toContainText("國內甲前期摘要");
    await expect(page.locator("#aibrief")).toContainText("old-model");
    await expect(page.locator("#aibrief")).toContainText("目前篩選 (1 則)");
    await expect(page.locator("#aibrief")).not.toContainText("無符合事件");
    await expect(page.locator("#topclusters")).not.toContainText("不應出現在新情報群的舊摘要");

    for (const [label, generatedAt] of [["乙", "2026-10-30T11:00:00Z"], ["丙", "2026-10-30T12:00:00Z"]]) {
      current = snapshot(label, generatedAt);
      await triggerRefresh(page);
      await expect(page.locator("#topclusters")).toContainText(`測試情報群${label}`);
      await expect(page.locator("#aibrief")).toContainText(`國內${label}前期摘要`);
      await expect(page.locator("#aibrief")).toContainText("目前篩選 (1 則)");
      await expect(page.locator("#f-cat")).toHaveValue("反詐");
      await expect(page.locator("#f-risk")).toHaveValue("high");
      await expect(page.locator("#eventlist")).toContainText(`合成${label}high事件`);
      await expect(page.locator("#eventlist")).not.toContainText(`合成${label}low事件`);
      await expect(page.locator("#topclusters")).not.toContainText("不應出現在新情報群的舊摘要");
    }
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-summary-refresh.png`) });
  });
}
