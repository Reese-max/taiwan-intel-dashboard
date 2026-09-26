import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";

// Issue #38 D2 驗收：部署發生在兩次請求之間（跨部署競態）時，
// 地圖 first-paint 不得晉級未驗證的異版產物 —— 必須先鎖定 manifest，
// 精簡點位通過 SHA-256 驗證後才可早繪；失敗則等 refresh() 用同版資料補繪。

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const now = new Date().toISOString();

function ev(id: string, lat: number, lng: number, scope = "domestic") {
  return {
    id,
    title: `測試事件 ${id}`,
    summary: "僅為測試資料。",
    region: "臺北市",
    timestamp: now,
    category: "治安",
    scope,
    riskLevel: "high",
    lat,
    lng,
    locationPrecision: "city",
    source: { name: `src-${id}`, publisherName: `src-${id}`, type: "news-rss", url: `https://${id}.example/1`, fetchedAt: now },
  };
}

// S2（選定 cohort）：兩個相距遠的可定位事件 → 地圖上不會形成 cluster bubble。
const s2Events = [ev("s2-a", 25.03, 121.56), ev("s2-b", 22.63, 120.3)];
// S1（舊部署殘留 map bytes）：三個同點事件 → 若被晉級會出現文字為「3」的 cluster bubble。
const s1MapEvents = [ev("s1-a", 24.15, 120.68), ev("s1-b", 24.15, 120.68), ev("s1-c", 24.15, 120.68)];

const networkS2 = {
  snapshotId: "cohort-s2",
  rulesVersion: "correlate-v1",
  generatedAt: now,
  scopeNote: "test",
  domestic: { nodes: [], edges: [], clusters: [], stats: {} },
  international: { nodes: [], edges: [], clusters: [], stats: {} },
};

const s2EventsBody = JSON.stringify(s2Events);
const s2MapBody = JSON.stringify(s2Events); // manifest 期望的 S2 map bytes（server 實際給 S1）
const networkBody = JSON.stringify(networkS2);

const manifest = {
  manifestVersion: 1,
  snapshotId: "cohort-s2",
  generatedAt: now,
  rulesVersion: "correlate-v1",
  scopes: {
    domestic: { events: "domestic.json", map: "domestic.map.json", network: "network.json" },
    international: { events: "international.json", map: "international.map.json", network: "network.json" },
  },
  files: {
    "domestic.json": { path: "domestic.json", sha256: sha(s2EventsBody), bytes: s2EventsBody.length },
    "domestic.map.json": { path: "domestic.map.json", sha256: sha(s2MapBody), bytes: s2MapBody.length },
    "international.json": { path: "international.json", sha256: sha("[]"), bytes: 2 },
    // 深連結測試用：international.map.json 以同 body 提供 sha（manifest 具名檔缺 hash 會 fail-closed）。
    "international.map.json": { path: "international.map.json", sha256: sha(s2MapBody), bytes: s2MapBody.length },
    "network.json": { path: "network.json", sha256: sha(networkBody), bytes: networkBody.length },
  },
};

test("部署競態：manifest 先於 map 請求；hash 不符的 S1 產物永不晉級", async ({ page }) => {
  const order: string[] = [];
  await page.addInitScript(() => {
    // cluster bubble 是 DOM（divIcon）：記錄 S1 特有的「3」泡泡是否曾出現，
    // 即使之後被 refresh 重繪覆蓋也能抓到瞬間晉級。
    (window as unknown as { __sawS1: boolean }).__sawS1 = false;
    new MutationObserver(() => {
      document.querySelectorAll(".map-cluster-hit").forEach((el) => {
        if (el.textContent?.trim() === "3") {
          (window as unknown as { __sawS1: boolean }).__sawS1 = true;
        }
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  });

  // catch-all 先註冊（Playwright 後註冊者優先），其餘 data/*.json 一律 404。
  await page.route("**/data/*.json", (route) => route.fulfill({ status: 404 }));
  await page.route("**/data/manifest.json", async (route) => {
    order.push("manifest");
    await new Promise((r) => setTimeout(r, 80)); // 放大競態視窗：未鎖定實作必讓 map 先到
    await route.fulfill({ json: manifest });
  });
  await page.route("**/data/domestic.map.json", (route) => {
    order.push("map");
    return route.fulfill({ body: JSON.stringify(s1MapEvents), contentType: "application/json" });
  });
  await page.route("**/data/domestic.json", (route) => {
    order.push("events");
    return route.fulfill({ body: s2EventsBody, contentType: "application/json" });
  });
  await page.route("**/data/international.json", (route) => route.fulfill({ json: [] }));
  await page.route("**/data/network.json", (route) =>
    route.fulfill({ body: networkBody, contentType: "application/json" }),
  );

  await page.goto("/");
  await expect(page.locator("#eventlist > *").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#eventlist")).toContainText("s2-a");

  // manifest 必須在任何同版產物（events/map/network）之前完成請求。
  expect(order.indexOf("manifest")).toBe(0);
  expect(order.indexOf("map")).toBeGreaterThan(order.indexOf("manifest"));

  // S1 map bytes 與 manifest hash 不符 → 不得早繪；S2 兩事件分屬不同網格 → 無 cluster bubble。
  await page.waitForTimeout(400); // 等 refresh 重繪完成，覆蓋任何可能的瞬態
  expect(await page.evaluate(() => (window as unknown as { __sawS1: boolean }).__sawS1)).toBe(false);
  await expect(page.locator(".map-cluster-hit")).toHaveCount(0);
});

test("深連結 scope：first-paint 以網址 scope 為準，不快取預設 domestic 產物", async ({ page }) => {
  const requested: string[] = [];
  await page.route("**/data/*.json", (route) => route.fulfill({ status: 404 }));
  await page.route("**/data/manifest.json", (route) => route.fulfill({ json: manifest }));
  await page.route("**/data/domestic.map.json", (route) => {
    requested.push("domestic.map");
    return route.fulfill({ body: s2MapBody, contentType: "application/json" });
  });
  await page.route("**/data/international.map.json", (route) => {
    requested.push("international.map");
    return route.fulfill({ body: s2MapBody, contentType: "application/json" });
  });
  await page.route("**/data/domestic.json", (route) =>
    route.fulfill({ body: s2EventsBody, contentType: "application/json" }),
  );
  await page.route("**/data/international.json", (route) => route.fulfill({ json: [] }));
  await page.route("**/data/network.json", (route) =>
    route.fulfill({ body: networkBody, contentType: "application/json" }),
  );

  await page.goto("/#scope=international");
  // first-paint 應請求 international.map.json，且絕不碰 domestic.map.json。
  await expect.poll(() => requested, { timeout: 15_000 }).toContain("international.map");
  await page.waitForTimeout(300);
  expect(requested).not.toContain("domestic.map");
});
