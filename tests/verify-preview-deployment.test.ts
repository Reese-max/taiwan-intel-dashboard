import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error JavaScript module
import { previewOrigin, verifyPreviewArtifact } from "../scripts/verify-preview-deployment.mjs";
// @ts-expect-error JavaScript module
import { deterministicBrief } from "../scripts/lib/summary-quality.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "preview-binding-")); mkdirSync(join(dir, "data"));
  const events = [{ id: "owned", title: "t", region: "臺北市", timestamp: "2026-10-24T00:00:00Z", category: "治安", summary: "s", scope: "domestic", riskLevel: "low", source: { name: "n", fetchedAt: "2026-10-24T00:00:00Z", datasetId: "tw-news" } }];
  const content: Record<string, string> = { "index.html": "<h1>owned</h1>", "data/manifest.json": JSON.stringify({ snapshotId: "owned-cohort" }), "data/provenance.json": "{}", "data/domestic.json": JSON.stringify(events), "data/international.json": "[]", "data/summary.json": JSON.stringify({ domestic: deterministicBrief("國內事件", events), international: "（暫無資料）", degraded: { domestic: true } }) };
  for (const [file, bytes] of Object.entries(content)) writeFileSync(join(dir, file), bytes);
  let calls = 0;
  return { dir, content, get calls() { return calls; }, fetcher: async (url: string, options: { redirect: string }) => { calls++; expect(options.redirect).toBe("error"); const path = new URL(url).pathname.slice(1); return new Response(content[path || "index.html"] ?? content[`${path}.html`], { status: 200 }); }, close: () => rmSync(dir, { recursive: true, force: true }) };
}
const url = "https://a1b2c3d4.taiwan-intel-dashboard.pages.dev/";
describe("exact Preview acceptance", () => {
  it("refuses production, branch aliases, other hosts and credential-bearing URLs before any request", async () => {
    for (const bad of ["https://taiwan-intel-dashboard.pages.dev/", "https://pr-81.taiwan-intel-dashboard.pages.dev/", "https://example.com/", "https://u:p@a1b2c3d4.taiwan-intel-dashboard.pages.dev/", `${url}?token=x`, `${url}nested/`, "http://127.0.0.1:4173/"]) expect(() => previewOrigin(bad)).toThrow();
    expect(previewOrigin(url)).toBe(url.slice(0, -1));
  });
  it("accepts all original artifact bytes with truthful incident count", async () => {
    const f = fixture(); try { const receipt = await verifyPreviewArtifact({ url, dist: f.dir, fetcher: f.fetcher }); expect(receipt.counts).toEqual({ domestic: 1, international: 0 }); expect(Object.keys(receipt.files)).toHaveLength(6); expect(f.calls).toBe(6); } finally { f.close(); }
  });
  it.each(["index.html", "data/summary.json", "data/domestic.json"])("rejects changed remote bytes: %s", async (file) => {
    const f = fixture(); try { f.content[file] = f.content[file].replace(/./, "X"); await expect(verifyPreviewArtifact({ url, dist: f.dir, fetcher: f.fetcher })).rejects.toThrow(/bytes differ/); } finally { f.close(); }
  });
  it("rejects a count mismatch even when remote bytes match the built artifact", async () => {
    const f = fixture(); try { const bad = JSON.parse(f.content["data/summary.json"]); bad.domestic = bad.domestic.replace("共 1 起", "共 2 起"); f.content["data/summary.json"] = JSON.stringify(bad); writeFileSync(join(f.dir, "data/summary.json"), f.content["data/summary.json"]); await expect(verifyPreviewArtifact({ url, dist: f.dir, fetcher: f.fetcher })).rejects.toThrow(/fallback-count-mismatch/); } finally { f.close(); }
  });
  it("rejects HTTP success with an oversized body and rejects missing files", async () => {
    const f = fixture(); try { await expect(verifyPreviewArtifact({ url, dist: f.dir, fetcher: async () => new Response("x".repeat(10000)) })).rejects.toThrow(/exceeds/); rmSync(join(f.dir, "data/summary.json")); await expect(verifyPreviewArtifact({ url, dist: f.dir, fetcher: f.fetcher })).rejects.toThrow(/Missing preview artifact/); } finally { f.close(); }
  });
  it("rejects artifact symlinks before any network request", async () => {
    const f = fixture(); try { symlinkSync(join(f.dir, "index.html"), join(f.dir, "outside")); await expect(verifyPreviewArtifact({ url, dist: f.dir, fetcher: f.fetcher })).rejects.toThrow(/Symlink/); expect(f.calls).toBe(0); } finally { f.close(); }
  });
  it("records Pages control-file hashes without pretending they are public HTTP files", async () => {
    const f = fixture(); try { writeFileSync(join(f.dir, "_headers"), "/*\n  X-Content-Type-Options: nosniff\n"); const receipt = await verifyPreviewArtifact({ url, dist: f.dir, fetcher: f.fetcher }); expect(receipt.configurationFiles._headers).toMatch(/^[a-f0-9]{64}$/); expect(receipt.files._headers).toBeUndefined(); expect(f.calls).toBe(6); writeFileSync(join(f.dir, "_worker.js"), "export default {}"); await expect(verifyPreviewArtifact({ url, dist: f.dir, fetcher: f.fetcher })).rejects.toThrow(/Dynamic Preview/); } finally { f.close(); }
  });
});
