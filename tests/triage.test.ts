import { describe, expect, it } from "vitest";
import { buildTriage } from "../src/utils/triage";
import type { IntelEvent, RiskLevel } from "../src/types/event";

const event = (id: string, riskLevel: RiskLevel, timestamp: string): IntelEvent => ({
  id,
  title: `事件 ${id}`,
  region: "台北市",
  timestamp,
  category: "治安",
  scope: "domestic",
  riskLevel,
  summary: "摘要",
  source: {
    name: "測試來源",
    type: "manual",
    fetchedAt: "2026-07-05T00:00:00.000Z",
  },
});

describe("buildTriage", () => {
  it("只納入 critical/high 事件，排除 medium/low", () => {
    const result = buildTriage(
      [
        event("low", "low", "2026-07-05T01:00:00.000Z"),
        event("medium", "medium", "2026-07-05T02:00:00.000Z"),
        event("high", "high", "2026-07-05T03:00:00.000Z"),
        event("critical", "critical", "2026-07-05T04:00:00.000Z"),
      ],
      new Set(),
      Date.parse("2026-07-05T05:00:00.000Z"),
    );

    expect(result.total).toBe(2);
    expect(result.items.map((e) => e.id)).toEqual(["critical", "high"]);
  });

  it("排序為 critical 優先，同級再 timestamp 新到舊", () => {
    const result = buildTriage(
      [
        event("high-new", "high", "2026-07-05T04:00:00.000Z"),
        event("critical-old", "critical", "2026-07-05T01:00:00.000Z"),
        event("high-old", "high", "2026-07-05T02:00:00.000Z"),
        event("critical-new", "critical", "2026-07-05T03:00:00.000Z"),
      ],
      [],
      Date.parse("2026-07-05T05:00:00.000Z"),
    );

    expect(result.items.map((e) => e.id)).toEqual(["critical-new", "critical-old", "high-new", "high-old"]);
  });

  it("依 ackedIds 標記 unread，Set 與 array 皆可", () => {
    const withSet = buildTriage(
      [event("a", "critical", "2026-07-05T01:00:00.000Z")],
      new Set(["a"]),
      Date.parse("2026-07-05T05:00:00.000Z"),
    );
    const withArray = buildTriage(
      [event("b", "high", "2026-07-05T01:00:00.000Z")],
      ["not-b"],
      Date.parse("2026-07-05T05:00:00.000Z"),
    );

    expect(withSet.items[0].unread).toBe(false);
    expect(withSet.unreadCount).toBe(0);
    expect(withArray.items[0].unread).toBe(true);
    expect(withArray.unreadCount).toBe(1);
  });

  it("套用 cap 並計算 capped 未顯示數", () => {
    const result = buildTriage(
      [
        event("c1", "critical", "2026-07-05T03:00:00.000Z"),
        event("c2", "critical", "2026-07-05T02:00:00.000Z"),
        event("h1", "high", "2026-07-05T01:00:00.000Z"),
      ],
      ["c2"],
      Date.parse("2026-07-05T05:00:00.000Z"),
      { cap: 2 },
    );

    expect(result.items.map((e) => e.id)).toEqual(["c1", "c2"]);
    expect(result.total).toBe(3);
    expect(result.capped).toBe(1);
    expect(result.unreadCount).toBe(2);
  });

  it("空輸入回傳空結果", () => {
    const result = buildTriage([], [], Date.parse("2026-07-05T05:00:00.000Z"));

    expect(result).toEqual({ items: [], unreadCount: 0, total: 0, capped: 0 });
  });

  it("非法 timestamp 不 crash，且同風險排序落在合法 timestamp 後", () => {
    const result = buildTriage(
      [
        event("bad", "high", "not-a-date"),
        event("good", "high", "2026-07-05T01:00:00.000Z"),
        event("critical", "critical", "bad-date-too"),
      ],
      [],
      Date.parse("2026-07-05T05:00:00.000Z"),
    );

    expect(result.items.map((e) => e.id)).toEqual(["critical", "good", "bad"]);
  });
});
