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
