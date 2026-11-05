import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

async function openFirstCluster(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#count")).not.toHaveText("", { timeout: 30_000 });
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
  await page.waitForTimeout(1500);
  const afterPopup = await mapState();

  // 對照組：不開 popup 直接切到國際分頁，地圖狀態必須相同（國際資料多數沒有座標，可能是空狀態）。
  await page.goto("/");
  await expect(page.locator("#count")).not.toHaveText("", { timeout: 30_000 });
  await page.getByRole("combobox", { name: "時間範圍" }).selectOption({ label: "全部時間" });
  await expect(page.locator(".map-cluster-hit").first()).toBeVisible({ timeout: 30_000 });
  await page.locator('.tabs button[data-scope="international"]').click();
  await page.waitForTimeout(1500);
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
