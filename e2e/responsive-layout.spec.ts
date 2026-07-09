import { test, expect } from "@playwright/test";

async function layoutSnapshot(page) {
  return page.evaluate(() => {
    const rectOf = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        display: style.display,
      };
    };
    const list = rectOf(".col-list");
    const side = rectOf(".col-side");
    const map = rectOf(".col-map");
    const topClustersSummary = Array.from(document.querySelectorAll(".side-section summary")).find((element) =>
      (element.textContent || "").includes("今日最大情報群")
    );
    const topClusters = topClustersSummary
      ? (() => {
          const rect = topClustersSummary.getBoundingClientRect();
          return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
        })()
      : null;
    return {
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      list,
      side,
      map,
      topClusters,
      listAndSideSameRow: !!(list && side && Math.abs(list.y - side.y) < 3),
      mapFullRowAbove: !!(map && list && side && map.y < list.y && map.w >= list.w + side.w),
    };
  });
}

test("響應式版面：平板寬度讓情報列表與今日最大情報群並排縮小", async ({ page }) => {
  for (const viewport of [
    { width: 900, height: 900 },
    { width: 768, height: 1024 },
    { width: 641, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("#eventlist > *").first()).toBeVisible({ timeout: 30_000 });

    const snapshot = await layoutSnapshot(page);
    expect(snapshot.overflowX).toBe(false);
    expect(snapshot.listAndSideSameRow).toBe(true);
    expect(snapshot.mapFullRowAbove).toBe(true);
    expect(snapshot.list?.w ?? 0).toBeGreaterThanOrEqual(320);
    expect(snapshot.side?.w ?? 0).toBeGreaterThanOrEqual(220);
    expect(snapshot.topClusters?.w ?? 0).toBeGreaterThanOrEqual(218);
  }
});

test("響應式版面：手機仍維持單分頁，不顯示右側情報群", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#eventlist > *").first()).toBeVisible({ timeout: 30_000 });

  const snapshot = await layoutSnapshot(page);
  expect(snapshot.overflowX).toBe(false);
  expect(snapshot.list?.display).toBe("block");
  expect(snapshot.map?.display).toBe("none");
  expect(snapshot.side?.display).toBe("none");
});
