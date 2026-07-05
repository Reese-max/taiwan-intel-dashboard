import { test, expect, type Page } from "@playwright/test";

const GRAPH = "#relationgraph";
const REL_LINK = "#eventlist .event-card .rel-link";
const NODE = `${GRAPH} svg.rg-svg .rg-node-g`;
const NODE_HIT = `${NODE} .rg-hit`;

async function openFirstRelationGraph(page: Page): Promise<boolean> {
  await page.goto("/#scope=domestic&since=5");
  await expect(page.locator("#eventlist > *").first()).toBeVisible({ timeout: 30_000 });

  let firstRelationLink = page.locator(REL_LINK).first();
  if ((await firstRelationLink.count()) === 0) {
    // 近 5 天可能剛好沒有關聯；改用 UI 的「全部時間」仍維持 DOM 探索、不寫死 event id。
    await page.locator("#f-range").selectOption("");
    await expect(page.locator("#eventlist > *").first()).toBeVisible({ timeout: 30_000 });
    firstRelationLink = page.locator(REL_LINK).first();
  }

  if ((await firstRelationLink.count()) === 0) {
    // 優先用公開搜尋框收斂到高關聯密度的反詐資料；若資料變動仍會 fallback 到分批載入探索。
    await page.locator("#f-query").fill("詐");
    await expect(page.locator("#f-query")).toHaveValue("詐");
    await page.waitForTimeout(600);
    await expect(page.locator("#eventlist > *").first()).toBeVisible({ timeout: 30_000 });
    firstRelationLink = page.locator(REL_LINK).first();
  }

  // 清單分批載入；持續用 DOM 探索第一個關聯連結，而不是寫死 event id。
  for (let i = 0; i < 80 && (await firstRelationLink.count()) === 0; i += 1) {
    const loadMore = page.locator("#eventlist .load-more-btn");
    if ((await loadMore.count()) === 0) break;
    const cardsBefore = await page.locator("#eventlist .event-card").count();
    await loadMore.click();
    await expect
      .poll(async () => page.locator("#eventlist .event-card").count(), { timeout: 30_000 })
      .toBeGreaterThan(cardsBefore);
  }
  if ((await firstRelationLink.count()) === 0) return false;

  await firstRelationLink.click();
  await expect(page.locator(GRAPH)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(`${GRAPH} svg.rg-svg`)).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => page.locator(NODE).count(), { timeout: 30_000 }).toBeGreaterThan(0);
  return true;
}

async function skipIfNoRelationGraph(page: Page): Promise<void> {
  const hasRelationGraph = await openFirstRelationGraph(page);
  test.skip(!hasRelationGraph, "目前可探索的清單資料沒有任何 .rel-link（relatedCount > 0），無法穩健測關聯圖互動");
}

async function selectFirstNode(page: Page): Promise<void> {
  await page.locator(NODE_HIT).first().click();
  await expect(page.locator(`${GRAPH} .rg-preview`)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(`${GRAPH} .rg-preview .rg-pv-title`)).toBeVisible({ timeout: 30_000 });
}

test.describe("關聯圖互動", () => {
  test.describe.configure({ timeout: 120_000 });
  test("揭示：事件卡關聯連結會顯示關聯圖與 SVG 節點", async ({ page }) => {
    await skipIfNoRelationGraph(page);
    await expect(page.locator(GRAPH)).not.toHaveAttribute("hidden", "");
    await expect(page.locator(NODE).first()).toBeVisible();
  });

  test("選取節點：點 SVG 關聯節點會顯示預覽並套用高亮", async ({ page }) => {
    await skipIfNoRelationGraph(page);
    await selectFirstNode(page);
    await expect.poll(async () => page.locator(`${GRAPH} svg.rg-svg .is-active`).count(), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(page.locator(`${GRAPH} svg.rg-svg`)).toHaveClass(/has-active/);
  });

  test("展開：若節點有展開鈕，點擊後會新增第二圈或標示展開狀態", async ({ page }) => {
    await skipIfNoRelationGraph(page);

    const nodeCount = await page.locator(NODE_HIT).count();
    let foundExpandable = false;
    for (let i = 0; i < nodeCount; i += 1) {
      await page.locator(NODE_HIT).nth(i).click();
      if ((await page.locator(`${GRAPH} .rg-expand`).count()) > 0) {
        foundExpandable = true;
        break;
      }
    }
    test.skip(!foundExpandable, "目前第一個關聯圖內沒有可第二圈展開的節點（.rg-expand 不存在）");

    const before = await page.locator(NODE).count();
    await page.locator(`${GRAPH} .rg-expand`).click();
    await expect
      .poll(
        async () => {
          const total = await page.locator(NODE).count();
          const subnodes = await page.locator(`${GRAPH} .rg-subnode`).count();
          const expanded = await page.locator(`${GRAPH} .rg-node-g.is-expanded`).count();
          return total > before || subnodes > 0 || expanded > 0;
        },
        { timeout: 30_000 },
      )
      .toBeTruthy();
  });

  test("類型篩選：若圖例型別有對應邊，切換後會關閉該型別節點或邊", async ({ page }) => {
    await skipIfNoRelationGraph(page);

    const type = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("#relationgraph .rg-legend-btn"));
      return buttons.find((btn) => {
        const t = btn.dataset.type;
        return !!t && document.querySelectorAll(`#relationgraph .rg-edge.edge-${CSS.escape(t)}`).length > 0;
      })?.dataset.type ?? null;
    });
    test.skip(!type, "目前關聯圖沒有可篩選的圖例型別或對應邊");

    const activeBefore = await page.locator(`${GRAPH} .rg-edge:not(.flt-off), ${GRAPH} .rg-node-g:not(.flt-off)`).count();
    await page.locator(`${GRAPH} .rg-legend-btn[data-type="${type}"]`).click();
    await expect(page.locator(`${GRAPH} .rg-legend-btn[data-type="${type}"]`)).toHaveAttribute("aria-pressed", "false");
    await expect
      .poll(async () => page.locator(`${GRAPH} .rg-edge:not(.flt-off), ${GRAPH} .rg-node-g:not(.flt-off)`).count(), {
        timeout: 30_000,
      })
      .toBeLessThan(activeBefore);
    await expect.poll(async () => page.locator(`${GRAPH} .flt-off`).count(), { timeout: 30_000 }).toBeGreaterThan(0);
  });

  test("返回：焦點列返回全部會回到一般清單並隱藏關聯圖", async ({ page }) => {
    await skipIfNoRelationGraph(page);
    await expect(page.locator("#focusbar #clear-focus")).toBeVisible({ timeout: 30_000 });

    await page.locator("#focusbar #clear-focus").click();
    await expect(page.locator(GRAPH)).toBeHidden({ timeout: 30_000 });
    await expect(page.locator("#focusbar")).toHaveAttribute("hidden", "", { timeout: 30_000 });
    await expect(page.locator("#eventlist .event-card").first()).toBeVisible();
  });
});


