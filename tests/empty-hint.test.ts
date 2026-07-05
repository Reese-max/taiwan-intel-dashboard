import { describe, expect, it } from "vitest";
import { emptyListHint } from "../src/utils/emptyHint";
import type { IntelEvent } from "../src/types/event";

const BASE_TIME = Date.parse("2026-07-05T00:00:00.000Z");

function mkEvent(category: string, tsIso: string, overrides: Partial<IntelEvent> = {}): IntelEvent {
  return {
    id: overrides.id ?? `e-${Math.random()}`,
    title: "測試",
    region: "台灣",
    timestamp: tsIso,
    category,
    scope: "domestic",
    riskLevel: "medium",
    summary: "測試摘要",
    source: {
      name: "Unit Test",
      type: "manual",
      fetchedAt: "2026-07-01T00:00:00Z",
    },
    ...overrides,
  };
}

describe("emptyListHint", () => {
  it("category 在時間窗外且有符合分類資料，回報時間窗外提示", () => {
    const all: IntelEvent[] = [
      mkEvent("採購", new Date(BASE_TIME - 4 * 86_400_000).toISOString(), { id: "p1" }),
      mkEvent("採購", new Date(BASE_TIME - 5 * 86_400_000).toISOString(), { id: "p2" }),
      mkEvent("其他", new Date(BASE_TIME - 1 * 86_400_000).toISOString(), { id: "o1" }),
      mkEvent("衛生", new Date(BASE_TIME - 1 * 86_400_000).toISOString(), { id: "h1" }),
    ];

    const msg = emptyListHint(all, { category: "採購", sinceDays: 3 }, BASE_TIME);

    expect(msg).toBe("此分類最近一筆在 4 天前，改選「全部時間」可檢視");
  });

  it("state 有 query 或 minRisk 時回 null（避免誤判）", () => {
    const all: IntelEvent[] = [mkEvent("採購", new Date(BASE_TIME - 4 * 86_400_000).toISOString(), { id: "p1" })];

    expect(emptyListHint(all, { category: "採購", sinceDays: 3, query: "hello" }, BASE_TIME)).toBeNull();
    expect(emptyListHint(all, { category: "採購", sinceDays: 3, minRisk: "high" }, BASE_TIME)).toBeNull();
  });

  it("無 category 或無 sinceDays 時回 null", () => {
    const all: IntelEvent[] = [mkEvent("採購", new Date(BASE_TIME - 4 * 86_400_000).toISOString(), { id: "p1" })];

    expect(emptyListHint(all, { sinceDays: 3 }, BASE_TIME)).toBeNull();
    expect(emptyListHint(all, { category: "採購" }, BASE_TIME)).toBeNull();
  });

  it("該分類在全量資料無資料時回 null（避免當成時間窗外）", () => {
    const all: IntelEvent[] = [
      mkEvent("衛生", new Date(BASE_TIME - 1 * 86_400_000).toISOString(), { id: "h1" }),
      mkEvent("環境", new Date(BASE_TIME - 1 * 86_400_000).toISOString(), { id: "e1" }),
    ];

    expect(emptyListHint(all, { category: "採購", sinceDays: 3 }, BASE_TIME)).toBeNull();
  });

  it("該分類最近一筆在時間窗內時回 null", () => {
    const all: IntelEvent[] = [
      mkEvent("採購", new Date(BASE_TIME - 2 * 86_400_000).toISOString(), { id: "p1" }),
      mkEvent("採購", new Date(BASE_TIME - 1 * 86_400_000).toISOString(), { id: "p2" }),
      mkEvent("環境", new Date(BASE_TIME - 4 * 86_400_000).toISOString(), { id: "e1" }),
    ];

    expect(emptyListHint(all, { category: "採購", sinceDays: 3 }, BASE_TIME)).toBeNull();
  });
});
