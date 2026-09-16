import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNetwork, NetworkIndex, type IntelNetwork, type ScopeNetwork } from "../src/data/network";

afterEach(() => vi.restoreAllMocks());

describe("NetworkIndex cluster metadata", () => {
  it("保留 cluster label 並可依 id 查群集", () => {
    const net: ScopeNetwork = {
      nodes: [],
      edges: [],
      clusters: [
        {
          id: "c0",
          members: ["a", "b"],
          size: 2,
          representativeTitle: "代表情報",
          topCategory: "治安",
          regions: ["臺北市"],
          latestTs: "2026-06-21T00:00:00+08:00",
          sourceCount: 2,
        },
      ],
      stats: {},
    };
    const index = new NetworkIndex(net);
    expect(index.state).toBe("ready");
    expect(index.clusters()[0].representativeTitle).toBe("代表情報");
    expect(index.cluster("c0")?.members).toEqual(["a", "b"]);
    expect(index.clusterOf("b")?.id).toBe("c0");
  });

  it("clusters 回傳副本，避免呼叫端排序或刪除污染索引", () => {
    const net: ScopeNetwork = {
      nodes: [],
      edges: [],
      clusters: [
        { id: "c0", members: ["a"], size: 1 },
        { id: "c1", members: ["b"], size: 1 },
      ],
      stats: {},
    };
    const index = new NetworkIndex(net);
    const clusters = index.clusters();
    clusters.pop();
    expect(index.clusters().map((c) => c.id)).toEqual(["c0", "c1"]);
  });

  it("成功載入有關聯時標示 ready 狀態", async () => {
    const fakeNet: IntelNetwork = {
      snapshotId: "cohort-test-1",
      rulesVersion: "correlate-v1",
      generatedAt: "2026-09-17T00:00:00.000Z",
      scopeNote: "test",
      domestic: {
        nodes: [{ id: "e1", region: "臺北市", category: "治安", riskLevel: "high", scope: "domestic", degree: 1 }],
        edges: [{ a: "e1", b: "e2", type: "same-incident", weight: 0.9, why: "同案" }],
        clusters: [{ id: "c1", members: ["e1", "e2"], size: 2 }],
        stats: {},
      },
      international: { nodes: [], edges: [], clusters: [], stats: {} },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => fakeNet,
    } as Response);

    const index = await loadNetwork("domestic");
    expect(index.state).toBe("ready");
    expect(index.snapshotId).toBe("cohort-test-1");
    expect(index.count("e1")).toBe(1);
    expect(index.related("e1")[0].id).toBe("e2");
  });

  it("成功載入但無任何關聯時標示 empty 狀態", async () => {
    const fakeNet: IntelNetwork = {
      snapshotId: "cohort-test-empty",
      generatedAt: "2026-09-17T00:00:00.000Z",
      domestic: { nodes: [], edges: [], clusters: [], stats: {} },
      international: { nodes: [], edges: [], clusters: [], stats: {} },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => fakeNet,
    } as Response);

    const index = await loadNetwork("domestic");
    expect(index.state).toBe("empty");
    expect(index.clusters()).toEqual([]);
    expect(index.count("e1")).toBe(0);
  });

  it("HTTP 404 時標示 error 狀態且包含安全原因", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const index = await loadNetwork("domestic");
    expect(index.state).toBe("error");
    expect(index.error).toContain("HTTP 404");
    expect(index.clusters()).toEqual([]);
  });

  it("HTTP 500 時標示 error 狀態", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const index = await loadNetwork("domestic");
    expect(index.state).toBe("error");
    expect(index.error).toContain("HTTP 500");
  });

  it("請求逾時時標示 error 狀態", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"));

    const index = await loadNetwork("domestic");
    expect(index.state).toBe("error");
    expect(index.error).toContain("逾時");
    expect(index.clusters()).toEqual([]);
  });

  it("JSON 解析失敗時標示 error 狀態", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON at position 0");
      },
    } as unknown as Response);

    const index = await loadNetwork("domestic");
    expect(index.state).toBe("error");
    expect(index.error).toContain("JSON");
  });

  it("快照版本不符合時標示 error 狀態", async () => {
    const fakeNet: IntelNetwork = {
      snapshotId: "cohort-version-old",
      generatedAt: "2026-09-17T00:00:00.000Z",
      domestic: { nodes: [], edges: [], clusters: [], stats: {} },
      international: { nodes: [], edges: [], clusters: [], stats: {} },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => fakeNet,
    } as Response);

    const index = await loadNetwork("domestic", { expectedSnapshotId: "cohort-version-new" });
    expect(index.state).toBe("error");
    expect(index.error).toContain("快照版本不符");
  });

  it("缺少領域資料時標示 error 狀態", async () => {
    const fakeNet = {
      generatedAt: "2026-09-17T00:00:00.000Z",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => fakeNet,
    } as Response);

    const index = await loadNetwork("domestic");
    expect(index.state).toBe("error");
    expect(index.error).toContain("domestic");
  });

  it("載入失敗且有既有索引時降級為 stale，保留舊資料與相連關係", async () => {
    const prevNet: ScopeNetwork = {
      nodes: [],
      edges: [{ a: "e1", b: "e2", type: "same-incident", weight: 1, why: "同案" }],
      clusters: [{ id: "c0", members: ["e1", "e2"], size: 2, representativeTitle: "代表" }],
      stats: {},
    };
    const previousIndex = NetworkIndex.createReady(prevNet, { snapshotId: "cohort-v1" });

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network connection dropped"));

    const index = await loadNetwork("domestic", { previousIndex });
    expect(index.state).toBe("stale");
    expect(index.error).toContain("Network connection dropped");
    expect(index.snapshotId).toBe("cohort-v1");
    expect(index.count("e1")).toBe(1);
    expect(index.clusters()[0].id).toBe("c0");
  });
});
