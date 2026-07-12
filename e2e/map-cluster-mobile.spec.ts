import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});

test("行動版切到地圖後立即點聚合數字標，彈窗不應閃退", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-mobile-view="map"]').tap();

  const hit = page.locator(".map-cluster-hit").first();
  await expect(hit).toBeVisible({ timeout: 30_000 });

  let previous = "";
  let stableSamples = 0;
  await expect
    .poll(async () => {
      const box = await hit.boundingBox();
      const scrollY = await page.evaluate(() => window.scrollY);
      const sample = box ? `${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(scrollY)}` : "detached";
      stableSamples = sample === previous ? stableSamples + 1 : 0;
      previous = sample;
      return stableSamples;
    }, { timeout: 10_000, intervals: [100] })
    .toBeGreaterThanOrEqual(2);

  const scrollBefore = await page.evaluate(() => window.scrollY);
  const box = await hit.boundingBox();
  expect(box).not.toBeNull();
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(page.locator(".leaflet-popup")).toHaveCount(1);
  await page.waitForTimeout(500);
  await expect(page.locator(".leaflet-popup")).toHaveCount(1);
  const scrollAfter = await page.evaluate(() => window.scrollY);
  expect(Math.abs(scrollAfter - scrollBefore), "點數字標不應讓整頁突然跳動").toBeLessThanOrEqual(2);
});
