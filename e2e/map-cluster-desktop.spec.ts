import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1440, height: 900 },
});

test("桌面版點聚合數字標的完整命中區，彈窗不應被內層數字圓攔截或閃退", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#count")).not.toHaveText("");
  await page.getByRole("combobox", { name: "時間範圍" }).selectOption({ label: "全部時間" });
  await expect(page.locator("#count")).not.toContainText("1 / 1");

  const hit = page.locator(".map-cluster-hit").first();
  await expect(hit).toBeVisible({ timeout: 30_000 });
  await hit.click();

  await expect(page.locator(".leaflet-popup")).toHaveCount(1);
  await page.waitForTimeout(500);
  await expect(page.locator(".leaflet-popup")).toHaveCount(1);
});
