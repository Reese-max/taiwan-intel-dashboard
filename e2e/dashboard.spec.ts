import { test, expect } from "@playwright/test";

// 關鍵路徑 1：首頁載入 — KPI、地圖（Leaflet 初始化）、事件卡都渲染出來。
test("首頁載入：KPI/地圖/事件清單渲染", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#kpistrip")).not.toBeEmpty({ timeout: 30_000 });
  await expect(page.locator("#map.leaflet-container")).toBeVisible();
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
  await page.goto("/");
  await expect(page.locator("#eventlist > *").first()).toBeVisible({ timeout: 30_000 });
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
  await page.goto("/");
  await expect(page.locator("#eventlist > *").first()).toBeVisible({ timeout: 30_000 });
  const before = await page.locator("#count").innerText();
  await page.locator("#f-query").fill("詐");
  await expect.poll(async () => page.locator("#count").innerText(), { timeout: 30_000 }).not.toBe(before);
  await expect(page.locator("#eventlist")).toBeVisible();
});

// 擴充路徑 5：分類切換後列表重繪與計數變動。
test("分類切換：反詐分類可生效且清單重繪", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#eventlist > *").first()).toBeVisible({ timeout: 30_000 });
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

// XSS 回歸：focus 參數必須以文字呈現，不能注入 HTML/JS。
test("XSS hash 回歸：focus 參數應以轉義文字顯示", async ({ page }) => {
  const payload = '<img src=x onerror="window.__xss=1">';
  await page.goto(`/#scope=domestic&focus=${encodeURIComponent(payload)}`);
  const focusbar = page.locator("#focusbar");
  await expect(focusbar).not.toBeHidden({ timeout: 30_000 });
  await expect(page.locator("#focusbar img")).toHaveCount(0);
  await expect
    .poll(async () => page.locator("#focusbar").innerText(), { timeout: 30_000 })
    .not.toContain("<img");
  const focusbarText = await focusbar.innerText();
  expect(focusbarText === "" || focusbarText.includes("img") || focusbarText.includes("onerror")).toBeTruthy();
  const xssFlag = await page.evaluate(() => window.__xss);
  expect(xssFlag).toBeUndefined();
});

// KPI 卡片點擊可觸發高風險過濾，並改變 count。
test("KPI 卡片：點擊危急／高風險卡可過濾清單", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#kpistrip")).not.toBeEmpty({ timeout: 30_000 });
  const before = await page.locator("#count").innerText();
  await page.locator('[data-kpi-action="filter-elevated"]').click();
  await expect.poll(async () => page.locator("#count").innerText(), { timeout: 30_000 }).not.toBe(before);
  await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  await expect(page.locator("#f-risk")).toHaveValue("high");
  await expect(page.locator("#eventlist")).toBeVisible();
});

// cross-source corroboration：用 DOM 探索尋找至少一張 same-incident 回接的事件卡。
test("跨源佐證徽章：事件清單可呈現 N 源佐證 chip", async ({ page }) => {
  test.setTimeout(120_000);

  const findChip = async (): Promise<boolean> => {
    await expect(page.locator("#eventlist > *").first()).toBeVisible({ timeout: 30_000 });
    for (let i = 0; i < 100; i += 1) {
      if ((await page.locator("#eventlist .corroboration-chip").count()) > 0) return true;
      const loadMore = page.locator("#eventlist .load-more-btn");
      if ((await loadMore.count()) === 0) break;
      await loadMore.click();
    }
    return false;
  };

  await page.goto("/#scope=domestic&since=5");
  let found = await findChip();

  if (!found) {
    await page.locator("#f-range").selectOption("");
    found = await findChip();
  }

  if (!found) {
    await page.locator('button[data-scope="international"]').click();
    await page.locator("#f-range").selectOption("");
    found = await findChip();
  }

  test.skip(!found, "目前載入資料中沒有可探索到的 .corroboration-chip（same-incident 跨源佐證徽章）");
  await expect(page.locator("#eventlist .corroboration-chip").first()).toContainText(/\d+ 源佐證/);
});
