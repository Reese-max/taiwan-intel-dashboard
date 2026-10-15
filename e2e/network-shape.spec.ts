import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";

type Mutable = Record<string, unknown>;
function cohort(id: string, mutate?: (body: Mutable) => void, ready = false) {
  const now = new Date().toISOString();
  const events = JSON.stringify(["center", "neighbor"].map((eventId, i) => ({
    id: eventId, title: `${id}-${eventId}`, summary: "owned malformed-contract fixture", region: "臺北市",
    timestamp: now, category: "治安", scope: "domestic", riskLevel: "high", lat: 25.03 - i, lng: 121.56 - i,
    locationPrecision: "city", source: { name: eventId, type: "news-rss", url: `https://example.invalid/${eventId}`, fetchedAt: now },
  })));
  const network: Mutable = {
    snapshotId: id, generatedAt: now, rulesVersion: "fixture-v1",
    domestic: { edges: ready ? [{ a: "center", b: "neighbor", type: "same-entity", weight: 1, why: "owned relation" }] : [], clusters: [], stats: {} },
    international: { edges: [], clusters: [], stats: {} },
  };
  mutate?.(network);
  const bodies: Record<string, string> = {
    "domestic.json": events, "domestic.map.json": events,
    "international.json": "[]", "international.map.json": "[]", "network.json": JSON.stringify(network),
  };
  const manifest = {
    manifestVersion: 1, snapshotId: id, generatedAt: now, rulesVersion: "fixture-v1",
    scopes: {
      domestic: { events: "domestic.json", map: "domestic.map.json", network: "network.json" },
      international: { events: "international.json", map: "international.map.json", network: "network.json" },
    },
    // The malformed bytes have the correct manifest hash: these controls reach
    // runtime shape validation instead of passing through a hash-mismatch path.
    files: Object.fromEntries(Object.entries(bodies).map(([path, body]) => [path, {
      path, sha256: createHash("sha256").update(body).digest("hex"), bytes: Buffer.byteLength(body),
    }])),
  };
  return { bodies, manifest };
}

test.beforeEach(async ({ page }) => { await page.route(/^https:\/\//, route => route.abort()); });
const invalid = [
  { label: "missing arrays", mutate: (body: Mutable) => { body.domestic = {}; } },
  { label: "object edges", mutate: (body: Mutable) => { (body.domestic as Mutable).edges = {}; } },
  { label: "missing cluster members", mutate: (body: Mutable) => { (body.domestic as Mutable).clusters = [{ id: "c1", size: 1 }]; } },
  { label: "numeric snapshot", mutate: (body: Mutable) => { body.snapshotId = 2; } },
];
for (const { label, mutate } of invalid) {
  test(`malformed ${label} preserves news, announces error and recovers as one cohort`, async ({ page }) => {
    let current = cohort("owned-s2", mutate);
    let networkRequests = 0;
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.route("**/data/*.json", route => {
      const file = new URL(route.request().url()).pathname.split("/").pop()!;
      if (file === "manifest.json") return route.fulfill({ json: current.manifest });
      if (file === "network.json") networkRequests++;
      return current.bodies[file] !== undefined
        ? route.fulfill({ body: current.bodies[file], contentType: "application/json" })
        : route.fulfill({ status: 404 });
    });
    await page.goto("/#scope=domestic&focus=center", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#eventlist")).toContainText("owned-s2-center");
    await expect(page.locator("#eventlist")).not.toContainText("owned-s2-neighbor");
    const notice = page.locator("#relation-notice");
    await expect(notice).toContainText("格式");
    await expect(notice).toHaveAttribute("role", "status");
    await expect(notice).toHaveAttribute("aria-live", "polite");
    expect(networkRequests).toBe(2); // first attempt plus the existing single automatic retry
    current = cohort("owned-s3", undefined, true);
    await page.locator("#retry-network-btn").click();
    await expect(page.locator("#eventlist")).toContainText("owned-s3-center");
    await expect(page.locator("#eventlist")).toContainText("owned-s3-neighbor");
    await expect(notice).toBeHidden();
    expect(networkRequests).toBe(3);
    expect(pageErrors).toEqual([]);
  });
}
for (const ready of [false, true]) {
  test(`valid ${ready ? "legacy no-nodes relationships" : "zero relationships"} retains its distinct state`, async ({ page }) => {
    const current = cohort("owned-valid", undefined, ready);
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.route("**/data/*.json", route => {
      const file = new URL(route.request().url()).pathname.split("/").pop()!;
      if (file === "manifest.json") return route.fulfill({ json: current.manifest });
      return current.bodies[file] !== undefined
        ? route.fulfill({ body: current.bodies[file], contentType: "application/json" })
        : route.fulfill({ status: 404 });
    });
    await page.goto("/#scope=domestic&focus=center", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#eventlist")).toContainText("owned-valid-center");
    if (ready) await expect(page.locator("#eventlist")).toContainText("owned-valid-neighbor");
    else await expect(page.locator("#eventlist")).not.toContainText("owned-valid-neighbor");
    await expect(page.locator("#relation-notice")).toBeHidden();
    expect(pageErrors).toEqual([]);
  });
}

test("plain/search/subnet/triage flows remain usable during relation failure and recover together", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let current = cohort("owned-error", body => { body.domestic = {}; });
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/data/*.json", route => {
    const file = new URL(route.request().url()).pathname.split("/").pop()!;
    if (file === "manifest.json") return route.fulfill({ json: current.manifest });
    return current.bodies[file] !== undefined
      ? route.fulfill({ body: current.bodies[file], contentType: "application/json" })
      : route.fulfill({ status: 404 });
  });
  await page.goto("/#scope=domestic", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".col-side")).toBeHidden();
  const notice = page.locator("#relation-notice");
  await expect(notice).toContainText("格式");
  await expect(page.locator("#eventlist .event-card")).toHaveCount(2);
  await expect(page.locator("#triageinbox .triage-row")).toHaveCount(2);

  await page.locator("#mq-query").fill("center");
  await expect(page.locator("#eventlist .event-card")).toHaveCount(1);
  await expect(page.locator("#eventlist")).toContainText("owned-error-center");
  await expect(page.locator("#triageinbox .triage-row")).toHaveCount(1);
  await expect(notice).toBeVisible();
  if (!await page.locator('#triageinbox .triage-row[data-id="center"]').isVisible()) {
    await page.locator("#triageinbox summary").click();
  }
  await page.locator('#triageinbox .triage-row[data-id="center"]').click();
  await expect(page.locator("#focusbar")).toBeVisible();
  await expect(page.locator('#triageinbox .triage-row[data-id="center"]')).not.toHaveClass(/is-unread/);
  await expect(page.locator("#relationgraph")).toBeHidden();
  await page.locator("#clear-focus").click();
  await page.locator("#mq-query").fill("");
  await expect(page.locator("#eventlist .event-card")).toHaveCount(2);
  await expect(notice).toBeVisible();

  current = cohort("owned-recovered", undefined, true);
  await page.locator("#retry-network-btn").click();
  await expect(page.locator("#eventlist")).toContainText("owned-recovered-center");
  await expect(notice).toBeHidden();
  await page.locator("#mq-query").fill("center");
  // A verified relation can again extend a direct search match into its subnet.
  await expect(page.locator("#eventlist .event-card")).toHaveCount(2);
  await expect(page.locator("#eventlist")).toContainText("owned-recovered-neighbor");
  await expect(page.locator("#triageinbox .triage-row")).toHaveCount(2);
  await expect(page.locator('#triageinbox .triage-row[data-id="center"]')).not.toHaveClass(/is-unread/);
  await page.locator('#triageinbox .triage-row[data-id="neighbor"]').click();
  await expect(page.locator("#focusbar")).toBeVisible();
  await expect(page.locator("#relationgraph")).toBeVisible();
  await page.locator("#clear-focus").click();
  await page.locator("#mq-query").fill("");
  await expect(page.locator("#eventlist .event-card")).toHaveCount(2);
  expect(pageErrors).toEqual([]);
});
