import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";

function cohort(snapshotId: string) {
  const now = new Date().toISOString();
  const events = JSON.stringify(["center", "neighbor"].map((id, i) => ({
    id, title: `${snapshotId}-${id}`, summary: "合成回歸測試", region: "臺北市", timestamp: now,
    category: "治安", scope: "domestic", riskLevel: "high", lat: 25.03 - i, lng: 121.56 - i,
    locationPrecision: "city",
    source: { name: id, publisherName: id, type: "news-rss", url: `https://example.test/${id}`, fetchedAt: now },
  })));
  const network = JSON.stringify({
    snapshotId, generatedAt: now, rulesVersion: "correlate-v1",
    domestic: {
      nodes: [], edges: [{ a: "center", b: "neighbor", type: "same-entity", weight: 1, why: snapshotId }],
      clusters: [], stats: {},
    },
    international: { nodes: [], edges: [], clusters: [], stats: {} },
  });
  const bodies = { "domestic.json": events, "domestic.map.json": events, "international.json": "[]", "international.map.json": "[]", "network.json": network };
  const manifest = {
    manifestVersion: 1, snapshotId, generatedAt: now, rulesVersion: "correlate-v1",
    scopes: {
      domestic: { events: "domestic.json", map: "domestic.map.json", network: "network.json" },
      international: { events: "international.json", map: "international.map.json", network: "network.json" },
    },
    files: Object.fromEntries(Object.entries(bodies).map(([path, body]) => [path, {
      path, sha256: createHash("sha256").update(body).digest("hex"), bytes: Buffer.byteLength(body),
    }])),
  };
  return { manifest, events, network };
}

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\//, (route) => route.abort());
});

test("手動重試新版關聯時也必須更新事件快照", async ({ page }) => {
  let current = cohort("s1");
  let eventRequests = 0;
  await page.route("**/data/*.json", (route) => {
    const file = new URL(route.request().url()).pathname.split("/").pop();
    if (file === "manifest.json") return route.fulfill({ json: current.manifest });
    if (file === "domestic.json") {
      eventRequests++;
      return route.fulfill({ body: current.events, contentType: "application/json" });
    }
    if (file === "network.json") return current.manifest.snapshotId === "s1"
      ? route.fulfill({ status: 503 })
      : route.fulfill({ body: current.network, contentType: "application/json" });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/#scope=domestic&focus=center", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#eventlist")).toContainText("s1-center");
  await expect(page.locator("#retry-network-btn")).toBeVisible();
  current = cohort("s2");
  await page.locator("#retry-network-btn").click();
  await expect(page.locator("#relation-notice")).toBeHidden();
  await expect(page.locator("#eventlist")).toContainText("s2-center");
  expect(eventRequests).toBe(2);
});

test("新版事件驗證失敗後不得用新版關聯搭配舊版事件", async ({ page }) => {
  const s1 = cohort("s1");
  const s2 = cohort("s2");
  let manifests = 0;
  let networks = 0;
  await page.route("**/data/*.json", (route) => {
    const file = new URL(route.request().url()).pathname.split("/").pop();
    if (file === "manifest.json") return route.fulfill({ json: ++manifests === 1 ? s1.manifest : s2.manifest });
    // S2 manifest 已出現，但 CDN 仍回 S1 事件；network 則已是 S2。
    if (file === "domestic.json") return route.fulfill({ body: s1.events, contentType: "application/json" });
    if (file === "network.json") {
      networks++;
      return route.fulfill({ body: s2.network, contentType: "application/json" });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto("/#scope=domestic&focus=center", { waitUntil: "domcontentloaded" });
  await expect.poll(() => networks).toBe(3);
  await expect(page.locator("#eventlist")).toContainText("s1-center");
  await expect(page.locator("#relation-notice")).toBeVisible();
  await expect(page.locator("#eventlist")).not.toContainText("s1-neighbor");
  expect(manifests).toBe(2);
});

test("manifest 無法載入時只顯示獨立新聞且停用關聯", async ({ page }) => {
  const data = cohort("unverified");
  await page.route("**/data/*.json", (route) => {
    const file = new URL(route.request().url()).pathname.split("/").pop();
    if (file === "domestic.json") return route.fulfill({ body: data.events, contentType: "application/json" });
    if (file === "network.json") return route.fulfill({ body: data.network, contentType: "application/json" });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/#scope=domestic&focus=center", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#eventlist")).toContainText("unverified-center");
  await expect(page.locator("#relation-notice")).toBeVisible();
  await expect(page.locator("#eventlist")).not.toContainText("unverified-neighbor");
});

for (const failedArtifact of ["events", "network"]) {
  test(`手動重試後 ${failedArtifact} 持續異版時保留可用新聞並停用關聯`, async ({ page }) => {
    const s1 = cohort("s1");
    const s2 = cohort("s2");
    let retried = false;
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.route("**/data/*.json", (route) => {
      const file = new URL(route.request().url()).pathname.split("/").pop();
      if (file === "manifest.json") return route.fulfill({ json: retried ? s2.manifest : s1.manifest });
      if (file === "domestic.json") return route.fulfill({
        body: retried && failedArtifact !== "events" ? s2.events : s1.events, contentType: "application/json",
      });
      if (file === "network.json") return retried
        ? route.fulfill({ body: failedArtifact === "network" ? s1.network : s2.network, contentType: "application/json" })
        : route.fulfill({ status: 503 });
      return route.fulfill({ status: 404 });
    });
    await page.goto("/#scope=domestic&focus=center", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#retry-network-btn")).toBeVisible();
    retried = true;
    await page.locator("#retry-network-btn").click();
    await expect(page.locator("#relation-notice")).toContainText(failedArtifact === "events" ? "事件快照更新失敗" : "不符");
    await expect(page.locator("#eventlist")).toContainText(failedArtifact === "events" ? "s1-center" : "s2-center");
    await expect(page.locator("#eventlist")).not.toContainText("neighbor");
    await page.locator("#f-range").selectOption("");
    await expect(page.locator("#relation-notice")).toContainText(failedArtifact === "events" ? "事件快照更新失敗" : "不符");
    expect(pageErrors).toEqual([]);
  });
}

for (const missingFile of ["domestic.json", "network.json"]) {
  test(`manifest 缺少 ${missingFile} hash 時前端拒絕晉級`, async ({ page }) => {
    const data = cohort("s1");
    delete data.manifest.files[missingFile];
    await page.route("**/data/*.json", (route) => {
      const file = new URL(route.request().url()).pathname.split("/").pop();
      if (file === "manifest.json") return route.fulfill({ json: data.manifest });
      if (file === "domestic.json") return route.fulfill({ body: data.events, contentType: "application/json" });
      if (file === "network.json") return route.fulfill({ body: data.network, contentType: "application/json" });
      return route.fulfill({ status: 404 });
    });
    await page.goto("/#scope=domestic&focus=center", { waitUntil: "domcontentloaded" });
    if (missingFile === "domestic.json") {
      await expect(page.locator("#eventlist .load-error")).toContainText("SHA-256");
      await expect(page.locator('#eventlist [data-id="center"]')).toHaveCount(0);
    } else {
      await expect(page.locator("#eventlist")).toContainText("s1-center");
      await expect(page.locator("#relation-notice")).toContainText("SHA-256");
      await expect(page.locator("#eventlist")).not.toContainText("s1-neighbor");
    }
  });
}

test("切換 scope 後舊重試失敗不能覆蓋目前清單", async ({ page }) => {
  const s1 = cohort("s1");
  const s2 = cohort("s2");
  let manifests = 0;
  let eventRequests = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/data/*.json", async (route) => {
    const file = new URL(route.request().url()).pathname.split("/").pop();
    if (file === "manifest.json") return route.fulfill({ json: ++manifests === 1 ? s1.manifest : s2.manifest });
    if (file === "domestic.json") {
      if (++eventRequests === 2) await pending;
      return route.fulfill({ body: "[]", contentType: "application/json" }); // 兩次事件 hash 都不符
    }
    if (file === "international.json") return route.fulfill({ json: [] });
    if (file === "network.json") return route.fulfill({ body: s2.network, contentType: "application/json" });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect.poll(() => eventRequests).toBe(2);
  await page.locator('button[data-scope="international"]').click();
  await expect(page.locator("#count")).toContainText("0 則");
  const before = await page.locator("#eventlist").textContent();
  const response = page.waitForResponse("**/data/domestic.json");
  release();
  await (await response).finished();
  await page.waitForTimeout(200); // 讓失敗 response 的 digest/rejection 回到舊 refresh
  await expect(page.locator("#eventlist")).toHaveText(before!);
  await expect(page.locator("#eventlist .load-error")).toHaveCount(0);
});
