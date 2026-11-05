import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";

const now = new Date();
const event = (id: string, patch: Record<string, unknown> = {}) => ({
  id, title: `合成事件 ${id}`, summary: "回歸測試資料，非真實案件", scope: "domestic", category: "治安",
  region: "臺北市", lat: 25.03, lng: 121.56, riskLevel: "high", timestamp: now.toISOString(), locationPrecision: "city",
  source: { name: `合成來源 ${id}`, type: "news-rss", fetchedAt: now.toISOString(), url: `https://example.invalid/news/${id}` }, ...patch,
});

function snapshot(version = "one", count = 3, moveMiddle = false, boundary = false) {
  const events = [event("a"), event("b", { riskLevel: "low", region: "臺中市", category: "災防",
    timestamp: new Date(now.getTime() - 86400000).toISOString(),
    ...(moveMiddle ? { title: "合成事件 b 已更新", lat: 22.63, lng: 120.3 } : {}),
  }), event("old", { lat: null, lng: null, region: "臺南市", timestamp: new Date(now.getTime() - 4 * 86400000).toISOString() })];
  for (let i = 3; i < count; i++) events.push(event(`extra-${i}`, { lat: null, lng: null }));
  if (boundary) {
    const lng = (x: number) => x / 65536 * 360 - 180;
    events.splice(0, events.length, event("a", { lng: lng(54464 - 0.1) }), event("b", { lng: lng(54464 - 0.1) }),
      event("old", { lng: lng(54464 + 0.1) }), event("edge", { lng: lng(54464 + 0.1) }));
  }
  const international = [event("world", { scope: "international", category: "金融", region: "日本" })];
  const network = { snapshotId: version, rulesVersion: "fixture-v1", generatedAt: now.toISOString(),
    domestic: { nodes: [], edges: [{ a: "a", b: "b", type: "same-entity", weight: 0.7, why: "合成關聯" },
      { a: "b", b: "old", type: "same-entity", weight: 0.6, why: "合成關聯" }],
      clusters: [{ id: "group", members: ["a", "b", "old"], size: 3, representativeTitle: "合成情報群", sourceCount: 3 }], stats: {} },
    international: { nodes: [], edges: [], clusters: [], stats: {} },
  };
  const bodies: Record<string, string> = { "domestic.json": JSON.stringify(events), "domestic.map.json": JSON.stringify(events),
    "international.json": JSON.stringify(international), "international.map.json": JSON.stringify(international),
    "network.json": JSON.stringify(network) };
  const manifest = { manifestVersion: 1, snapshotId: version, rulesVersion: "fixture-v1", generatedAt: now.toISOString(),
    scopes: { domestic: { events: "domestic.json", map: "domestic.map.json", network: "network.json" },
      international: { events: "international.json", map: "international.map.json", network: "network.json" } },
    files: Object.fromEntries(Object.entries(bodies).map(([path, body]) => [path, {
      path, bytes: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex"),
    }])),
  };
  return { bodies, manifest };
}

async function fixture(page: Page, count = 3, boundary = false) {
  let current = snapshot("one", count, false, boundary);
  let failProvenance = false;
  let provenanceRequests = 0;
  const fileRequests: Record<string, number> = {};
  await page.addInitScript(() => {
    const original = window.setInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (timeout === 300000 && typeof handler === "function") {
        (window as unknown as { refreshFixture: () => void }).refreshFixture = () => handler(...args);
        return 0;
      }
      return original(handler, timeout, ...args);
    }) as typeof window.setInterval;
    // 手動分頁測試不讓 observer 自動載入下一頁；側欄沿既有 fallback 載入。
    Object.defineProperty(window, "IntersectionObserver", { value: undefined, configurable: true });
  });
  await page.route(/^https:\/\/(?:tile\.openstreetmap\.org|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
  await page.route("**/data/*.json", (route) => {
    const file = new URL(route.request().url()).pathname.split("/").pop()!;
    fileRequests[file] = (fileRequests[file] ?? 0) + 1;
    if (file === "manifest.json") return route.fulfill({ json: current.manifest });
    if (file === "summary.json") return route.fulfill({ json: { generatedAt: now.toISOString(), domestic: "固定摘要", international: "固定摘要" } });
    if (file === "provenance.json") {
      provenanceRequests++;
      if (failProvenance) return route.fulfill({ status: 503 });
      return route.fulfill({ json: { generatedAt: now.toISOString(), sources: [{ name: `來源 ${current.manifest.snapshotId}`, type: "gov-open-data", scope: "domestic", count: 3, fetchedAt: now.toISOString() }] } });
    }
    if (file.startsWith("police-hourly")) return route.fulfill({ json: { runs: [] } });
    if (current.bodies[file]) return route.fulfill({ body: current.bodies[file], contentType: "application/json" });
    return route.fulfill({ status: 404 });
  });
  return { update: () => { current = snapshot("two", count, true, boundary); },
    fail: (value: boolean) => { failProvenance = value; },
    provenanceRequests: () => provenanceRequests, fileRequests };
}
const refresh = (page: Page) => page.evaluate(() => (window as unknown as { refreshFixture: () => void }).refreshFixture());
const ready = (page: Page) => expect(page.locator("#count")).toHaveText(/^[1-9]/);

test("全部時間能往返網址；無 hash 仍為近三天；不屬於 scope 的分類被丟棄", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await ready(page);
  await expect(page.locator("#f-range")).toHaveValue("3");
  await page.locator("#f-range").selectOption("");
  await expect(page).toHaveURL(/since=all/);
  await page.reload();
  await ready(page);
  await expect(page.locator("#f-range")).toHaveValue("");
  await expect(page.locator('#eventlist [data-id="old"]')).toBeVisible();
  await page.goto("/#scope=international&category=" + encodeURIComponent("治安"));
  await expect(page.locator("#eventlist")).toContainText("合成事件 world");
  await expect(page.locator("#f-cat")).toHaveValue("");
});

test("KPI 再點取消風險；事件地區入口同步下拉與晶片", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await ready(page);
  const kpi = page.locator('[data-kpi-action="filter-elevated"]');
  await kpi.click();
  await expect(page.locator("#f-risk")).toHaveValue("high");
  await kpi.click();
  await expect(page.locator("#f-risk")).toHaveValue("");
  await page.locator('#eventlist [data-id="b"] .filter-region-btn').click();
  await expect(page.locator("#f-region")).toHaveValue("臺中市");
  await expect(page.locator("#region-chip-slot")).toContainText("臺中市");
});

test("情報群套用篩選，零筆提供清除入口；時間軸按鈕可儲存日期及取消", async ({ page }) => {
  await fixture(page);
  await page.goto("/#scope=domestic&cluster=group&since=all");
  await expect(page.locator("#eventlist .event-card")).toHaveCount(3);
  await page.locator("#f-cat").selectOption("災防");
  await expect(page.locator("#eventlist .event-card")).toHaveCount(1);
  await page.locator("#f-risk").selectOption("high");
  await expect(page.locator("#focusbar")).toContainText("沒有符合目前篩選條件");
  await page.getByRole("button", { name: "清除篩選", exact: true }).click();
  await expect(page.locator("#eventlist .event-card")).toHaveCount(3);
  await page.locator("#clear-focus").click();
  const today = page.locator("#timeline button[data-day]").last();
  await today.focus();
  await today.press("Enter");
  await expect(page).toHaveURL(/day=\d{4}-\d{2}-\d{2}/);
  await expect(page.locator("#eventlist .event-card")).toHaveCount(1);
  await page.reload();
  await expect(page.locator("#timeline button[aria-pressed=true]")).toHaveCount(1);
  await page.locator("#timeline button[aria-pressed=true]").press("Space");
  await expect(page).not.toHaveURL(/day=/);
});

test("失效 focus 顯示提示並移除 hash；舊事件放寬時間並說明缺少座標", async ({ page }) => {
  await fixture(page);
  await page.goto("/#scope=domestic&focus=missing-fixture");
  await expect(page.locator("#focusbar")).toContainText("此事件不在目前快照或時間範圍內");
  await expect(page).not.toHaveURL(/focus=/);
  await page.getByRole("button", { name: "返回清單", exact: true }).click();
  await expect(page.locator("#eventlist")).toContainText("合成事件 a");
  await page.goto("/#scope=domestic&focus=old&since=3");
  await expect(page.locator('#eventlist [data-id="old"]')).toBeVisible();
  await expect(page.locator("#f-range")).toHaveValue("");
  await expect(page.locator("#map-focus-notice")).toHaveText("此事件沒有可標示的座標");
  await expect(page).toHaveURL(/since=all/);
  await page.reload();
  await expect(page.locator("#f-range")).toHaveValue("");
  await expect(page.locator('#eventlist [data-id="old"]')).toBeVisible();
});

test("搜尋 debounce 尚未完成就聚焦收件匣，後續搜尋更新仍保留關聯圖", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  await fixture(page);
  await page.goto("/#scope=domestic&since=all");
  await ready(page);
  // 同一個 task 先輸入再點擊，確保 focus 發生在 200ms debounce 之前。
  await page.evaluate(() => {
    const search = document.getElementById("mq-query") as HTMLInputElement;
    search.value = "合成事件 a";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    (document.querySelector('#triageinbox .triage-row[data-id="a"]') as HTMLButtonElement).click();
  });
  await page.clock.runFor(250);
  await expect(page).toHaveURL(/focus=a/);
  await expect(page.locator("#f-query")).toHaveValue("合成事件 a");
  await expect(page.locator("#focusbar")).toContainText("合成事件 a");
  await expect(page.locator("#relationgraph")).toBeVisible();
});

test("手機本頁定位切換到地圖，定位後不被 reveal 重設縮放", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto("/");
  await ready(page);
  await page.locator('#eventlist [data-id="a"] .locate-on-page-btn').click();
  await expect(page.locator("body")).toHaveClass(/mobile-view-map/);
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator(".leaflet-popup")).toContainText("合成事件 a");
  // 國內 fit 上限是 8；定位至少 14，14 之後不應要求低於 zoom 14 的圖磚。
  const zoom = await page.locator('.leaflet-tile-container').last().getAttribute("style");
  await page.waitForTimeout(600);
  await expect(page.locator(".leaflet-popup")).toContainText("合成事件 a");
  expect(await page.locator('.leaflet-tile-container').last().getAttribute("style")).toBe(zoom);
});

test("側欄失敗後能以按鈕或再次展開恢復；新快照讓開啟面板重繪", async ({ page }) => {
  const data = await fixture(page);
  data.fail(true);
  await page.goto("/");
  await ready(page);
  const health = page.locator('[data-side-section="policehealth"]');
  const sources = page.locator('[data-side-section="sourcepanel"]');
  await health.locator("summary").first().click();
  await sources.locator("summary").first().click();
  await expect(page.locator("#policehealth")).toContainText("請重試");
  await expect(page.locator("#sourcepanel")).toContainText("請重試");
  data.fail(false);
  await page.getByRole("button", { name: "重新載入健康資料", exact: true }).click();
  await sources.locator("summary").first().click();
  await sources.locator("summary").first().click();
  await expect(page.locator("#sourcepanel")).toContainText("來源 one");
  await expect(page.locator("#policehealth .police-health-card").first()).toBeVisible();
  const before = data.provenanceRequests();
  data.update();
  await refresh(page);
  await expect(page.locator("#sourcepanel")).toContainText("來源 two");
  expect(data.provenanceRequests()).toBeGreaterThan(before);
});

test("摘要不變也輪詢 manifest；同版保留分頁，新版重畫中間事件的地圖", async ({ page }) => {
  const data = await fixture(page, 120);
  await page.goto("/#scope=domestic&since=all");
  await ready(page);
  await expect(page.locator("#eventlist .event-card")).toHaveCount(50);
  await page.locator("#eventlist .load-more-btn").click();
  await expect(page.locator("#eventlist .event-card")).toHaveCount(100);
  await expect(page.locator(".map-cluster-hit")).toHaveCount(1);
  const eventRequests = data.fileRequests["domestic.json"];
  const networkRequests = data.fileRequests["network.json"];
  await refresh(page);
  await expect.poll(() => data.fileRequests["manifest.json"]).toBeGreaterThan(1);
  await expect(page.locator("#eventlist .event-card")).toHaveCount(100);
  expect(data.fileRequests["domestic.json"]).toBe(eventRequests);
  expect(data.fileRequests["network.json"]).toBe(networkRequests);
  data.update();
  await refresh(page);
  await expect(page.locator("#eventlist")).toContainText("合成事件 b 已更新");
  await expect(page.locator(".map-cluster-hit")).toHaveCount(0);
  await expect(page.locator("#eventlist .event-card")).toHaveCount(100);
  expect(data.fileRequests["network.json"]).toBeGreaterThan(networkRequests);
});

test("關聯核心節點支援預覽與鍵盤，背景 refresh 保留圖例狀態和預覽", async ({ page }) => {
  await fixture(page);
  await page.goto("/#scope=domestic&focus=a&since=all");
  const center = page.locator("#relationgraph .rg-center-g");
  const directEdges = page.locator("#relationgraph .rg-edge:not(.rg-subedge)");
  await center.hover();
  await expect(center).toHaveClass(/is-active/);
  await expect(directEdges).toHaveCount(1);
  await expect(directEdges).toHaveClass(/is-active/);
  await page.mouse.move(0, 0);
  await expect(center).not.toHaveClass(/is-active/);
  await center.focus();
  await expect(center).toHaveClass(/is-active/);
  await expect(directEdges).toHaveClass(/is-active/);
  await center.press("Space");
  await expect(center).toHaveClass(/is-active/);
  await center.click();
  await expect(page.locator("#relationgraph .rg-preview")).toContainText("合成事件 a");
  await page.locator('#relationgraph [data-type="same-entity"]').click();
  await refresh(page);
  await expect(page.locator('#relationgraph [data-type="same-entity"]')).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#relationgraph .rg-preview")).toContainText("合成事件 a");
  await center.focus();
  await center.press("Enter");
  await expect(page.locator("#relationgraph .rg-preview")).toContainText("中心事件");
});


test("相鄰網格邊界的兩顆聚合標記都能直接點擊，命中區不互相攔截", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fixture(page, 3, true);
  await page.goto("/#scope=domestic&since=all");
  await ready(page);
  await expect(page.locator(".map-cluster-hit")).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await page.locator(".map-cluster-hit").nth(i).click();
    await expect(page.locator(".leaflet-popup")).toContainText("此區有 2 則情報");
    await page.locator(".leaflet-popup-close-button").click();
    await expect(page.locator(".map-cluster-hit")).toHaveCount(2);
  }
});


test("日期優先於網址 since，切時間清日期，取消日期還原原時間範圍", async ({ page }) => {
  await fixture(page);
  await page.goto("/#scope=domestic&since=5");
  await ready(page);
  const oldest = page.locator("#timeline button[data-day]").first();
  const day = await oldest.getAttribute("data-day");
  await oldest.click();
  await expect(page.locator('#eventlist [data-id="old"]')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`since=all&day=${day}`));
  await expect(page.locator("#f-range")).toHaveValue("");
  await page.locator("#f-range").selectOption("3");
  await expect(page).not.toHaveURL(/day=/);
  await expect(page).toHaveURL(/since=3/);
  await expect(page.locator("#timeline button[aria-pressed=true]")).toHaveCount(0);
  await expect(page.locator('#eventlist [data-id="old"]')).toHaveCount(0);
  await page.locator("#f-range").selectOption("5");
  await oldest.click();
  await oldest.click();
  await expect(page.locator("#f-range")).toHaveValue("5");
  await expect(page).toHaveURL(/since=5/);
  await expect(page).not.toHaveURL(/day=/);
  await oldest.click();
  await page.locator('#filter-summary [data-clear-filter="day"]').click();
  await expect(page.locator("#f-range")).toHaveValue("5");
  await expect(page).not.toHaveURL(/day=/);
  await page.goto(`/#scope=domestic&since=1&day=${day}`);
  await expect(page.locator('#eventlist [data-id="old"]')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`since=all&day=${day}`));
  await page.reload();
  await expect(page.locator('#eventlist [data-id="old"]')).toBeVisible();
  await page.locator("#timeline button[aria-pressed=true]").click();
  await expect(page.locator("#f-range")).toHaveValue("3");
  await expect(page).toHaveURL(/since=3/);
  await expect(page).not.toHaveURL(/day=/);
});

for (const [id, value] of [["f-cat", "治安"], ["f-risk", "high"], ["f-region", "臺中市"],
  ["f-range", "5"], ["f-authority", "media"], ["f-query", "合成事件 a"]]) {
  test(`失效 focus 後變更 ${id} 能回到一般篩選清單`, async ({ page }) => {
    await fixture(page);
    await page.goto("/#scope=domestic&focus=missing-fixture");
    await expect(page.locator("#focusbar")).toContainText("此事件不在目前快照或時間範圍內");
    if (id === "f-query") await page.locator(`#${id}`).fill(value);
    else await page.locator(`#${id}`).selectOption(value);
    await expect(page.locator("#focusbar")).toBeHidden();
    await expect(page.locator("#eventlist")).not.toContainText("此事件不在目前快照或時間範圍內");
    if (id !== "f-authority") await expect(page.locator("#eventlist .event-card").first()).toBeVisible();
    await expect(page).not.toHaveURL(/focus=/);
  });
}

test("兩個失敗側欄的按鈕重試成功後，收合展開均不重複請求", async ({ page }) => {
  const data = await fixture(page);
  data.fail(true);
  await page.goto("/");
  await ready(page);
  const sections = [page.locator('[data-side-section="policehealth"]'), page.locator('[data-side-section="sourcepanel"]')];
  for (const section of sections) await section.locator("summary").first().click();
  await expect(page.locator("#policehealth [data-reload-health]")).toBeVisible();
  await expect(page.locator("#sourcepanel [data-retry-source]")).toBeVisible();
  data.fail(false);
  await page.locator("#policehealth [data-reload-health]").click();
  // 側欄失效重繪可能已先讓來源面板自行恢復，重試按鈕隨之消失；只在按鈕仍在時點擊。
  await page.locator("#sourcepanel [data-retry-source]").click({ timeout: 2_000 }).catch(() => {});
  await expect(page.locator("#policehealth .police-health-card").first()).toBeVisible();
  await expect(page.locator("#sourcepanel")).toContainText("來源 one");
  const before = data.provenanceRequests();
  for (const section of sections) {
    await section.evaluate(async (el) => {
      const details = el as HTMLDetailsElement;
      for (const open of [false, true]) {
        await new Promise<void>((resolve) => {
          details.addEventListener("toggle", () => resolve(), { once: true });
          details.open = open;
        });
      }
    });
  }
  expect(data.provenanceRequests()).toBe(before);
});

test("手機列表可見缺少座標提示，切回地圖沿用相同提示", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto("/#scope=domestic&focus=old&since=all");
  await expect(page.locator("body")).toHaveClass(/mobile-view-list/);
  const notice = page.locator("#focusbar .focus-coordinate-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText("此事件沒有可標示的座標");
  await expect(page.locator("#map-focus-notice")).toBeHidden();
  await page.locator('[data-mobile-view="map"]').click();
  await expect(page.locator("#map-focus-notice")).toBeVisible();
  await expect(page.locator("#map-focus-notice")).toHaveText("此事件沒有可標示的座標");
  await page.locator('[data-mobile-view="list"]').click();
  await expect(notice).toBeVisible();
  await page.locator("#clear-focus").click();
  await expect(notice).toHaveCount(0);
});
