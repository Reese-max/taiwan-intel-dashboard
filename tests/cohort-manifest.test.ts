import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCohortManifest, writeCohortManifest } from "../scripts/lib/manifest.mjs";
import { loadManifest, type CohortManifest } from "../src/data/manifest";

const TEMP_DIR = join(process.cwd(), "temp-test-manifest");

afterEach(() => {
  vi.restoreAllMocks();
  if (existsSync(TEMP_DIR)) rmSync(TEMP_DIR, { recursive: true, force: true });
});

describe("Cohort Manifest (Work package D2)", () => {
  it("建立 manifest 正確計算檔案雜湊與快照 ID", () => {
    mkdirSync(TEMP_DIR, { recursive: true });
    writeFileSync(join(TEMP_DIR, "domestic.json"), JSON.stringify([{ id: "e1" }, { id: "e2" }]));
    writeFileSync(join(TEMP_DIR, "international.json"), JSON.stringify([{ id: "i1" }]));
    writeFileSync(join(TEMP_DIR, "network.json"), JSON.stringify({ snapshotId: "cohort-fixed-123" }));

    const manifest = buildCohortManifest({
      dataDir: TEMP_DIR,
      nowIso: "2026-09-17T00:00:00.000Z",
    });

    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.snapshotId).toBe("cohort-fixed-123");
    expect(manifest.rulesVersion).toBe("correlate-v1");
    expect(manifest.scopes.domestic.eventCount).toBe(2);
    expect(manifest.scopes.international.eventCount).toBe(1);
    expect(manifest.files["domestic.json"]?.sha256).toBeDefined();
    expect(manifest.files["domestic.json"]?.count).toBe(2);

    writeCohortManifest(TEMP_DIR, manifest);
    expect(existsSync(join(TEMP_DIR, "manifest.json"))).toBe(true);
  });

  it("前端 loadManifest 成功載入並驗證 snapshotId", async () => {
    const fakeManifest: CohortManifest = {
      manifestVersion: 1,
      snapshotId: "cohort-manifest-1",
      generatedAt: "2026-09-17T00:00:00.000Z",
      rulesVersion: "correlate-v1",
      scopes: {
        domestic: { events: "domestic.json", map: "domestic.map.json", network: "network.json" },
        international: { events: "international.json", map: "international.map.json", network: "network.json" },
      },
      files: {},
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => fakeManifest,
    } as Response);

    const loaded = await loadManifest();
    expect(loaded?.snapshotId).toBe("cohort-manifest-1");
    expect(loaded?.manifestVersion).toBe(1);
  });

  it("manifest 請求失敗或內容不合法時回傳 null，不中斷前端", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const loaded404 = await loadManifest();
    expect(loaded404).toBeNull();

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ manifestVersion: 999 }),
    } as Response);

    const loadedBadVersion = await loadManifest();
    expect(loadedBadVersion).toBeNull();

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network offline"));
    const loadedOffline = await loadManifest();
    expect(loadedOffline).toBeNull();
  });
});
