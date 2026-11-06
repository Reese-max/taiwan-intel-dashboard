import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { trimNetwork } from "../scripts/lib/trim-network.mjs";
import { loadNetwork, NetworkIndex, type ScopeNetwork } from "../src/data/network";
import { renderTopClusters } from "../src/components/TopClusters";
import { renderRelationGraph } from "../src/components/RelationGraph";
import { eventCard } from "../src/components/EventCard";
import { edgeTypeLabel } from "../src/data/network";
import type { IntelEvent } from "../src/types/event";

function fixture() {
  const scope = (prefix: string) => ({
    nodes: ["a", "b", "isolated"].map((id) => ({
      id: prefix + id, title: "事件標題", summary: "從事件檔載入的摘要", region: "臺北市",
      category: "治安", riskLevel: "high", scope: "domestic", degree: id === "isolated" ? 0 : 4,
      sourceCount: 2, evidenceSources: ["甲", "乙"], lat: 25, lng: 121,
      locationRole: "incident", locationPrecision: "city", curated: { id: "location-1" },
    })),
    edges: ["same-incident", "same-entity", "same-topic", "follow-up"].map((type) => ({
      a: prefix + "a", b: prefix + "b", type, weight: 1.5,
      why: type === "follow-up" ? "人工更正：續報 <查證> 😀" : prefix + "同事件候選：仍需查證",
      origin: "manual", decision: "same_incident", curationId: "cur-1", automaticIncidentEvidence: true,
      ...(type === "follow-up" ? { from: prefix + "b", to: prefix + "a" } : {}),
    })),
    clusters: [{
      id: "c0", members: [prefix + "a", prefix + "b"], size: 2, representativeTitle: "情報群",
      topCategory: "治安", regions: ["臺北市"], latestTs: "2026-11-06T00:00:00Z", sourceCount: 2,
      evidenceSources: ["甲", "乙"], dominantCategoryShare: 0.5, incoherent: true,
      categoryEntropy: 1, distinctTopicRatio: 0.5, temporalSpanDays: 1,
      temporalSeries: [{ ts: "2026-11-06T00:00:00Z", reports: 2, sources: 2 }],
      firstSeenTs: "2026-11-05T00:00:00Z", lastSeenTs: "2026-11-06T00:00:00Z",
      geoClusters: [], degraded: { missingTimestamp: { count: 0, ids: [] }, missingCoordinates: { count: 0, ids: [] } },
    }],
    stats: { events: 3, edges: 4, clusters: 1 },
    curation: { entries: 1, applied: 1, decisions: [{ id: "cur-1", status: "applied" }] },
  });
  return { snapshotId: "sample-1", generatedAt: "2026-11-06T00:00:00Z", rulesVersion: "v1", scopeNote: "測試",
    excluded: { domestic: 1, international: 2 }, domestic: scope("d-"), international: scope("i-") };
}

function freeze(value: object): void {
  Object.values(value).forEach((child) => { if (child && typeof child === "object") freeze(child); });
  Object.freeze(value);
}

function globe(net: unknown) {
  const html = readFileSync("static/intel.html", "utf8");
  const functions = ["hashJit", "buildNetworkIndex", "buildNetworkArcs"].map((name) =>
    html.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))![0]).join("\n");
  return runInNewContext(`${functions}; buildNetworkIndex(net); buildNetworkArcs(net);
    JSON.stringify({ adj: [...NET_ADJ], clusters: NET_CLUSTERS, arcs: NET_ARCS, stats: netStats });`, {
    net, window: {}, NET_ADJ: null, NET_CLUSTERS: [], NET_CLUSTER_BY_ID: null, NET_ARCS: [], netStats: {},
    ALL: ["a", "b"].map((id) => ({ id: "d-" + id, lat: 25, lng: 121 })), NET_ARC_MAX: 100, NET_WEAK_ARC_MAX: 100,
  });
}

afterEach(() => vi.restoreAllMocks());

const DICT = { dedupeWhy: true };

describe("deployment network projection", () => {
  it("缺少 scope 或 edges 時原樣保留，不讓 build 失敗", () => {
    expect(trimNetwork({ snapshotId: "s", domestic: { nodes: [], edges: [], clusters: [] } })).not.toHaveProperty("international");
    expect(trimNetwork({ domestic: { clusters: [] } }).domestic).toEqual({ clusters: [] });
    expect(trimNetwork(null)).toBeNull();
    // 跨家族審查 S1／S2：陣列內 null 元素、根層陣列都原樣交出
    expect(trimNetwork({ domestic: { nodes: [null], edges: [null], clusters: [] } }).domestic).toMatchObject({ nodes: [null], edges: [null] });
    expect(trimNetwork([])).toEqual([]);
  });

  it("預設保留 why 原文字串、不輸出 whyTexts（舊版前端仍可讀）", () => {
    const original = fixture();
    const result = trimNetwork(original);
    for (const scope of ["domestic", "international"] as const) {
      expect(result[scope]).not.toHaveProperty("whyTexts");
      result[scope].edges.forEach((edge: { why: unknown }, i: number) => expect(edge.why).toBe(original[scope].edges[i].why));
      expect(result[scope].nodes).toEqual(original[scope].nodes.map(({ id }: { id: string }) => ({ id })));
    }
  });

  it("does not mutate source data and preserves all IDs, counts, clusters and metadata in both scopes", () => {
    const original = fixture();
    const before = JSON.stringify(original);
    freeze(original);
    const result = trimNetwork(original, DICT);
    expect(JSON.stringify(original)).toBe(before);
    expect(result).toMatchObject({ snapshotId: original.snapshotId, generatedAt: original.generatedAt,
      rulesVersion: original.rulesVersion, scopeNote: original.scopeNote, excluded: original.excluded });
    for (const scope of ["domestic", "international"] as const) {
      expect(result[scope].nodes).toEqual(original[scope].nodes.map(({ id }) => ({ id })));
      expect(result[scope].clusters).toEqual(original[scope].clusters);
      expect(result[scope].stats).toEqual(original[scope].stats);
      expect(result[scope].curation).toEqual(original[scope].curation);
      expect(result[scope].edges).toHaveLength(original[scope].edges.length);
      result[scope].edges.forEach((edge: { why: number }, i: number) => {
        const { a, b, type, weight, from } = original[scope].edges[i];
        expect(edge).toMatchObject({ a, b, type, weight, ...(from ? { from } : {}) });
        expect(result[scope].whyTexts[edge.why]).toBe(original[scope].edges[i].why);
      });
      expect(result[scope].whyTexts).toHaveLength(2);
    }
    expect(result.domestic.nodes[0]).not.toHaveProperty("summary");
    expect(Object.keys(result.domestic.nodes[0])).toEqual(["id"]);
    // 人工更正邊保留出處（tests/curation-rebuild.test.ts 的部署契約）；自動證據與 to 不保留
    expect(Object.keys(result.domestic.edges[0])).toEqual(["a", "b", "type", "weight", "why", "origin", "decision", "curationId"]);
    expect(result.domestic.edges[3]).not.toHaveProperty("to");
    const auto = trimNetwork({ domestic: { nodes: [], edges: [{ a: "x", b: "y", type: "same-topic", weight: 0.3, why: "w", origin: "auto", automaticIncidentEvidence: true }], clusters: [] } });
    expect(Object.keys(auto.domestic.edges[0])).toEqual(["a", "b", "type", "weight", "why"]);
    expect(result.domestic.edges[3]).toHaveProperty("from", "d-b");
  });

  it.each(["domestic", "international"] as const)("preserves %s loader state, neighbors, follow-up direction, text and stale fallback", async (scope) => {
    const original = fixture();
    const body = JSON.stringify(trimNetwork(original, DICT));
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(body));
    const after = await loadNetwork(scope, { expectedSnapshotId: original.snapshotId,
      expectedSha256: createHash("sha256").update(body).digest("hex") });
    const before = new NetworkIndex(original[scope] as ScopeNetwork);
    expect(after.state).toBe(before.state);
    expect(after.snapshotId).toBe(original.snapshotId);
    expect(after.generatedAt).toBe(original.generatedAt);
    expect(after.rulesVersion).toBe(original.rulesVersion);
    for (const { id } of original[scope].nodes) {
      expect(after.count(id)).toBe(before.count(id));
      expect(after.related(id)).toEqual(before.related(id));
      expect(after.clusterOf(id)).toEqual(before.clusterOf(id));
      expect(NetworkIndex.createStale(after, "retry").related(id)).toEqual(before.related(id));
    }
    expect(after.related(scope === "domestic" ? "d-a" : "i-a")[3].why).toMatch(/^前情報導：人工更正/);
    expect(after.clusters()).toEqual(before.clusters());
  });

  it("renders identical relation chips, relation graphs, top clusters, globe neighbors and arcs", () => {
    const original = fixture();
    const trimmed = trimNetwork(original, DICT);
    expect(globe(trimmed.domestic)).toBe(globe(original.domestic));
    const events = original.domestic.nodes.map((node) => ({ ...node, timestamp: original.generatedAt,
      source: { name: "甲", type: "manual", fetchedAt: original.generatedAt } } as IntelEvent));
    const byId = new Map(events.map((event) => [event.id, event]));
    const render = (scope: ScopeNetwork) => {
      const net = new NetworkIndex(scope);
      const container = { innerHTML: "", hidden: false } as HTMLElement;
      renderTopClusters(container, net.clusters());
      const top = container.innerHTML;
      renderRelationGraph(container, events[0], net.related("d-a").map((ref) => ({ event: byId.get(ref.id)!, rel: ref })));
      return { top, graph: container.innerHTML, cards: net.related("d-a").map((ref) =>
        eventCard(byId.get(ref.id)!, net.count(ref.id), { label: edgeTypeLabel(ref.type), why: ref.why })) };
    };
    expect(render(trimmed.domestic)).toEqual(render(original.domestic as ScopeNetwork));
  });

  it.each([false, true])("keeps empty versus isolated-only state (isolated=%s)", async (isolated) => {
    const original = fixture();
    for (const scope of [original.domestic, original.international]) {
      scope.nodes = isolated ? scope.nodes.slice(-1) : [];
      scope.edges = [];
      scope.clusters = [];
    }
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(trimNetwork(original, DICT))));
    for (const scope of ["domestic", "international"] as const) {
      expect((await loadNetwork(scope)).state).toBe(isolated ? "ready" : "empty");
    }
  });

  it.each([
    { why: 0, whyTexts: undefined }, { why: -1, whyTexts: ["text"] }, { why: 0.5, whyTexts: ["text"] },
    { why: 1, whyTexts: ["text"] }, { why: 0, whyTexts: [null] }, { why: 0, whyTexts: {} },
  ])("rejects malformed reason dictionaries: %j", async ({ why, whyTexts }) => {
    const body = trimNetwork(fixture(), DICT);
    body.domestic.whyTexts = whyTexts;
    body.domestic.edges[0].why = why;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(body)));
    expect((await loadNetwork("domestic")).state).toBe("error");
    const previous = new NetworkIndex(fixture().domestic as ScopeNetwork);
    const stale = await loadNetwork("domestic", { previousIndex: previous });
    expect(stale.state).toBe("stale");
    expect(stale.related("d-a")).toEqual(previous.related("d-a"));
  });
});
