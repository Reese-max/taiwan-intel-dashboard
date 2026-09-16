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

    expect(corroborationOf("a", events, fakeNet({}))).toMatchObject({ sources: 1, confirmed: false });
  });

  it("有 2 個 same-incident 異源鄰居時，保留 3 個來源標記但不確認", () => {
    const events = byId([event("a", "來源A"), event("b", "來源B"), event("c", "來源C")]);
    const net = fakeNet({
      a: [
        { id: "b", type: "same-incident", weight: 1, why: "跨源佐證" },
        { id: "c", type: "same-incident", weight: 1, why: "跨源佐證" },
      ],
    });

    expect(corroborationOf("a", events, net)).toMatchObject({ sources: 3, confirmed: false, verification: "unverified" });
  });

  it("鄰居同 source.name 時會去重", () => {
    const events = byId([event("a", "來源A"), event("b", "來源B"), event("c", "來源B")]);
    const net = fakeNet({
      a: [
        { id: "b", type: "same-incident", weight: 1, why: "跨源佐證" },
        { id: "c", type: "same-incident", weight: 1, why: "跨源佐證" },
      ],
    });

    expect(corroborationOf("a", events, net)).toMatchObject({ sources: 2, confirmed: false, verification: "unverified" });
  });

  it("same-topic 與 same-entity 不算佐證", () => {
    const events = byId([event("a", "來源A"), event("b", "來源B"), event("c", "來源C")]);
    const net = fakeNet({
      a: [
        { id: "b", type: "same-topic", weight: 1, why: "同題情勢" },
        { id: "c", type: "same-entity", weight: 1, why: "共享實體" },
      ],
    });

    expect(corroborationOf("a", events, net)).toMatchObject({ sources: 1, confirmed: false });
  });

  it("鄰居 id 不在 byId 時略過不計", () => {
    const events = byId([event("a", "來源A"), event("b", "來源B")]);
    const net = fakeNet({
      a: [
        { id: "b", type: "same-incident", weight: 1, why: "跨源佐證" },
        { id: "missing", type: "same-incident", weight: 1, why: "跨源佐證" },
      ],
    });

    expect(corroborationOf("a", events, net)).toMatchObject({ sources: 2, confirmed: false, verification: "unverified" });
  });

  it("事件本身不在 byId 時回傳單一來源待查證預設值", () => {
    expect(corroborationOf("missing", byId([event("a", "來源A")]), fakeNet({}))).toMatchObject({
      sources: 1,
      confirmed: false,
      verification: "unverified",
    });
  });

  it("同一發布者經直接 RSS 與 Google News 聚合收錄，不計為獨立佐證（多管道收錄）", () => {
    const ev1: IntelEvent = {
      ...event("a", "中央社 RSS"),
      source: {
        name: "中央社 RSS",
        publisherName: "中央社",
        url: "https://www.cna.com.tw/news/123",
        type: "news-rss",
        fetchedAt: "2026-07-05T00:00:00+08:00",
      },
    };
    const ev2: IntelEvent = {
      ...event("b", "GN 中央社"),
      source: {
        name: "GN 中央社",
        publisherName: "中央社",
        url: "https://www.cna.com.tw/news/123",
        type: "news-rss",
        fetchedAt: "2026-07-05T00:00:00+08:00",
      },
    };
    const events = byId([ev1, ev2]);
    const net = fakeNet({
      a: [{ id: "b", type: "same-incident", weight: 1, why: "跨源佐證" }],
    });
    const res = corroborationOf("a", events, net);
    expect(res).toMatchObject({
      sources: 1,
      channels: 2,
      confirmed: false,
      isMultiChannel: true,
    });
  });

  it("同一原始 URL 經不同聚合管道收錄（帶 utm 參數），只計 1 個原始證據", () => {
    const ev1: IntelEvent = {
      ...event("a", "管道一"),
      source: {
        name: "管道一",
        url: "https://news.example.com/story/456?utm_source=rss&utm_medium=feed",
        type: "news-rss",
        fetchedAt: "2026-07-05T00:00:00+08:00",
      },
    };
    const ev2: IntelEvent = {
      ...event("b", "管道二"),
      source: {
        name: "管道二",
        url: "https://news.example.com/story/456?utm_source=google_news",
        type: "news-rss",
        fetchedAt: "2026-07-05T00:00:00+08:00",
      },
    };
    const events = byId([ev1, ev2]);
    const net = fakeNet({
      a: [{ id: "b", type: "same-incident", weight: 1, why: "跨源佐證" }],
    });
    const res = corroborationOf("a", events, net);
    expect(res).toMatchObject({
      sources: 1,
      channels: 2,
      confirmed: false,
      isMultiChannel: true,
    });
  });

  it("不同發布者的同事件候選只提供多來源線索，維持未查證", () => {
    const ev1: IntelEvent = {
      ...event("a", "中央社 RSS"),
      source: {
        name: "中央社 RSS",
        publisherName: "中央社",
        url: "https://www.cna.com.tw/news/123",
        type: "news-rss",
        fetchedAt: "2026-07-05T00:00:00+08:00",
      },
    };
    const ev2: IntelEvent = {
      ...event("b", "自由時報 RSS"),
      source: {
        name: "自由時報 RSS",
        publisherName: "自由時報",
        url: "https://news.ltn.com.tw/news/456",
        type: "news-rss",
        fetchedAt: "2026-07-05T00:00:00+08:00",
      },
    };
    const events = byId([ev1, ev2]);
    const net = fakeNet({
      a: [{ id: "b", type: "same-incident", weight: 1, why: "跨源佐證" }],
    });
    const res = corroborationOf("a", events, net);
    expect(res).toMatchObject({
      sources: 2,
      channels: 2,
      confirmed: false,
      verification: "unverified",
      isMultiChannel: false,
    });
  });
});
