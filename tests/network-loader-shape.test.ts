import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNetwork, NetworkIndex } from "../src/data/network";

const edge = () => ({ a: "e1", b: "e2", type: "same-incident", weight: 1, why: "owned fixture" });
const fixture = () => ({
  snapshotId: "owned-s2", rulesVersion: "fixture-v1", generatedAt: "2026-10-09T00:00:00.000Z",
  domestic: { nodes: [], edges: [], clusters: [], stats: {} },
  international: { nodes: [], edges: [], clusters: [], stats: {} },
});
type Mutable = Record<string, unknown>;
type Case = { label: string; mutate: (body: Mutable, scope: Mutable) => void };
const invalid: Case[] = [
  { label: "missing required scope arrays", mutate: (body) => { body.domestic = {}; } },
  { label: "scope array", mutate: (body) => { body.domestic = []; } },
  { label: "edges object", mutate: (_, scope) => { scope.edges = {}; } },
  { label: "null edge", mutate: (_, scope) => { scope.edges = [null]; } },
  { label: "numeric endpoint", mutate: (_, scope) => { scope.edges = [{ ...edge(), a: 1 }]; } },
  { label: "unknown edge type", mutate: (_, scope) => { scope.edges = [{ ...edge(), type: "unknown" }]; } },
  { label: "array edge type", mutate: (_, scope) => { scope.edges = [{ ...edge(), type: ["same-incident"] }]; } },
  { label: "non-numeric edge weight", mutate: (_, scope) => { scope.edges = [{ ...edge(), weight: "1" }]; } },
  { label: "non-string edge reason", mutate: (_, scope) => { scope.edges = [{ ...edge(), why: {} }]; } },
  { label: "clusters object", mutate: (_, scope) => { scope.clusters = {}; } },
  { label: "null cluster", mutate: (_, scope) => { scope.clusters = [null]; } },
  { label: "numeric cluster id", mutate: (_, scope) => { scope.clusters = [{ id: 1, members: ["e1"], size: 1 }]; } },
  { label: "missing cluster members", mutate: (_, scope) => { scope.clusters = [{ id: "c1", size: 1 }]; } },
  { label: "non-string cluster member", mutate: (_, scope) => { scope.clusters = [{ id: "c1", members: [1], size: 1 }]; } },
  { label: "optional nodes object", mutate: (_, scope) => { scope.nodes = {}; } },
  { label: "null optional node", mutate: (_, scope) => { scope.nodes = [null]; } },
  { label: "numeric snapshot", mutate: (body) => { body.snapshotId = 2; } },
  { label: "numeric rules metadata", mutate: (body) => { body.rulesVersion = 2; } },
  { label: "numeric generated metadata", mutate: (body) => { body.generatedAt = 2; } },
];

function serve(body: unknown): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(body)));
}
afterEach(() => vi.restoreAllMocks());

describe("network loader malformed contract degradation", () => {
  it.each(invalid)("$label is error instead of empty, ready or a thrown index error", async ({ mutate }) => {
    const body = fixture() as unknown as Mutable;
    mutate(body, body.domestic as Mutable);
    serve(body);
    const result = await loadNetwork("domestic", { expectedSnapshotId: "owned-s2" });
    expect(result.state).toBe("error");
    expect(result.error).toMatch(/格式|領域/);
    expect(result.clusters()).toEqual([]);
    expect(result.count("e1")).toBe(0);
  });

  it("malformed nested input preserves the previous consistent index as stale", async () => {
    const previous = NetworkIndex.createReady({ edges: [edge()], clusters: [], stats: {} }, { snapshotId: "owned-s1" });
    const body = fixture() as unknown as Mutable;
    (body.domestic as Mutable).clusters = [{ id: "c1" }];
    serve(body);
    const result = await loadNetwork("domestic", { previousIndex: previous, expectedSnapshotId: "owned-s2" });
    expect(result.state).toBe("stale");
    expect(result.error).toMatch(/格式/);
    expect(result.snapshotId).toBe("owned-s1");
    expect(result.related("e1")).toEqual(previous.related("e1"));
  });

  it("valid legacy relationships without optional nodes or cohort metadata remain ready", async () => {
    serve({ domestic: { edges: [edge()], clusters: [{ id: "c1", members: ["e1", "e2"], size: 2 }], stats: {} } });
    const result = await loadNetwork("domestic");
    expect(result.state).toBe("ready");
    expect(result.count("e1")).toBe(1);
    expect(result.clusterOf("e2")?.id).toBe("c1");
  });

  it("valid zero relationships remain empty with retained cohort metadata", async () => {
    serve(fixture());
    const result = await loadNetwork("domestic", { expectedSnapshotId: "owned-s2" });
    expect(result.state).toBe("empty");
    expect(result.error).toBeUndefined();
    expect(result.snapshotId).toBe("owned-s2");
    expect(result.rulesVersion).toBe("fixture-v1");
  });
});
