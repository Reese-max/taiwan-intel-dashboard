import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
// @ts-expect-error JS script API
import { preparePreviewData, previewSnapshotContext, PREVIEW_RECEIPT } from "../scripts/prepare-preview-data.mjs";
// @ts-expect-error JS script API
import { buildCohortManifest, writeCohortManifest } from "../scripts/lib/manifest.mjs";
// @ts-expect-error JS script API
import { buildSite } from "../scripts/build-site.mjs";
import { deterministicBrief, SUMMARY_PLACEHOLDER } from "../scripts/lib/summary-quality.mjs";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const clock = "2026-10-24T12:15:52.702Z", publication = "2026-10-24T12:17:41.241Z";
const fixtureEvent = JSON.parse(readFileSync("tests/fixtures/govintel-domestic.json", "utf8"))[0];
function workspace() {
  const root = mkdtempSync(join(tmpdir(), "verified-preview-")), sourceDir = join(root, "source"), outputDir = join(root, "preview");
  mkdirSync(sourceDir);
  const write = (name: string, data: unknown) => writeFileSync(join(sourceDir, name), JSON.stringify(data, null, 2) + "\n");
  const incident = { ...fixtureEvent, id: "owned-preview-news", source: { ...fixtureEvent.source, datasetId: "normal-news" } };
  const reference = { ...incident, id: "owned-preview-reference", source: { ...incident.source, datasetId: "13166" } };
  write("domestic.json", [incident, reference]); write("international.json", []);
  write("network.json", { snapshotId: "cohort-owned-preview", generatedAt: clock });
  write("provenance.json", { generatedAt: clock, sources: [] });
  const original = { domestic: deterministicBrief("國內事件", [incident, incident, reference]), international: SUMMARY_PLACEHOLDER,
    generatedAt: publication, model: "original-model", degraded: { domestic: true, international: false } };
  write("summary.json", original);
  const rebind = () => writeCohortManifest(sourceDir, buildCohortManifest({ dataDir: sourceDir, snapshotId: "cohort-owned-preview", nowIso: clock }));
  rebind();
  const read = (name: string, dir = outputDir) => JSON.parse(readFileSync(join(dir, name), "utf8"));
  return { sourceDir, outputDir, root, write, read, rebind, original, incident, dispose: () => rmSync(root, { recursive: true, force: true }) };
}
const snapshot = (dir: string) => Object.fromEntries(readdirSync(dir).map(name => [name, sha(readFileSync(join(dir, name)))]));

describe("verified preview derivation for the hosted summary-count failure", () => {
  it("repairs only recognized fallback text in a separate copy, preserving raw inputs, clocks, and cohort", () => {
    const f = workspace();
    try {
      const before = snapshot(f.sourceDir), receipt = preparePreviewData(f);
      expect(snapshot(f.sourceDir)).toEqual(before);
      expect(f.read("summary.json")).toEqual({ ...f.original, domestic: deterministicBrief("國內事件", [f.incident]) });
      expect(receipt.source).toMatchObject({ snapshotId: "cohort-owned-preview", generatedAt: clock, summaryGeneratedAt: publication, manifestSha256: before["manifest.json"] });
      expect(receipt.changes).toEqual([expect.objectContaining({ scope: "domestic", incidentCount: 1 })]);
      const manifest = f.read("manifest.json");
      expect(manifest.snapshotId).toBe("cohort-owned-preview"); expect(manifest.generatedAt).toBe(clock);
      for (const [name, record] of Object.entries(manifest.files) as [string, any][]) expect(sha(readFileSync(join(f.outputDir, name)))).toBe(record.sha256);
      expect(previewSnapshotContext(f.outputDir, { BUILD_PREVIEW_SNAPSHOT: "1" })).toEqual({ snapshotId: manifest.snapshotId, generatedAt: clock });
      expect(f.read(PREVIEW_RECEIPT).source.files["summary.json"]).toBe(before["summary.json"]);
    } finally { f.dispose(); }
  });

  it.each(["hash", "network-cohort", "provenance-clock", "invalid-event"])("rejects %s input before creating output", (fault) => {
    const f = workspace();
    try {
      if (fault === "hash") f.write("domestic.json", []);
      if (fault === "network-cohort") { f.write("network.json", { snapshotId: "other", generatedAt: clock }); f.rebind(); }
      if (fault === "provenance-clock") f.write("provenance.json", { generatedAt: publication });
      if (fault === "invalid-event") { f.write("domestic.json", [{ id: "invalid" }]); f.rebind(); }
      expect(() => preparePreviewData(f)).toThrow(); expect(existsSync(f.outputDir)).toBe(false);
    } finally { f.dispose(); }
  });

  it.each(["narrative-count", "unmarked-fallback", "empty-narrative"])("does not rewrite %s to make the audit pass", (fault) => {
    const f = workspace();
    try {
      f.write("summary.json", { ...f.original, domestic: fault === "narrative-count" ? "國內事件共 3 起，治安事件需要關注。" : fault === "empty-narrative" ? "" : f.original.domestic, degraded: false });
      f.rebind(); const before = snapshot(f.sourceDir);
      expect(() => preparePreviewData(f)).toThrow(); expect(snapshot(f.sourceDir)).toEqual(before); expect(existsSync(f.outputDir)).toBe(false);
    } finally { f.dispose(); }
  });

  it("keeps a valid AI narrative byte-for-byte and derives no replacement", () => {
    const f = workspace();
    try {
      f.write("summary.json", { ...f.original, domestic: "國內事件共 1 起，治安事件需要關注。", degraded: false }); f.rebind();
      const before = readFileSync(join(f.sourceDir, "summary.json"));
      expect(preparePreviewData(f).changes).toEqual([]); expect(readFileSync(join(f.outputDir, "summary.json"))).toEqual(before);
    } finally { f.dispose(); }
  });

  it("rejects a changed prepared input and cannot write through an alias into the restored source", () => {
    const f = workspace();
    try {
      symlinkSync(f.sourceDir, join(f.root, "alias"), "dir");
      expect(() => preparePreviewData({ sourceDir: f.sourceDir, outputDir: join(f.root, "alias", "derived") })).toThrow(/separate/);
      preparePreviewData(f); writeFileSync(join(f.outputDir, "summary.json"), "{}");
      expect(() => previewSnapshotContext(f.outputDir, { BUILD_PREVIEW_SNAPSHOT: "1" })).toThrow(/hash mismatch|input changed/);
      expect(previewSnapshotContext(f.outputDir, {})).toBeNull();
    } finally { f.dispose(); }
  });

  it("rejects a descendant named '..preview' without writing inside the restored source", () => {
    const f = workspace();
    try {
      const before = snapshot(f.sourceDir), outputDir = join(f.sourceDir, "..preview");
      expect(() => preparePreviewData({ sourceDir: f.sourceDir, outputDir })).toThrow(/separate/);
      expect(existsSync(outputDir)).toBe(false);
      expect(snapshot(f.sourceDir)).toEqual(before);
    } finally { f.dispose(); }
  });

  it("preserves the verified source clocks and identity when rebuilding the preview network", () => {
    const f = workspace();
    try {
      preparePreviewData(f);
      execFileSync(process.execPath, ["scripts/build-network.mjs"], { env: { ...process.env, BUILD_DATA_DIR: f.outputDir, BUILD_PREVIEW_SNAPSHOT: "1" }, stdio: "pipe" });
      expect(f.read("network.json")).toMatchObject({ snapshotId: "cohort-owned-preview", generatedAt: clock });
      expect(f.read("manifest.json")).toMatchObject({ snapshotId: "cohort-owned-preview", generatedAt: clock });
      expect(previewSnapshotContext(f.outputDir, { BUILD_PREVIEW_SNAPSHOT: "1" })).not.toBeNull();
    } finally { f.dispose(); }
  });

  it("enables retained-cohort build only by explicit option, never ambient environment", () => {
    const f = workspace();
    try {
      const environments: any[] = [], spawn = (_exe: unknown, _args: unknown, options: any) => { environments.push(options.env); return { status: 0 }; };
      buildSite({ prepareOptions: { dataDir: f.sourceDir }, env: { BUILD_PREVIEW_SNAPSHOT: "1" }, spawn });
      expect(environments.every(env => env.BUILD_PREVIEW_SNAPSHOT === undefined)).toBe(true);
      environments.length = 0;
      buildSite({ prepareOptions: { dataDir: f.sourceDir }, env: {}, spawn, previewSnapshot: true });
      expect(environments.every(env => env.BUILD_PREVIEW_SNAPSHOT === "1")).toBe(true);
    } finally { f.dispose(); }
  });
});
