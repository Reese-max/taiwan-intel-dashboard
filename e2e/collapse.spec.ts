import { test, expect, type Page } from "@playwright/test";

async function findCollapseToggle(page: Page): Promise<boolean> {
  await expect(page.locator("#eventlist > *").first()).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 100; i += 1) {
    if ((await page.locator("#eventlist .collapse-toggle").count()) > 0) return true;
    const loadMore = page.locator("#eventlist .load-more-btn");
    if ((await loadMore.count()) === 0) break;
    await loadMore.click();
  }
  return false;
}

test("同事件跨源收合：預設清單可展開其餘來源", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto("/#scope=domestic&since=5");
  let found = await findCollapseToggle(page);

  if (!found) {
    await page.locator("#f-range").selectOption("");
    found = await findCollapseToggle(page);
  }

  if (!found) {
    await page.locator("#f-query").fill("詐");
    await expect(page.locator("#f-query")).toHaveValue("詐");
    await page.waitForTimeout(600);
    found = await findCollapseToggle(page);
  }

  if (!found) {
    await page.locator('button[data-scope="international"]').click();
    await page.locator("#f-range").selectOption("");
    found = await findCollapseToggle(page);
  }

  test.skip(!found, "目前載入資料中沒有可探索到的 .collapse-toggle（same-incident 收合群組）");

  const toggle = page.locator("#eventlist .collapse-toggle").first();
  await expect(toggle).toContainText(/收合 \d+ 源/);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#eventlist .collapse-source-row").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#eventlist .collapse-source-row .collapse-source-name").first()).not.toBeEmpty();
});
