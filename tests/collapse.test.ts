import { describe, expect, it } from "vitest";
import { collapseSameIncident } from "../src/utils/collapse";
import type { NetworkIndex, RelatedRef } from "../src/data/network";
import type { IntelEvent, RiskLevel } from "../src/types/event";

function event(id: string, sourceName: string, riskLevel: RiskLevel = "medium", timestamp = "2026-07-05T00:00:00+08:00"): IntelEvent {
  return {
    id,
    title: `事件 ${id}`,
    region: "臺北市",
    timestamp,
    category: "治安",
    scope: "domestic",
    riskLevel,
    summary: "摘要",
    source: {
      name: sourceName,
      type: "news-rss",
      fetchedAt: "2026-07-05T00:00:00+08:00",
    },
  };
}

function fakeNet(refs: Record<string, RelatedRef[]>): NetworkIndex {
  return {
    related(id: string) {
      return refs[id] ?? [];
    },
  } as unknown as NetworkIndex;
}

function same(id: string): RelatedRef {
  return { id, type: "same-incident", weight: 1, why: "跨源佐證" };
}

describe("collapseSameIncident", () => {
  it("兩事件經 same-incident 相連時收成一組，sourceCount 去重且代表取高風險", () => {
    const events = [event("a", "來源A", "medium"), event("b", "來源B", "high")];

    const groups = collapseSameIncident(events, fakeNet({ a: [same("b")], b: [same("a")] }));

    expect(groups).toHaveLength(1);
    expect(groups[0].representative.id).toBe("b");
    expect(groups[0].members.map((e) => e.id)).toEqual(["b", "a"]);
    expect(groups[0].sourceCount).toBe(2);
  });

  it("同風險時代表取 timestamp 較新者", () => {
    const older = event("older", "來源A", "high", "2026-07-04T00:00:00+08:00");
    const newer = event("newer", "來源B", "high", "2026-07-05T00:00:00+08:00");

    const groups = collapseSameIncident([older, newer], fakeNet({ older: [same("newer")], newer: [same("older")] }));

    expect(groups[0].representative.id).toBe("newer");
    expect(groups[0].members.map((e) => e.id)).toEqual(["newer", "older"]);
  });

  it("same-topic 與 same-entity 邊不收合", () => {
    const events = [event("a", "來源A"), event("b", "來源B"), event("c", "來源C")];
    const net = fakeNet({
      a: [
        { id: "b", type: "same-topic", weight: 1, why: "同題情勢" },
        { id: "c", type: "same-entity", weight: 1, why: "共享實體" },
      ],
    });

    const groups = collapseSameIncident(events, net);

    expect(groups.map((g) => g.members.map((e) => e.id))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("鄰居不在傳入集合時不併入", () => {
    const groups = collapseSameIncident([event("a", "來源A")], fakeNet({ a: [same("missing")] }));

    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((e) => e.id)).toEqual(["a"]);
    expect(groups[0].sourceCount).toBe(1);
  });

  it("三事件鏈狀 same-incident 會形成同一連通分量", () => {
    const events = [event("a", "來源A"), event("b", "來源B"), event("c", "來源C")];
    const net = fakeNet({ a: [same("b")], b: [same("a"), same("c")], c: [same("b")] });

    const groups = collapseSameIncident(events, net);

    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((e) => e.id).sort()).toEqual(["a", "b", "c"]);
    expect(groups[0].sourceCount).toBe(3);
  });

  it("同來源多筆 sourceCount 會去重", () => {
    const events = [event("a", "同來源"), event("b", "同來源")];

    const groups = collapseSameIncident(events, fakeNet({ a: [same("b")], b: [same("a")] }));

    expect(groups[0].sourceCount).toBe(1);
  });

  it("輸出組順序依 representative 在原 events 的原始順序", () => {
    const events = [
      event("rep-1", "來源A", "high", "2026-07-05T00:00:00+08:00"),
      event("member-1", "來源B", "medium", "2026-07-06T00:00:00+08:00"),
      event("member-2", "來源C", "medium", "2026-07-05T00:00:00+08:00"),
      event("rep-2", "來源D", "critical", "2026-07-04T00:00:00+08:00"),
    ];
    const net = fakeNet({
      "rep-1": [same("member-1")],
      "member-1": [same("rep-1")],
      "member-2": [same("rep-2")],
      "rep-2": [same("member-2")],
    });

    const groups = collapseSameIncident(events, net);

    expect(groups.map((g) => g.representative.id)).toEqual(["rep-1", "rep-2"]);
  });
});

