import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildCohortManifest, writeCohortManifest } from "../scripts/lib/manifest.mjs";
import { loadManifest, type CohortManifest } from "../src/data/manifest";

const TEMP_DIR = join(process.cwd(), "temp-test-manifest");

const directMapBody = JSON.stringify([{ id: "owned-direct-map", title: "已驗證地圖點位", scope: "domestic", lat: 25.03, lng: 121.56, locationPrecision: "city" }]);
const directMapHash = createHash("sha256").update(directMapBody).digest("hex");
function directMapManifest(): CohortManifest {
  return {
    manifestVersion: 1, snapshotId: "owned-direct-map", generatedAt: "2026-10-09T00:00:00.000Z", rulesVersion: "correlate-v1",
    scopes: {
      domestic: { events: "domestic.json", map: "domestic.map.json", network: "network.json" },
      international: { events: "international.json", map: "international.map.json", network: "network.json" },
    },
    files: { "domestic.map.json": { path: "domestic.map.json", sha256: directMapHash, bytes: Buffer.byteLength(directMapBody) } },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (existsSync(TEMP_DIR)) rmSync(TEMP_DIR, { recursive: true, force: true });
});

describe("Cohort Manifest (Work package D2)", () => {
  it.each(["events", "network"])("manifest 缺少 %s hash 時拒收產物", async (kind) => {
    const { loadEvents } = await import("../src/data/loader");
    const { loadNetwork } = await import("../src/data/network");
    const manifest: CohortManifest = {
      manifestVersion: 1, snapshotId: "cohort-s2", generatedAt: "2026-09-17T00:00:00.000Z", rulesVersion: "correlate-v1",
      scopes: {
        domestic: { events: "domestic.json", map: "domestic.map.json", network: "network.json" },
        international: { events: "international.json", map: "international.map.json", network: "network.json" },
      },
      files: {},
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(kind === "events" ? [] : {
      snapshotId: manifest.snapshotId, generatedAt: manifest.generatedAt,
      domestic: { nodes: [], edges: [], clusters: [], stats: {} },
    })));

    if (kind === "events") {
      await expect(loadEvents("domestic", { manifest })).rejects.toThrow(/SHA-256/);
    } else {
      const net = await loadNetwork("domestic", { manifest });
      expect(net.state).toBe("error");
      expect(net.error).toMatch(/SHA-256/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("明示 manifest 不可用時停用關聯，不走未驗證的 legacy 載入", async () => {
    const { loadNetwork } = await import("../src/data/network");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      snapshotId: "unverified", domestic: { nodes: [], edges: [], clusters: [], stats: {} },
    })));
    const network = await loadNetwork("domestic", { manifest: null });
    expect(network.state).toBe("error");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("情報網 response body 中止時保留並繪製已成功載入的事件資料", async () => {
    const { loadEvents } = await import("../src/data/loader");
    const { loadNetwork } = await import("../src/data/network");
    const events = [{ id: "event-kept", scope: "domestic", title: "保留事件" }];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("network.json")) {
        return {
          ok: true,
          status: 200,
          text: async () => {
            throw new DOMException("The user aborted a request.", "AbortError");
          },
        } as Response;
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(events) } as Response;
    });

    const [loadedEvents, network] = await Promise.all([loadEvents("domestic"), loadNetwork("domestic")]);

    expect(loadedEvents.map((event) => event.id)).toEqual(["event-kept"]);
    expect(network.state).toBe("error");
    expect(network.error).toContain("逾時");
  });

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

  it.each([undefined, null])("URL/hash 覆寫不能繞過鎖定 manifest（%s）", async (manifest) => {
    const { loadMapEvents } = await import("../src/data/loader");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(directMapBody));
    const result = await loadMapEvents("domestic", { manifest, url: "./data/owned-override.map.json", expectedSha256: directMapHash });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("URL/hash 覆寫不能繞過 manifest 具名 map", async () => {
    const { loadMapEvents } = await import("../src/data/loader");
    const manifest = directMapManifest();
    delete (manifest.scopes.domestic as Partial<CohortManifest["scopes"]["domestic"]>).map;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(directMapBody));
    const result = await loadMapEvents("domestic", { manifest, url: "./data/owned-override.map.json", expectedSha256: directMapHash });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("低階入口具名 manifest/hash 相符時仍載入完整地圖陣列", async () => {
    const { loadMapEvents } = await import("../src/data/loader");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(directMapBody));
    expect(await loadMapEvents("domestic", { manifest: directMapManifest() })).toEqual(JSON.parse(directMapBody));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("./data/domestic.map.json");
  });

  it("低階入口具名 manifest 存在時保留明示 URL/hash 覆寫相容性", async () => {
    const { loadMapEvents } = await import("../src/data/loader");
    const manifest = directMapManifest();
    manifest.files["domestic.map.json"] = { path: "domestic.map.json", sha256: "a".repeat(64), bytes: Buffer.byteLength(directMapBody) };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(directMapBody));
    expect(await loadMapEvents("domestic", { manifest, url: "./data/owned-override.map.json", expectedSha256: directMapHash })).toEqual(JSON.parse(directMapBody));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("./data/owned-override.map.json");
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

  it("無 crypto.subtle 時事件、地圖及情報網皆不接受未驗證的同版產物", async () => {
    const { loadEvents, loadMapEvents } = await import("../src/data/loader");
    const { loadNetwork } = await import("../src/data/network");
    const manifest: CohortManifest = {
      manifestVersion: 1,
      snapshotId: "cohort-s2",
      generatedAt: "2026-09-17T00:00:00.000Z",
      rulesVersion: "correlate-v1",
      scopes: {
        domestic: { events: "domestic.json", map: "domestic.map.json", network: "network.json" },
        international: { events: "international.json", map: "international.map.json", network: "network.json" },
      },
      files: {
        "domestic.json": { path: "domestic.json", sha256: "expected-events", bytes: 2 },
        "domestic.map.json": { path: "domestic.map.json", sha256: "expected-map", bytes: 2 },
      },
    };
    vi.stubGlobal("crypto", {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => "[]",
    } as Response);

    await expect(loadEvents("domestic", { manifest })).rejects.toThrow(/SHA-256 無法驗證/);
    expect(await loadMapEvents("domestic", { manifest })).toBeNull();
    const network = await loadNetwork("domestic", {
      expectedSnapshotId: "cohort-s2",
      expectedSha256: "expected-network",
    });
    expect(network.state).toBe("error");
    expect(network.error).toMatch(/SHA-256 無法驗證/);
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
