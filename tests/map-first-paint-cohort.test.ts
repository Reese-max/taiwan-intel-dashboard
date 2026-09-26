import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { loadFirstPaintMapEvents } from "../src/data/loader";
import { createManifestLoader, type CohortManifest } from "../src/data/manifest";
import type { IntelEvent } from "../src/types/event";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const slimEvents: IntelEvent[] = [
  {
    id: "m1",
    title: "精簡點位一",
    region: "臺北市",
    lat: 25.03,
    lng: 121.56,
    locationPrecision: "city",
    timestamp: "2026-09-17T00:00:00.000Z",
    category: "治安",
    scope: "domestic",
    riskLevel: "high",
    summary: "",
    source: { name: "t1", publisherName: "t1", type: "news-rss", fetchedAt: "2026-09-17T00:00:00.000Z" },
  },
];

function manifestFor(mapSha256: string): CohortManifest {
  return {
    manifestVersion: 1,
    snapshotId: "cohort-s2",
    generatedAt: "2026-09-17T00:00:00.000Z",
    rulesVersion: "correlate-v1",
    scopes: {
      domestic: { events: "domestic.json", map: "domestic.map.json", network: "network.json" },
      international: { events: "international.json", map: "international.map.json", network: "network.json" },
    },
    files: {
      "domestic.map.json": { path: "domestic.map.json", sha256: mapSha256, bytes: 1 },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("地圖 first-paint 同版鎖定（loadFirstPaintMapEvents）", () => {
  it("manifest 無法取得時 fail-closed：回 null 且不請求任何地圖檔", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await loadFirstPaintMapEvents("domestic", { fetchManifest: async () => null });
    expect(result).toBeNull();
    // 未驗證產物不得被請求（連 manifest.json 都不該由 helper 走預設 fallback 再抓一次）
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("manifest 鎖定後以具名檔案載入並驗證 SHA-256，相符才回傳點位", async () => {
    const mapBody = JSON.stringify(slimEvents);
    const manifest = manifestFor(sha(mapBody));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      expect(String(url)).toBe("./data/domestic.map.json");
      return { ok: true, text: async () => mapBody } as Response;
    });

    const result = await loadFirstPaintMapEvents("domestic", { manifest });
    expect(result?.events).toHaveLength(1);
    expect(result?.events[0]?.id).toBe("m1");
    // 回傳驗證所用 manifest，呼叫端可核對 snapshotId 是否仍為目前鎖定版本。
    expect(result?.manifest.snapshotId).toBe("cohort-s2");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("跨部署競態：map bytes 與 manifest hash 不符時回 null（不晉級異版產物）", async () => {
    const s1Body = JSON.stringify([{ id: "s1-old-cohort", scope: "domestic" }]);
    const manifest = manifestFor(sha(JSON.stringify(slimEvents))); // 期望 S2 bytes
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => s1Body, // 實收 S1 bytes
    } as Response);

    const result = await loadFirstPaintMapEvents("domestic", { manifest });
    expect(result).toBeNull();
  });

  it("manifest 具名 map 檔 404 時回 null", async () => {
    const manifest = manifestFor(sha("x"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 404 } as Response);
    const result = await loadFirstPaintMapEvents("domestic", { manifest });
    expect(result).toBeNull();
  });

  it("manifest 具名檔缺 hash 時 fail-closed：不請求也不晉級", async () => {
    const manifest = manifestFor(""); // scopes 具名檔存在，但 files 無對應 hash
    manifest.files = {};
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(slimEvents),
    } as Response);

    const result = await loadFirstPaintMapEvents("domestic", { manifest });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("未注入 manifest/fetchManifest 時走預設 loadManifest 路徑", async () => {
    const mapBody = JSON.stringify(slimEvents);
    const manifest = manifestFor(sha(mapBody));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("manifest.json")) return { ok: true, json: async () => manifest } as Response;
      if (u.includes("domestic.map.json")) return { ok: true, text: async () => mapBody } as Response;
      return { ok: false, status: 404 } as Response;
    });

    const result = await loadFirstPaintMapEvents("domestic");
    expect(result?.events).toHaveLength(1);
    expect(result?.manifest.snapshotId).toBe("cohort-s2");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("manifest map 欄位指向完整事件檔時仍走具名檔案（不向舊檔名降級）", async () => {
    const mapBody = JSON.stringify(slimEvents);
    const manifest = manifestFor(sha(mapBody));
    manifest.scopes.domestic.map = "domestic.json";
    manifest.files["domestic.json"] = { path: "domestic.json", sha256: sha(mapBody), bytes: 1 };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      expect(String(url)).toBe("./data/domestic.json");
      return { ok: true, text: async () => mapBody } as Response;
    });

    const result = await loadFirstPaintMapEvents("domestic", { manifest });
    expect(result?.events).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("createManifestLoader（啟動期 manifest 去重）", () => {
  const fakeManifest: CohortManifest = {
    manifestVersion: 1,
    snapshotId: "cohort-shared",
    generatedAt: "2026-09-17T00:00:00.000Z",
    rulesVersion: "correlate-v1",
    scopes: {
      domestic: { events: "domestic.json", map: "domestic.map.json", network: "network.json" },
      international: { events: "international.json", map: "international.map.json", network: "network.json" },
    },
    files: {},
  };

  it("並行呼叫共用同一次進行中的 fetch", async () => {
    let resolveFetch: ((r: unknown) => void) | null = null;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise((res) => {
          resolveFetch = res;
        }) as Promise<Response>,
    );

    const load = createManifestLoader();
    const p1 = load();
    const p2 = load();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    resolveFetch?.({ ok: true, json: async () => fakeManifest });
    const [m1, m2] = await Promise.all([p1, p2]);
    expect(m1?.snapshotId).toBe("cohort-shared");
    expect(m2?.snapshotId).toBe("cohort-shared");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("前次請求 settle 後再呼叫會重新抓取（不永久快取結果）", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => fakeManifest,
    } as Response);

    const load = createManifestLoader();
    await load();
    await load();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("manifest 抓取失敗（null）後仍可重試", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockResolvedValue({ ok: true, json: async () => fakeManifest } as Response);

    const load = createManifestLoader();
    expect(await load()).toBeNull();
    expect((await load())?.snapshotId).toBe("cohort-shared");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
