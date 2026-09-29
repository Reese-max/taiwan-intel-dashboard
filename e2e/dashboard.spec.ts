import { test, expect, type Page } from "@playwright/test";

async function showAllTime(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator("#f-range").selectOption("");
  await expect(page.locator("#count")).not.toHaveText(/^0 則/, { timeout: 30_000 });
}

// 關鍵路徑 1：首頁載入 — KPI、地圖（Leaflet 初始化）、事件卡都渲染出來。
test("首頁載入：KPI/地圖/事件清單渲染", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#kpistrip")).not.toBeEmpty({ timeout: 30_000 });
  await expect(page.locator("#map.leaflet-container")).toBeVisible();
  await expect(page.locator('img.leaflet-tile[src*="tile.openstreetmap.org"]').first()).toBeVisible();
  await expect(page.locator('img.leaflet-tile[src*="cartocdn.com"]')).toHaveCount(0);
  await expect(page.locator("#eventlist > *").first()).toBeVisible();
  // 人工視覺 diff 用截圖（桌機/行動兩寬度）
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "e2e-artifacts/home-1440.png", fullPage: false });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.screenshot({ path: "e2e-artifacts/home-320.png", fullPage: false });
});

// 關鍵路徑 2：scope 切換 domestic ↔ international。
test("scope 切換：國際 tab 載入國際事件", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#eventlist > *").first()).toBeVisible({ timeout: 30_000 });
  await page.locator('button[data-scope="international"]').click();
  await expect(page.locator('button[data-scope="international"]')).toHaveClass(/active/);
  await expect(page.locator("#eventlist > *").first()).toBeVisible();
});

// 關鍵路徑 3：風險篩選生效（選 critical 後清單重繪、計數變化）。
test("風險篩選：選最低風險等級後清單更新", async ({ page }) => {
  await showAllTime(page);
  const before = await page.locator("#count").innerText();
  await page.locator("#f-risk").selectOption("critical");
  // 篩選後計數應改變（critical 是最嚴格條件；若相等代表全部本來就 critical，仍接受非空清單）
  await expect
    .poll(async () => page.locator("#count").innerText(), { timeout: 10_000 })
    .not.toBe(before);
  await expect(page.locator("#eventlist")).toBeVisible();
});

// 擴充路徑 4：文字搜尋收斂清單（含防抖等待）。
test("文字搜尋：關鍵字篩選會收斂事件清單", async ({ page }) => {
  await showAllTime(page);
  const before = await page.locator("#count").innerText();
  await page.locator("#f-query").fill("詐");
  await expect.poll(async () => page.locator("#count").innerText(), { timeout: 30_000 }).not.toBe(before);
  await expect(page.locator("#eventlist")).toBeVisible();
});

// 擴充路徑 5：分類切換後列表重繪與計數變動。
test("分類切換：反詐分類可生效且清單重繪", async ({ page }) => {
  await showAllTime(page);
  const before = await page.locator("#count").innerText();
  await page.locator("#f-cat").selectOption("反詐");
  await expect.poll(async () => page.locator("#count").innerText(), { timeout: 30_000 }).not.toBe(before);
  await expect(page.locator("#eventlist")).toBeVisible();
});

// 深連結回填：scope / category / risk / since 應只透過 hash 還原至 UI 狀態。
test("URL 深連結：hash 參數可還原到篩選器", async ({ page }) => {
  await page.goto("/#scope=domestic&category=治安&risk=high&since=5");
  await expect(page.locator("#eventlist > *").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#f-cat")).toHaveValue("治安");
  await expect(page.locator("#f-risk")).toHaveValue("high");
  await expect(page.locator("#f-range")).toHaveValue("5");
  await expect(page.locator("#eventlist")).toBeVisible();
});

// XSS 回歸：無效 focus 必須安全清除，不能注入 HTML/JS。
test("XSS hash 回歸：惡意 focus 參數應安全清除", async ({ page }) => {
  const payload = '<img src=x onerror="window.__xss=1">';
  await page.goto(`/#scope=domestic&focus=${encodeURIComponent(payload)}`);
  const focusbar = page.locator("#focusbar");
  await expect(page.locator("#eventlist > *").first()).toBeVisible({ timeout: 30_000 });
  await expect(focusbar).toBeHidden();
  await expect(page.locator("#focusbar img")).toHaveCount(0);
  const xssFlag = await page.evaluate(() => window.__xss);
  expect(xssFlag).toBeUndefined();
});

// KPI 卡片點擊可觸發高風險過濾，並改變 count。
test("KPI 卡片：點擊危急／高風險卡可過濾清單", async ({ page }) => {
  await showAllTime(page);
  const before = await page.locator("#count").innerText();
  await page.locator('[data-kpi-action="filter-elevated"]').click();
  await expect.poll(async () => page.locator("#count").innerText(), { timeout: 30_000 }).not.toBe(before);
  await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  await expect(page.locator("#f-risk")).toHaveValue("high");
  await expect(page.locator("#eventlist")).toBeVisible();
});

// 固定候選資料驗證提示，不再因 live data 沒有舊佐證徽章就跳過。
test("同事件候選：多來源卡片仍顯示待查證並保留原文核對提醒", async ({ page }) => {
  const now = new Date().toISOString();
  const events = ["candidate-a", "candidate-b"].map((id) => ({
    id, title: `合成測試報導 ${id}`, summary: "僅為測試，不是實際案件。", region: "臺北市",
    timestamp: now, category: "治安", scope: "domestic", riskLevel: "high",
    lat: 25.03, lng: 121.56, locationPrecision: "city",
    source: { name: id, publisherName: id, type: "news-rss", url: `https://${id}.example/news/1`, fetchedAt: now },
  }));
  const empty = { nodes: [], edges: [], clusters: [], stats: {} };
  const net = {
    generatedAt: now,
    domestic: { ...empty, edges: [{ a: "candidate-a", b: "candidate-b", type: "same-incident", weight: 1.2, why: "同事件候選，仍需查證" }] },
    international: empty,
  };
  await page.route("**/data/domestic.json", (route) => route.fulfill({ json: events }));
  await page.route("**/data/domestic.map.json", (route) => route.fulfill({ json: events }));
  await page.route("**/data/network.json", (route) => route.fulfill({ json: net }));
  await page.goto("/#scope=domestic&focus=candidate-a");
  await expect(page.locator("#eventlist .candidate-source-note")).toHaveCount(2, { timeout: 30_000 });
  await expect(page.locator("#eventlist .candidate-source-note").first()).toHaveText("多來源線索（2 個標記）·待查證");
  await expect(page.locator("#eventlist .corroboration-chip")).toHaveCount(0);
  await expect(page.locator('#eventlist [data-id="candidate-a"] .event-decision')).toContainText("先查證原文再行動");
  await expect(page.locator('#eventlist [data-id="candidate-a"] .location-link')).toContainText("非案發點");
});

// #38：部署切換時，即使舊 cohort 的 slim map 還可被 HTTP 取得，未鎖定 manifest/hash 的 first-paint 不得請求或晉級。
test("cohort first-paint：舊 S1 map 不得在 S2 manifest/full data 前短暫晉級", async ({ page }) => {
  const now = new Date().toISOString();
  const staleMapEvent = {
    id: "stale-s1-map",
    title: "S1 舊快照地圖事件",
    summary: "僅用於跨部署競態測試。",
    region: "臺北市",
    timestamp: now,
    category: "治安",
    scope: "domestic",
    riskLevel: "high",
    lat: 25.01,
    lng: 121.51,
    locationPrecision: "exact",
    locationRole: "incident",
    source: { name: "fixture-s1", type: "fixture", fetchedAt: now },
  };
  const currentEvent = {
    ...staleMapEvent,
    id: "current-s2-event",
    title: "S2 目前快照事件",
    lat: 25.08,
    lng: 121.58,
    source: { name: "fixture-s2", type: "fixture", fetchedAt: now },
  };
  const manifest = {
    manifestVersion: 1,
    snapshotId: "cohort-s2",
    generatedAt: now,
    rulesVersion: "correlate-v1",
    scopes: {
      domestic: { events: "domestic.json", map: "domestic.map.json", network: "network.json" },
      international: { events: "international.json", map: "international.map.json", network: "network.json" },
    },
    files: {},
  };
  const empty = { nodes: [], edges: [], clusters: [], stats: {} };
  const network = {
    snapshotId: "cohort-s2",
    generatedAt: now,
    rulesVersion: "correlate-v1",
    domestic: empty,
    international: empty,
  };
  let staleMapRequests = 0;

  await page.route("**/data/manifest.json", (route) => route.fulfill({ json: manifest }));
  await page.route("**/data/domestic.map.json", (route) => {
    staleMapRequests += 1;
    return route.fulfill({ json: [staleMapEvent] });
  });
  await page.route("**/data/domestic.json", async (route) => {
    // 刻意讓完整 S2 慢於舊 S1 map；舊實作會在這個窗口先晉級 S1。
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ json: [currentEvent] });
  });
  await page.route("**/data/network.json", (route) => route.fulfill({ json: network }));

  await page.goto("/#scope=domestic&since=3");
  await expect(page.locator('#eventlist [data-id="current-s2-event"]')).toBeVisible({ timeout: 30_000 });

  expect(staleMapRequests).toBe(0);
  await expect(page.locator('#eventlist [data-id="stale-s1-map"]')).toHaveCount(0);
  await expect(page.locator("#map .leaflet-marker-icon")).toHaveCount(1, { timeout: 10_000 });
});
