import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { loadFirstPaintHeadEvents, loadHeadEvents } from "../src/data/loader";
import type { CohortManifest } from "../src/data/manifest";
import type { IntelEvent } from "../src/types/event";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const sampleHeadEvents: IntelEvent[] = [
  {
    id: "h1",
    title: "最新精簡快照事件一",
    region: "臺北市",
    lat: 25.03,
    lng: 121.56,
    locationPrecision: "city",
    timestamp: "2026-10-30T10:00:00.000Z",
    category: "治安",
    scope: "domestic",
    riskLevel: "high",
    summary: "最新事件摘要一",
    source: { name: "測試來源", publisherName: "測試發布者", type: "news-rss", fetchedAt: "2026-10-30T10:05:00.000Z" },
  },
  {
    id: "h2",
    title: "最新精簡快照事件二",
    region: "新北市",
    lat: 25.01,
    lng: 121.46,
    locationPrecision: "city",
    timestamp: "2026-10-30T09:00:00.000Z",
    category: "交通",
    scope: "domestic",
    riskLevel: "medium",
    summary: "最新事件摘要二",
    source: { name: "測試來源", publisherName: "測試發布者", type: "gov-open-data", fetchedAt: "2026-10-30T09:05:00.000Z" },
  },
];

function manifestFor(headSha256: string): CohortManifest {
  return {
    manifestVersion: 1,
    snapshotId: "cohort-head-test",
    generatedAt: "2026-10-30T10:00:00.000Z",
    rulesVersion: "correlate-v1",
    scopes: {
      domestic: { events: "domestic.json", map: "domestic.map.json", head: "domestic.head.json", network: "network.json", eventCount: 200 },
      international: { events: "international.json", map: "international.map.json", network: "network.json", eventCount: 50 },
    },
    files: {
      "domestic.head.json": { path: "domestic.head.json", sha256: headSha256, bytes: 123, count: 2 },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("首屏精簡事件同版鎖定（loadFirstPaintHeadEvents / loadHeadEvents）", () => {
  it("manifest 無法取得時 fail-closed：回 null 且不請求任何 head 檔", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await loadFirstPaintHeadEvents("domestic", { fetchManifest: async () => null });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("manifest 缺 head 設定時回 null，平滑退回完整載入", async () => {
    const manifest: CohortManifest = {
      manifestVersion: 1,
      snapshotId: "cohort-legacy",
      generatedAt: "2026-10-30T10:00:00.000Z",
      rulesVersion: "correlate-v1",
      scopes: {
        domestic: { events: "domestic.json", map: "domestic.map.json", network: "network.json" },
        international: { events: "international.json", map: "international.map.json", network: "network.json" },
      },
      files: {},
    };
    const result = await loadFirstPaintHeadEvents("domestic", { manifest });
    expect(result).toBeNull();
  });

  it("manifest 鎖定後以具名檔案載入並驗證 SHA-256，相符才回傳事件列表與 manifest", async () => {
    const headBody = JSON.stringify(sampleHeadEvents);
    const manifest = manifestFor(sha(headBody));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      expect(String(url)).toBe("./data/domestic.head.json");
      return { ok: true, text: async () => headBody } as Response;
    });

    const result = await loadFirstPaintHeadEvents("domestic", { manifest });
    expect(result).not.toBeNull();
    expect(result?.events).toHaveLength(2);
    expect(result?.events[0]?.id).toBe("h1");
    expect(result?.manifest.snapshotId).toBe("cohort-head-test");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("跨部署競態：head bytes 與 manifest hash 不符時回 null（不晉級異版產物）", async () => {
    const oldBody = JSON.stringify([{ id: "old-event", scope: "domestic" }]);
    const manifest = manifestFor(sha(JSON.stringify(sampleHeadEvents)));
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => oldBody,
    } as Response);

    const result = await loadFirstPaintHeadEvents("domestic", { manifest });
    expect(result).toBeNull();
  });

  it("404 或連線錯誤時回 null", async () => {
    const manifest = manifestFor(sha("test"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 404 } as Response);
    const result = await loadFirstPaintHeadEvents("domestic", { manifest });
    expect(result).toBeNull();
  });

  it("manifest 缺少 head 檔案 hash 時 fail-closed，不發出網路請求", async () => {
    const manifest = manifestFor("");
    manifest.files = {};
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await loadFirstPaintHeadEvents("domestic", { manifest });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("buildCohortManifest 首屏精簡事件投影註冊", () => {
  it("目錄存在 domestic.head.json 時自動納入 manifest 並計算 hash 及 scope.head", async () => {
    const { buildCohortManifest } = await import("../scripts/lib/manifest.mjs");
    const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tempDir = mkdtempSync(join(tmpdir(), "test-head-manifest-"));
    try {
      const headData = [{ id: "h1", timestamp: "2026-10-30T12:00:00Z" }];
      writeFileSync(join(tempDir, "domestic.json"), JSON.stringify(headData));
      writeFileSync(join(tempDir, "domestic.head.json"), JSON.stringify(headData));

      const manifest = buildCohortManifest({ dataDir: tempDir });
      expect(manifest.scopes.domestic.head).toBe("domestic.head.json");
      expect(manifest.files["domestic.head.json"]).toBeDefined();
      expect(manifest.files["domestic.head.json"]?.count).toBe(1);
      expect(manifest.files["domestic.head.json"]?.sha256).toBeTruthy();

      const noHeadManifest = buildCohortManifest({ dataDir: tempDir, includeHeadProjections: false });
      expect(noHeadManifest.scopes.domestic.head).toBeUndefined();
      expect(noHeadManifest.files["domestic.head.json"]).toBeUndefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
