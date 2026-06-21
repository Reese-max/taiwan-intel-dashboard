import { describe, expect, it } from "vitest";
import { NetworkIndex, type ScopeNetwork } from "../src/data/network";

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
});
