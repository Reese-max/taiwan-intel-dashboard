import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";

test.use({ viewport: { width: 1440, height: 900 } });

// Head first-paint also fills #count; only full data removes the loading label.
async function waitForFullData(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.locator("#count")).not.toHaveText("", { timeout: 30_000 });
  await expect(page.locator("#count")).not.toContainText(/載入中/, { timeout: 30_000 });
}

async function waitForInternationalData(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.locator("#filter-summary .filter-chip.is-base")).toHaveText(/國際/);
  await waitForFullData(page);
}

async function openFirstCluster(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await waitForFullData(page);
  await page.getByRole("combobox", { name: "時間範圍" }).selectOption({ label: "全部時間" });
  const hit = page.locator(".map-cluster-hit").first();
  await expect(hit).toBeVisible({ timeout: 30_000 });
  await hit.click();
  await expect(page.locator(".leaflet-popup")).toHaveCount(1);
}

// popup 開啟中 render 會延後重繪；切換 scope 後必須關閉 popup 並補做 fit，地圖才會出現新 scope 的標記。
test("popup 開啟時切到國際分頁：關閉舊 popup 並重繪國際標記", async ({ page }) => {
  await openFirstCluster(page);
  await page.locator('.tabs button[data-scope="international"]').click();
  await expect(page.locator(".leaflet-popup")).toHaveCount(0);
  const mapState = async () =>
    `${await page.locator(".map-empty-hint").isVisible()}:${await page.locator(".leaflet-marker-icon").count()}`;
  await waitForInternationalData(page);
  const afterPopup = await mapState();

  // 對照組：不開 popup 直接切到國際分頁，地圖狀態必須相同（國際資料多數沒有座標，可能是空狀態）。
  await page.goto("/");
  await waitForFullData(page);
  await page.getByRole("combobox", { name: "時間範圍" }).selectOption({ label: "全部時間" });
  await expect(page.locator(".map-cluster-hit").first()).toBeVisible({ timeout: 30_000 });
  await page.locator('.tabs button[data-scope="international"]').click();
  await waitForInternationalData(page);
  expect(afterPopup).toBe(await mapState());
});

// 聚合彈窗的「此區新聞」要關閉 popup，否則地圖不會反映新的地區篩選。
test("聚合彈窗「此區新聞」關閉 popup 並套用地區篩選", async ({ page }) => {
  await openFirstCluster(page);
  const regionBtn = page.locator(".leaflet-popup .filter-region-btn").first();
  test.skip((await regionBtn.count()) === 0, "此聚合全為模糊地區，沒有「此區新聞」入口");
  const region = await regionBtn.getAttribute("data-filter-region");
  await regionBtn.click();
  await expect(page.locator(".leaflet-popup")).toHaveCount(0);
  await expect(page.locator("#region-chip")).toContainText(region ?? "");
});

// 使用者改篩選（例如地區下拉）時要關閉 popup 並立即重繪，不能讓清單與地圖顯示不同資料。
test("popup 開啟時改地區下拉：關閉 popup", async ({ page }) => {
  await openFirstCluster(page);
  const region = page.getByRole("combobox", { name: "地區篩選" });
  const value = await region.locator("option").nth(1).getAttribute("value");
  test.skip(!value, "沒有可選地區");
  await region.selectOption(value!);
  await expect(page.locator(".leaflet-popup")).toHaveCount(0);
});

test("first-paint popup survives full data arriving for the same view", async ({ page }) => {
  const now = new Date().toISOString();
  const events = JSON.stringify(["a", "b"].map((id) => ({
    id, title: id, summary: "fixture", scope: "domestic", category: "test", region: "test",
    lat: 25.03, lng: 121.56, timestamp: now, riskLevel: "high",
    source: { name: id, type: "news-rss", fetchedAt: now },
  })));
  const emptyNetwork = { nodes: [], edges: [], clusters: [], stats: {} };
  const bodies: Record<string, string> = {
    "domestic.json": events, "domestic.map.json": events, "domestic.head.json": events,
    "network.json": JSON.stringify({ snapshotId: "popup", generatedAt: now, rulesVersion: "test",
      domestic: emptyNetwork, international: emptyNetwork }),
  };
  const manifest = { manifestVersion: 1, snapshotId: "popup", generatedAt: now, rulesVersion: "test",
    scopes: { domestic: { events: "domestic.json", map: "domestic.map.json", head: "domestic.head.json", network: "network.json" },
      international: { events: "international.json", map: "international.map.json", network: "network.json" } },
    files: Object.fromEntries(Object.entries(bodies).map(([path, body]) => [path, {
      path, bytes: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex"),
    }])),
  };
  let release!: () => void;
  const fullData = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/data/*.json", async (route) => {
    const file = new URL(route.request().url()).pathname.split("/").pop()!;
    if (file === "manifest.json") return route.fulfill({ json: manifest });
    if (file === "domestic.json") await fullData;
    if (bodies[file]) return route.fulfill({ body: bodies[file], contentType: "application/json" });
    return route.fulfill({ status: 404, body: "fixture: unavailable" });
  });
  try {
    await page.goto("/#scope=domestic&since=all");
    // Force the ordering rather than depending on download speed.
    await expect(page.locator("#count")).toContainText(/載入中/, { timeout: 30_000 });
    const hit = page.locator(".map-cluster-hit").first();
    await expect(hit).toBeVisible({ timeout: 30_000 });
    await hit.click();
    await expect(page.locator(".leaflet-popup")).toHaveCount(1);
  } finally { release(); }
  await waitForFullData(page);
  await expect(page.locator(".leaflet-popup")).toHaveCount(1);
});
