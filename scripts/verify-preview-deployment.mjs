import { createHash } from "node:crypto";
import { readdirSync, readFileSync, lstatSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditSummary } from "./lib/summary-quality.mjs";
import { isReferenceEvent, validateEventContract } from "./lib/event-contract.mjs";
import { validateRemovedRouteResponse, validateSearchResponse } from "./smoke-deployed.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function previewOrigin(value, allowLocal = false) {
  const url = new URL(value);
  const local = allowLocal && url.protocol === "http:" && url.hostname === "127.0.0.1";
  const preview = url.protocol === "https:" && /^[a-f0-9]{8}\.taiwan-intel-dashboard\.pages\.dev$/.test(url.hostname) && !url.port;
  if ((!preview && !local) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Expected an immutable dashboard Preview origin");
  return url.origin;
}

function filesIn(dir, prefix = "") {
  return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symlink in preview artifact: ${path}`);
    return entry.isDirectory() ? filesIn(dir, path) : [path];
  });
}

async function boundedBody(response, limit) {
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) { await response.body.cancel?.().catch(() => {}); throw new Error("Preview response exceeds artifact length"); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function verifyPreviewArtifact({ url, dist, fetcher = fetch, allowLocal = false }) {
  const origin = previewOrigin(url, allowLocal), root = resolve(dist);
  if (!lstatSync(root).isDirectory()) throw new Error("Preview artifact must be a directory");
  const allFiles = filesIn(root).sort(), verified = {}, configurationFiles = {};
  const controls = new Set(["_headers", "_redirects", "_routes.json", "_worker.js"]);
  // 單檔 _worker.js 由下方執行期檢查驗證；目錄形式的 Worker 尚無對應驗證。
  if (allFiles.some((file) => file.startsWith("_worker.js/"))) throw new Error("Dynamic Preview artifacts need separate runtime verification");
  const files = allFiles.filter((file) => !controls.has(file));
  for (const file of allFiles.filter((file) => controls.has(file))) configurationFiles[file] = hash(readFileSync(join(root, file)));
  for (const required of ["index.html", "data/manifest.json", "data/provenance.json", "data/summary.json", "data/domestic.json", "data/international.json"]) {
    if (!files.includes(required)) throw new Error(`Missing preview artifact: ${required}`);
  }
  for (const file of files) {
    const expected = readFileSync(join(root, file));
    const route = file === "index.html" ? "" : file.replace(/\.html$/, "");
    const response = await fetcher(`${origin}/${route.split("/").map(encodeURIComponent).join("/")}`, { redirect: "error", signal: AbortSignal.timeout(20_000), headers: { "cache-control": "no-cache" } });
    if (response.status !== 200 && !(file === "404.html" && response.status === 404)) throw new Error(`Preview ${file}: HTTP ${response.status}`);
    const actual = await boundedBody(response, expected.length);
    if (!actual.equals(expected)) throw new Error(`Preview bytes differ: ${file}`);
    verified[file] = hash(actual);
  }
  const read = (file) => JSON.parse(readFileSync(join(root, "data", file), "utf8"));
  const summary = read("summary.json"), counts = {};
  for (const scope of ["domestic", "international"]) {
    const events = read(`${scope}.json`), contract = validateEventContract(events);
    if (contract.invalid.length) throw new Error(`Invalid published ${scope} events`);
    counts[scope] = contract.valid.filter((event) => !isReferenceEvent(event)).length;
  }
  const audit = auditSummary({ summary, domesticCount: counts.domestic, internationalCount: counts.international });
  if (!audit.ok) throw new Error(`Preview summary audit: ${audit.failures.map((x) => x.code).join(",")}`);
  const runtime = allFiles.includes("_worker.js") ? await verifyWorkerRuntime(origin, fetcher) : undefined;
  return { kind: "IMMUTABLE_PREVIEW_BYTE_VERIFICATION", url: origin, files: verified, configurationFiles, counts, snapshotId: read("manifest.json").snapshotId, ...(runtime ? { runtime } : {}) };
}

// Worker 不是公開靜態檔，改驗執行期：搜尋端點回合約 JSON，已移除的舊 API 仍是 404。
async function verifyWorkerRuntime(origin, fetcher) {
  const options = () => ({ signal: AbortSignal.timeout(20_000), headers: { "cache-control": "no-cache" } });
  const search = await fetcher(`${origin}/api/search?q=${encodeURIComponent("電信")}&days=7`, { ...options(), redirect: "error" });
  let payload = null;
  try { payload = JSON.parse((await boundedBody(search, 1_000_000)).toString("utf8")); } catch { /* 下方統一回報 */ }
  if (!validateSearchResponse(search.status, payload)) throw new Error(`Preview /api/search runtime check failed: HTTP ${search.status}`);
  const health = await fetcher(`${origin}/api/health`, options());
  if (!validateRemovedRouteResponse(health.status)) throw new Error(`Preview api/health: expected 404, got HTTP ${health.status}`);
  return { search: { upstream: payload.upstream, items: payload.items.length }, removedApiHealth: health.status };
}

export async function browserCheck(origin, dist) {
  const { chromium, expect } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  const summary = JSON.parse(readFileSync(join(dist, "data/summary.json"), "utf8"));
  const results = [];
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, locale: "zh-TW", serviceWorkers: "block" });
      await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const page = await context.newPage(), errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${origin}/#scope=domestic`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#eventlist > *").first()).toBeAttached({ timeout: 30_000 });
      for (const scope of ["domestic", "international"]) {
        if (scope === "international") await page.locator('button[data-scope="international"]').click();
        await expect(page.locator("#aibrief .ai-scope-tag")).toHaveText(scope === "domestic" ? "國內全域" : "國際全域");
        const brief = summary[scope].trim();
        await expect(page.locator("#aibrief")).toContainText(!brief || brief === "（暫無資料）" ? "暫無事件資料" : brief, { timeout: 30_000 });
        await expect(page.locator(`button[data-scope="${scope}"]`)).toHaveClass(/active/);
      }
      if (errors.length) throw new Error(`Preview browser errors: ${errors.join("; ")}`);
      results.push({ viewport, scopes: ["domestic", "international"], pageErrors: 0 });
      await context.close();
    }
  } finally { await browser.close(); }
  return results;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).filter((x) => x.includes("=")).map((x) => x.slice(2).split(/=(.*)/s).slice(0, 2)));
  try {
    const result = await verifyPreviewArtifact({ url: args.url, dist: args.dist || "dist", allowLocal: process.argv.includes("--allow-local") });
    result.browser = await browserCheck(result.url, args.dist || "dist");
    result.verifiedAt = new Date().toISOString(); result.codeSha = process.env.GITHUB_SHA || null;
    writeFileSync(args.receipt || "preview-verification.json", JSON.stringify(result, null, 2) + "\n");
    console.log(`Preview verified: ${Object.keys(result.files).length} files, desktop/mobile scopes, snapshot ${result.snapshotId}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
