import { test, expect } from "@playwright/test";

test("待處置收件匣：高風險列可聚焦、標已讀並持久化", async ({ page }) => {
  await page.goto("/#scope=international&since=14");
  await page.evaluate(() => localStorage.removeItem("taiwan-intel-triage-acked"));
  await page.reload();

  await expect(page.locator("#triageinbox")).toBeVisible({ timeout: 30_000 });
  const rows = page.locator("#triageinbox .triage-row");
  const rowCount = await rows.count();
  test.skip(rowCount === 0, "目前時間窗內沒有 critical/high 事件，無法穩健測待處置收件匣互動");

  const first = rows.first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  const id = await first.getAttribute("data-id");
  expect(id).toBeTruthy();
  await expect(first).toHaveClass(/is-unread/);

  await first.click();
  await expect(page.locator("#focusbar")).not.toHaveAttribute("hidden", "", { timeout: 30_000 });
  await expect(first).not.toHaveClass(/is-unread/, { timeout: 30_000 });

  await page.reload();
  await expect(page.locator("#triageinbox")).toBeVisible({ timeout: 30_000 });
  const persistedUnread = await page.evaluate((eventId) => {
    const row = Array.from(document.querySelectorAll<HTMLElement>("#triageinbox .triage-row")).find(
      (el) => el.dataset.id === eventId,
    );
    return row ? row.classList.contains("is-unread") : null;
  }, id);
  expect(persistedUnread).toBe(false);
});
