import { describe, expect, it } from "vitest";
import { corroborationOf } from "../src/utils/corroboration";
import type { IntelEvent } from "../src/types/event";
import type { NetworkIndex, RelatedRef } from "../src/data/network";

function event(id: string, sourceName: string): IntelEvent {
  return {
    id,
    title: `事件 ${id}`,
    region: "臺北市",
    timestamp: "2026-07-05T00:00:00+08:00",
    category: "治安",
    scope: "domestic",
    riskLevel: "medium",
    summary: "摘要",
    source: {
      name: sourceName,
      type: "news-rss",
      fetchedAt: "2026-07-05T00:00:00+08:00",
    },
  };
}

function byId(events: IntelEvent[]): Map<string, IntelEvent> {
  return new Map(events.map((e) => [e.id, e]));
}

function fakeNet(refs: Record<string, RelatedRef[]>): NetworkIndex {
  return {
    related(id: string) {
      return refs[id] ?? [];
    },
  } as unknown as NetworkIndex;
}

describe("corroborationOf", () => {
  it("無關聯時只計自身來源，不確認", () => {
    const events = byId([event("a", "來源A")]);

    expect(corroborationOf("a", events, fakeNet({}))).toEqual({ sources: 1, confirmed: false });
  });

  it("有 2 個 same-incident 異源鄰居時，計為 3 源並確認", () => {
    const events = byId([event("a", "來源A"), event("b", "來源B"), event("c", "來源C")]);
    const net = fakeNet({
      a: [
        { id: "b", type: "same-incident", weight: 1, why: "跨源佐證" },
        { id: "c", type: "same-incident", weight: 1, why: "跨源佐證" },
      ],
    });

    expect(corroborationOf("a", events, net)).toEqual({ sources: 3, confirmed: true });
  });

  it("鄰居同 source.name 時會去重", () => {
    const events = byId([event("a", "來源A"), event("b", "來源B"), event("c", "來源B")]);
    const net = fakeNet({
      a: [
        { id: "b", type: "same-incident", weight: 1, why: "跨源佐證" },
        { id: "c", type: "same-incident", weight: 1, why: "跨源佐證" },
      ],
    });

    expect(corroborationOf("a", events, net)).toEqual({ sources: 2, confirmed: true });
  });

  it("same-topic 與 same-entity 不算佐證", () => {
    const events = byId([event("a", "來源A"), event("b", "來源B"), event("c", "來源C")]);
    const net = fakeNet({
      a: [
        { id: "b", type: "same-topic", weight: 1, why: "同題情勢" },
        { id: "c", type: "same-entity", weight: 1, why: "共享實體" },
      ],
    });

    expect(corroborationOf("a", events, net)).toEqual({ sources: 1, confirmed: false });
  });

  it("鄰居 id 不在 byId 時略過不計", () => {
    const events = byId([event("a", "來源A"), event("b", "來源B")]);
    const net = fakeNet({
      a: [
        { id: "b", type: "same-incident", weight: 1, why: "跨源佐證" },
        { id: "missing", type: "same-incident", weight: 1, why: "跨源佐證" },
      ],
    });

    expect(corroborationOf("a", events, net)).toEqual({ sources: 2, confirmed: true });
  });

  it("事件本身不在 byId 時回傳單一來源待查證預設值", () => {
    expect(corroborationOf("missing", byId([event("a", "來源A")]), fakeNet({}))).toEqual({
      sources: 1,
      confirmed: false,
    });
  });
});
