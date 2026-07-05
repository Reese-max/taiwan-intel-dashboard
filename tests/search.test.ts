import { describe, expect, it } from "vitest";
import { applySearchSubnet } from "../src/search";
import type { IntelEvent } from "../src/types/event";
import type { NetworkIndex } from "../src/data/network";

function makeEvent(overrides: Partial<IntelEvent>): IntelEvent {
  return {
    id: "evt",
    title: "",
    summary: "",
    region: "",
    category: "",
    timestamp: "2026-01-01T00:00:00+08:00",
    scope: "domestic",
    riskLevel: "low",
    source: {
      name: "",
      type: "manual",
      fetchedAt: "2026-01-01T00:00:00+08:00",
    },
    ...overrides,
  };
}

describe("applySearchSubnet", () => {
  it("空字串或未定義 query 回傳原全集（同參考）", () => {
    const events = [makeEvent({ id: "a" }), makeEvent({ id: "b", title: "第二則" })];
    const net = ({ related: () => [] } as unknown) as NetworkIndex;

    expect(applySearchSubnet(events, net)).toBe(events);
    expect(applySearchSubnet(events, net, "")).toBe(events);
    expect(applySearchSubnet(events, net, "   ")).toBe(events);
  });

  it("可命中 title/summary/region/category/source.name 任一欄位", () => {
    const events: IntelEvent[] = [
      makeEvent({ id: "title", title: "邊境情報速報" }),
      makeEvent({ id: "summary", summary: "摘要欄位有關鍵字" }),
      makeEvent({ id: "region", region: "北部地區" }),
      makeEvent({ id: "category", category: "氣象事件" }),
      makeEvent({ id: "source", source: { name: "中央通訊社", type: "manual", fetchedAt: "2026-01-01T00:00:00+08:00" } }),
    ];
    const net = ({ related: () => [] } as unknown) as NetworkIndex;

    expect(applySearchSubnet(events, net, "速報").map((e) => e.id)).toEqual(["title"]);
    expect(applySearchSubnet(events, net, "關鍵字").map((e) => e.id)).toEqual(["summary"]);
    expect(applySearchSubnet(events, net, "北部").map((e) => e.id)).toEqual(["region"]);
    expect(applySearchSubnet(events, net, "氣象").map((e) => e.id)).toEqual(["category"]);
    expect(applySearchSubnet(events, net, "中央").map((e) => e.id)).toEqual(["source"]);
  });

  it("子網擴散時僅納入在 events 現有結果集中的關聯", () => {
    const events: IntelEvent[] = [
      makeEvent({ id: "a", title: "核心警示" }),
      makeEvent({ id: "b", title: "關聯節點" }),
    ];
    const net = ({
      related(id: string) {
        if (id === "a")
          return [
            { id: "b", type: "same-incident", weight: 1, why: "b 是關聯" },
            { id: "c", type: "same-topic", weight: 1, why: "c 不在 events 中" },
          ];
        return [];
      },
    } as unknown) as NetworkIndex;

    expect(applySearchSubnet(events, net, "核心")).toEqual([events[0], events[1]]);
  });

  it("以 zh-TW toLocaleLowerCase 處理大小寫與全形查詢", () => {
    const events: IntelEvent[] = [
      makeEvent({ id: "lower", title: "critical update" }),
      makeEvent({ id: "full", title: "ａｂｃ" }),
    ];
    const net = ({ related: () => [] } as unknown) as NetworkIndex;

    expect(applySearchSubnet(events, net, "CRITICAL")).toEqual([events[0]]);
    expect(applySearchSubnet(events, net, "ＡＢＣ")).toEqual([events[1]]);
  });
});
