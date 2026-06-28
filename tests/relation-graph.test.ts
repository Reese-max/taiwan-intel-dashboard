import { describe, expect, it } from "vitest";
import { edgeTypeLabel } from "../src/data/network";
import { renderRelationGraph, type RelationNode } from "../src/components/RelationGraph";
import type { IntelEvent } from "../src/types/event";

function event(overrides: Partial<IntelEvent> = {}): IntelEvent {
  return {
    id: "evt",
    title: "測試事件",
    region: "臺北市",
    timestamp: "2026-06-20T10:00:00+08:00",
    category: "治安",
    scope: "domestic",
    riskLevel: "medium",
    summary: "",
    source: { name: "測試來源", type: "news-rss", fetchedAt: "2026-06-20T10:00:00+08:00" },
    ...overrides,
  };
}

describe("same-topic weak relation UI", () => {
  it("labels same-topic as weak relation in shared edge labels and graph legend", () => {
    expect(edgeTypeLabel("same-topic")).toBe("同題情勢（弱關聯）");

    const container = { hidden: false, innerHTML: "" } as HTMLElement;
    const neighbor: RelationNode = {
      event: event({ id: "neighbor", title: "同題事件" }),
      rel: { id: "neighbor", type: "same-topic", weight: 0.3, why: "同地同類相關情勢" },
    };

    renderRelationGraph(container, event({ id: "center", title: "中心事件" }), [neighbor]);

    expect(container.innerHTML).toContain("同題情勢（弱關聯）");
    expect(container.innerHTML).toContain("data-type=\"same-topic\"");
  });
});
