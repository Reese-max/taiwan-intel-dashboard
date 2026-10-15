import { describe, expect, it } from "vitest";
import { collapseSameIncident, type CollapsedGroup } from "../src/utils/collapse";
import type { NetworkIndex, RelatedRef } from "../src/data/network";
import type { IntelEvent, RiskLevel } from "../src/types/event";

function event(id: string, url = `https://example.test/${id}`, riskLevel: RiskLevel = "medium", timestamp = "2026-10-08T00:00:00Z"): IntelEvent {
  return { id, title: id, region: "Taiwan", timestamp, category: "security", scope: "domestic", riskLevel, summary: "fixture",
    source: { name: id, publisherName: id, type: "news-rss", fetchedAt: timestamp, url, recordRef: url } };
}
function net(refs: Record<string, RelatedRef[]> = {}): NetworkIndex {
  return { related: (id: string) => refs[id] ?? [] } as unknown as NetworkIndex;
}
function links(pairs: [string, string, number][]): NetworkIndex {
  const refs: Record<string, RelatedRef[]> = {};
  for (const [a, b, weight] of pairs) {
    (refs[a] ??= []).push({ id: b, type: "same-incident", weight, why: "fixture" });
    (refs[b] ??= []).push({ id: a, type: "same-incident", weight, why: "fixture" });
  }
  return net(refs);
}
const ids = (groups: CollapsedGroup[]) => groups.map(g => g.members.map(e => e.id));

describe("collapse indexes preserve grouping semantics without pairwise URL work", () => {
  it("bounds URL reads linearly for distinct normalized URLs and no relations", () => {
    let reads = 0;
    const events = Array.from({ length: 200 }, (_, i) => event(`unique-${i}`));
    for (const e of events) {
      const value = e.source.url;
      Object.defineProperty(e.source, "url", { enumerable: true, configurable: true, get: () => { reads++; return value; } });
    }
    const groups = collapseSameIncident(events, net());
    const collapseReads = reads;
    expect(ids(groups)).toEqual(events.map(e => [e.id]));
    expect(events.map(e => e.source.url)).toEqual(events.map(e => `https://example.test/${e.id}`));
    expect(collapseReads).toBeLessThanOrEqual(events.length * 4);
  });

  it("retains tracking/hash/trailing-slash normalization and one-raw-report source counts", () => {
    const a = event("a", "https://example.test/report?utm_source=one#fragment");
    const b = event("b", "https://example.test/report/");
    const [g] = collapseSameIncident([a, b], net());
    expect(g.members).toEqual([a, b]);
    expect({ sourceCount: g.sourceCount, channelCount: g.channelCount, rawReportCount: g.rawReportCount, isMultiChannel: g.isMultiChannel })
      .toEqual({ sourceCount: 1, channelCount: 2, rawReportCount: 1, isMultiChannel: true });
  });

  it("retains the exact recordRef OR route when normalized URLs differ", () => {
    const a = event("a", "https://aggregator.test/a"), b = event("b", "https://aggregator.test/b");
    a.source.recordRef = b.source.recordRef = "https://publisher.test/same-raw-record";
    const groups = collapseSameIncident([a, b], net());
    expect(ids(groups)).toEqual([["a", "b"]]);
    expect(groups[0]).toMatchObject({ sourceCount: 2, channelCount: 2, rawReportCount: 2, isMultiChannel: false });
  });

  it.each([true, false])("preserves the asymmetric event: seed guard (empty URL first=%s)", (emptyFirst) => {
    const a = event("empty", ""), b = event("normal", "https://aggregator.test/normal");
    a.source.recordRef = b.source.recordRef = "https://publisher.test/shared";
    const groups = collapseSameIncident(emptyFirst ? [a, b] : [b, a], net());
    expect(ids(groups)).toEqual(emptyFirst ? [["empty"], ["normal"]] : [["normal", "empty"]]);
  });

  it("uses original candidate entry positions while byId still selects the last duplicate ID", () => {
    const a = event("a", "https://example.test/same"), firstX = event("x", "https://example.test/same");
    const b = event("b", "https://example.test/same"), lastX = event("x", "https://example.test/different", "high");
    const groups = collapseSameIncident([a, firstX, b, lastX], links([["a", "x", 1]]));
    expect(ids(groups)).toEqual([["b"], ["x", "a"]]);
    expect(groups[1].representative).toBe(lastX);
    expect(groups[1].members).not.toContain(firstX);
    expect(groups[1]).toMatchObject({ sourceCount: 2, channelCount: 2, rawReportCount: 2 });
  });

  it("preserves stable same-incident weight ties rather than input-order neighbor reordering", () => {
    const events = [event("a"), event("b"), event("c")];
    expect(ids(collapseSameIncident(events, links([["a", "c", 4], ["a", "b", 4]]))))
      .toEqual([["a", "c"], ["b"]]);
  });

  it("keeps full clique checks and does not collapse an A-B-C relation chain", () => {
    const events = [event("a"), event("b"), event("c")];
    expect(ids(collapseSameIncident(events, links([["a", "b", 2], ["b", "c", 1]]))))
      .toEqual([["a", "b"], ["c"]]);
  });

  it("keeps representative risk/time/index ties, member ordering and publisher/channel counts", () => {
    const a = event("a", undefined, "medium", "2026-10-06T00:00:00Z");
    const b = event("b", undefined, "high", "2026-10-07T00:00:00Z");
    const c = event("c", undefined, "high", "2026-10-08T00:00:00Z");
    const d = event("d", undefined, "high", "2026-10-08T00:00:00Z");
    a.source.publisherName = b.source.publisherName = "Publisher one";
    c.source.publisherName = d.source.publisherName = "Publisher two";
    d.source.name = c.source.name;
    const [g] = collapseSameIncident([a, b, c, d], links([["a", "b", 1], ["a", "c", 1], ["a", "d", 1], ["b", "c", 1], ["b", "d", 1], ["c", "d", 1]]));
    expect(g.representative).toBe(c);
    expect(g.members).toEqual([c, d, b, a]);
    expect(g).toMatchObject({ sourceCount: 2, channelCount: 3, rawReportCount: 4, isMultiChannel: false });
  });

  it("does not retain cached URL keys between invocations", () => {
    const a = event("a", "https://example.test/same"), b = event("b", "https://example.test/same");
    expect(ids(collapseSameIncident([a, b], net()))).toEqual([["a", "b"]]);
    b.source.url = b.source.recordRef = "https://example.test/new";
    expect(ids(collapseSameIncident([a, b], net()))).toEqual([["a"], ["b"]]);
  });
});
