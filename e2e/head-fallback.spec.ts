import { test, expect } from "@playwright/test";

test.describe("head.json fallback when head.json is missing or 404", () => {
  test("falls back to full load: event list renders, count pill has no 載入中 and shows total, no page errors", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => {
      pageErrors.push(err);
    });

    // Abort external fonts to avoid external network flakes
    await page.route(/^https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());

    // Intercept data/*.head.json and respond with 404
    let headRouteHit = false;
    await page.route("**/data/*.head.json", async (route) => {
      headRouteHit = true;
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "head projection not found" }),
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Assert that the head route was indeed requested and routed to 404
    await expect.poll(() => headRouteHit, { timeout: 15_000 }).toBe(true);

    // Event list renders with items (not blank, not stuck at loading indicator)
    const eventList = page.locator("#eventlist");
    await expect(eventList).toBeVisible({ timeout: 30_000 });
    await expect(eventList.locator(".event-card, article").first()).toBeVisible({ timeout: 30_000 });

    // Count pill eventually has no '載入中' and shows a total
    const countPill = page.locator("#count");
    await expect(countPill).toBeVisible({ timeout: 30_000 });
    await expect(countPill).not.toContainText("載入中", { timeout: 30_000 });
    await expect(countPill).toHaveText(/\d+\s*則/, { timeout: 30_000 });
    await expect(countPill).not.toHaveText(/^0\s*則/, { timeout: 30_000 });

    // Filter summary, if displayed, has no stuck '載入中'
    const filterSummary = page.locator("#filter-summary");
    if (await filterSummary.isVisible()) {
      await expect(filterSummary).not.toContainText("載入中");
    }

    // No uncaught exceptions or page errors
    expect(pageErrors).toEqual([]);
  });

  test("switching scope also falls back cleanly without stuck count or errors when head.json 404s", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => {
      pageErrors.push(err);
    });

    await page.route(/^https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());

    await page.route("**/data/*.head.json", async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "head projection not found" }),
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Domestic scope full load succeeds
    await expect(page.locator("#eventlist .event-card").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#count")).not.toContainText("載入中", { timeout: 30_000 });
    await expect(page.locator("#count")).toHaveText(/\d+\s*則/, { timeout: 30_000 });

    // Switch to international scope
    const intlTab = page.locator('button[data-scope="international"]');
    await intlTab.click();
    await expect(intlTab).toHaveClass(/active/);

    // International scope full load succeeds despite head.json 404
    await expect(page.locator("#eventlist .event-card").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#count")).not.toContainText("載入中", { timeout: 30_000 });
    await expect(page.locator("#count")).toHaveText(/\d+\s*則/, { timeout: 30_000 });

    expect(pageErrors).toEqual([]);
  });
});
