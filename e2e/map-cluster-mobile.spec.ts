import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});

test("行動版切到地圖後立即點聚合數字標，彈窗不應閃退", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#count")).not.toHaveText("");
  await page.getByRole("combobox", { name: "時間範圍" }).selectOption({ label: "全部時間" });
  await expect(page.locator("#count")).not.toContainText("1 / 1");
  await page.locator('[data-mobile-view="map"]').tap();

  const hit = page.locator(".map-cluster-hit").first();
  await expect(hit).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => {
      return page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>(".map-cluster-hit")).some((candidate) => {
          const box = candidate.getBoundingClientRect();
          if (box.top < 0 || box.bottom > window.innerHeight) return false;
          const topmost = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return topmost?.closest(".map-cluster-hit") === candidate;
        }),
      );
    })
    .toBe(true);

  const scrollBefore = await page.evaluate(() => window.scrollY);
  const tapPoint = await page.evaluate(() => {
    for (const candidate of document.querySelectorAll<HTMLElement>(".map-cluster-hit")) {
      const box = candidate.getBoundingClientRect();
      if (box.top < 0 || box.bottom > window.innerHeight) continue;
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      if (document.elementFromPoint(x, y)?.closest(".map-cluster-hit") === candidate) return { x, y };
    }
    return null;
  });
  expect(tapPoint).not.toBeNull();
  await page.touchscreen.tap(tapPoint!.x, tapPoint!.y);
  await expect(page.locator(".leaflet-popup")).toHaveCount(1);
  await page.waitForTimeout(500);
  await expect(page.locator(".leaflet-popup")).toHaveCount(1);
  const scrollAfter = await page.evaluate(() => window.scrollY);
  expect(Math.abs(scrollAfter - scrollBefore), "點數字標不應讓整頁突然跳動").toBeLessThanOrEqual(2);
});
