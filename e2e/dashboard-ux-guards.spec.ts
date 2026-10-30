import { test, expect } from "@playwright/test";

test.describe("Dashboard UX Guards (Round 4)", () => {
  // Guard 1: HTML 根標籤語言與防翻譯屬性
  test("(3) <html> 標籤包含 lang=zh-Hant 與 translate=no 屬性", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "zh-Hant");
    await expect(html).toHaveAttribute("translate", "no");
  });

  // Guard 2: KPI 卡片資料源數值
  test("(2) 當事件存在時，KPI 卡片「活躍資料源」與「官方來源占比」均顯示有效數字而非破折號 —", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#kpistrip")).not.toBeEmpty({ timeout: 30_000 });
    await expect(page.locator("#eventlist > *").first()).toBeVisible({ timeout: 30_000 });

    // 國內範圍檢驗
    const activeSourceCard = page.locator("#kpistrip .kpi-card", { hasText: "活躍資料源" });
    const activeSourceNum = activeSourceCard.locator(".kpi-num");
    await expect(activeSourceNum).toBeVisible();
    await expect(activeSourceNum).not.toHaveText("—");
    await expect(activeSourceNum).toHaveText(/\d+\s*\/\s*\d+/);

    const officialRatioCard = page.locator("#kpistrip .kpi-card", { hasText: "官方來源占比" });
    const officialRatioNum = officialRatioCard.locator(".kpi-num");
    await expect(officialRatioNum).toBeVisible();
    await expect(officialRatioNum).not.toHaveText("—");
    await expect(officialRatioNum).toHaveText(/\d+%/);

    // 切換至國際範圍檢驗
    await page.locator('button[data-scope="international"]').click();
    await expect(page.locator('button[data-scope="international"]')).toHaveClass(/active/);
    await expect(page.locator("#eventlist > *").first()).toBeVisible({ timeout: 30_000 });

    await expect(activeSourceNum).toBeVisible();
    await expect(activeSourceNum).not.toHaveText("—");
    await expect(activeSourceNum).toHaveText(/\d+\s*\/\s*\d+/);

    await expect(officialRatioNum).toBeVisible();
    await expect(officialRatioNum).not.toHaveText("—");
    await expect(officialRatioNum).toHaveText(/\d+%/);
  });

  // Guard 3: AI 情勢摘要降級提示（帶 pipeline 原因）
  test("(1a) AI 情勢摘要降級時顯示 pipeline 記錄原因，且絕不含「金鑰」或「配額」字串", async ({ page }) => {
    const degradedSummaryWithReason = {
      domestic: "國內事件共 12 起，以 治安 為主。（AI 摘要暫時無法生成，事件資料仍可查閱；此為系統統計備援）",
      international: "國際事件共 6 起，以 外交 為主。（AI 摘要暫時無法生成，事件資料仍可查閱；此為系統統計備援）",
      degraded: true,
      degradedReason: "NVIDIA API HTTP 503 服務維護中",
      lastSuccessAt: "2026-10-30T10:00:00Z",
      generatedAt: new Date().toISOString(),
    };

    await page.route("**/data/summary.json", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(degradedSummaryWithReason),
      }),
    );

    await page.goto("/");
    const aibrief = page.locator("#aibrief");
    await expect(aibrief).toBeVisible({ timeout: 30_000 });
    await expect(aibrief).toContainText("系統統計備援", { timeout: 30_000 });
    await expect(aibrief).toContainText("NVIDIA API HTTP 503 服務維護中");

    const briefText = await aibrief.innerText();
    expect(briefText).not.toContain("金鑰");
    expect(briefText).not.toContain("配額");

    // 切換國際 tab 驗證同樣不含金鑰或配額
    await page.locator('button[data-scope="international"]').click();
    await expect(page.locator('button[data-scope="international"]')).toHaveClass(/active/);
    await expect(aibrief).toContainText("系統統計備援", { timeout: 30_000 });
    await expect(aibrief).toContainText("NVIDIA API HTTP 503 服務維護中");

    const intlBriefText = await aibrief.innerText();
    expect(intlBriefText).not.toContain("金鑰");
    expect(intlBriefText).not.toContain("配額");
  });

  // Guard 4: AI 情勢摘要降級提示（無 pipeline 原因時退回「原因未記錄」）
  test("(1b) AI 情勢摘要降級但未記錄原因時顯示「原因未記錄」，且絕不含「金鑰」或「配額」字串", async ({ page }) => {
    const degradedSummaryWithoutReason = {
      domestic: "國內事件共 8 起，以 治安 為主。（AI 摘要暫時無法生成，事件資料仍可查閱；此為系統統計備援）",
      international: "國際事件共 3 起，以 外交 為主。（AI 摘要暫時無法生成，事件資料仍可查閱；此為系統統計備援）",
      degraded: true,
      lastSuccessAt: "2026-10-30T10:00:00Z",
      generatedAt: new Date().toISOString(),
    };

    await page.route("**/data/summary.json", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(degradedSummaryWithoutReason),
      }),
    );

    await page.goto("/");
    const aibrief = page.locator("#aibrief");
    await expect(aibrief).toBeVisible({ timeout: 30_000 });
    await expect(aibrief).toContainText("系統統計備援", { timeout: 30_000 });
    await expect(aibrief).toContainText("原因：原因未記錄");

    const briefText = await aibrief.innerText();
    expect(briefText).not.toContain("金鑰");
    expect(briefText).not.toContain("配額");
  });

  // Guard 5: 首屏 head.json 早繪與完整載入計數
  test("(4) 若 manifest 存在 head.json，首屏在完整資料完成載入前即渲染列表，且完整載入後計數無「載入中」", async ({ page }) => {
    let fullEventsLoaded = false;

    // 模擬完整國內事件主檔載入延遲 1000ms，以驗證 head 投影先行渲染效果
    await page.route("**/data/domestic.json", async (route) => {
      await new Promise((r) => setTimeout(r, 1000));
      fullEventsLoaded = true;
      await route.continue();
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // 在完整 domestic.json 尚未回傳前，首屏事件列與計數標籤（帶 載入中）必須已經早繪出 DOM
    const eventCards = page.locator("#eventlist > *");
    await expect(eventCards.first()).toBeVisible({ timeout: 5000 });
    expect(fullEventsLoaded).toBe(false);

    const countPill = page.locator("#count");
    await expect(countPill).toContainText("載入中");

    // 等待延遲結束、主資料完整載入與重新渲染
    await expect(countPill).not.toContainText("載入中", { timeout: 30_000 });
    expect(fullEventsLoaded).toBe(true);
    await expect(countPill).toHaveText(/\d+/);
  });
});
