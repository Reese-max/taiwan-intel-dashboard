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

  it("first-paint 未鎖定 manifest 時 fail-closed，舊 map 不得被 fetch 或晉級", async () => {
    const { loadMapEvents } = await import("../src/data/loader");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await loadMapEvents("domestic");

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("first-paint manifest 缺少 map hash 時 fail-closed，不允許未驗證產物晉級", async () => {
    const { loadMapEvents } = await import("../src/data/loader");
    const manifest: CohortManifest = {
      manifestVersion: 1,
      snapshotId: "cohort-s2",
      generatedAt: "2026-09-17T00:00:00.000Z",
      rulesVersion: "correlate-v1",
      scopes: {
        domestic: { events: "domestic.json", map: "domestic.map.json", network: "network.json" },
        international: { events: "international.json", map: "international.map.json", network: "network.json" },
      },
      files: {},
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await loadMapEvents("domestic", { manifest });

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("loadEvents 與 loadMapEvents 在 SHA-256 不符時拒絕晉級（防跨部署混 cohort）", async () => {
    const { loadEvents, loadMapEvents } = await import("../src/data/loader");
    const manifest: CohortManifest = {
      manifestVersion: 1,
      snapshotId: "cohort-s2",
      generatedAt: "2026-09-17T00:00:00.000Z",
      rulesVersion: "correlate-v1",
      scopes: {
        domestic: {
          events: "domestic.json",
          map: "domestic.map.json",
          network: "network.json",
          sha256: "expected-hash-h2",
        },
        international: {
          events: "international.json",
          map: "international.map.json",
          network: "network.json",
        },
      },
      files: {
        "domestic.json": { path: "domestic.json", sha256: "expected-hash-h2", bytes: 100 },
        "domestic.map.json": { path: "domestic.map.json", sha256: "expected-map-hash-h2", bytes: 50 },
      },
    };

    // 模擬伺服器回傳舊部署 M1 或新部署 M3 的內容（其 hash 不等於 expected-hash-h2）
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify([{ id: "mismatched-event", scope: "domestic", riskLevel: "low" }]),
    } as Response);

    // loadEvents 必須拒收並拋出 hash mismatch 錯誤，絕不推進到前端快取
    await expect(loadEvents("domestic", { manifest })).rejects.toThrow(/SHA-256 不符/);

    // loadMapEvents 必須 fail-safe 回傳 null
    const mapResult = await loadMapEvents("domestic", { manifest });
    expect(mapResult).toBeNull();
  });

  it("loadNetwork 在 manifest 期待 snapshotId 但 response 缺少 snapshotId 時 fail-closed", async () => {
    const { loadNetwork } = await import("../src/data/network");

    // 模擬 legacy 或損毀的 network.json：沒有 snapshotId
    const legacyNetwork = {
      generatedAt: "2026-09-16T00:00:00.000Z",
      domestic: { edges: [], clusters: [], nodes: [], stats: {} },
      international: { edges: [], clusters: [], nodes: [], stats: {} },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(legacyNetwork),
    } as Response);

    const net = await loadNetwork("domestic", {
      expectedSnapshotId: "cohort-s2",
    });

    // 必須判定為 error 且明確指出缺少快照版本，絕不能判定為 ready 混用
    expect(net.state).toBe("error");
    expect(net.error).toMatch(/情報網缺少快照版本/);
  });

  it("loadNetwork 在 snapshotId 不符時 fail-closed", async () => {
    const { loadNetwork } = await import("../src/data/network");

    const mismatchedNetwork = {
      snapshotId: "cohort-s3-different",
      generatedAt: "2026-09-17T00:00:00.000Z",
      domestic: { edges: [], clusters: [], nodes: [], stats: {} },
      international: { edges: [], clusters: [], nodes: [], stats: {} },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(mismatchedNetwork),
    } as Response);

    const net = await loadNetwork("domestic", {
      expectedSnapshotId: "cohort-s2",
    });

    expect(net.state).toBe("error");
    expect(net.error).toMatch(/情報網快照版本不符/);
  });

  it("loadNetwork 在 expectedSha256 不符時 fail-closed", async () => {
    const { loadNetwork } = await import("../src/data/network");

    const validNetwork = {
      snapshotId: "cohort-s2",
      generatedAt: "2026-09-17T00:00:00.000Z",
      domestic: { edges: [], clusters: [], nodes: [], stats: {} },
      international: { edges: [], clusters: [], nodes: [], stats: {} },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(validNetwork),
    } as Response);

    const net = await loadNetwork("domestic", {
      expectedSnapshotId: "cohort-s2",
      expectedSha256: "some-different-sha256",
    });

    expect(net.state).toBe("error");
    expect(net.error).toMatch(/情報網 SHA-256 不符/);
  });
});
