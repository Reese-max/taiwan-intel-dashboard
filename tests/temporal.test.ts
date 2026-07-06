import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { applyTemporal, temporalStateFor } from "../scripts/lib/temporal.mjs";

const NOW = Date.parse("2026-07-07T00:00:00.000Z");

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt",
    title: "一般事件",
    category: "治安",
    timestamp: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("temporalStateFor", () => {
  it("判決/定讞/判刑標 judicial；起訴/羈押/偵辦不標", () => {
    expect(temporalStateFor(event({ title: "地院宣判詐欺案被告判刑" }), { now: NOW })).toBe("judicial");
    expect(temporalStateFor(event({ title: "高院判決出爐" }), { now: NOW })).toBe("judicial");
    expect(temporalStateFor(event({ title: "案件定讞後入監" }), { now: NOW })).toBe("judicial");

    expect(temporalStateFor(event({ title: "檢方起訴詐欺集團" }), { now: NOW })).toBeUndefined();
    expect(temporalStateFor(event({ title: "嫌犯羈押禁見" }), { now: NOW })).toBeUndefined();
    expect(temporalStateFor(event({ title: "警方持續偵辦中" }), { now: NOW })).toBeUndefined();
  });

  it("老於 180 天標 historical；179 天不標", () => {
    expect(temporalStateFor(event({ timestamp: "2026-01-07T23:59:59.999Z" }), { now: NOW })).toBe("historical");
    expect(temporalStateFor(event({ timestamp: "2026-01-09T00:00:00.000Z" }), { now: NOW })).toBeUndefined();
  });

  it("協尋 category 老事件不標 historical", () => {
    expect(temporalStateFor(event({ category: "協尋", timestamp: "2025-01-01T00:00:00.000Z" }), { now: NOW })).toBeUndefined();
  });

  it("judicial 優先於 historical", () => {
    expect(temporalStateFor(event({ title: "法院判決詐欺案", timestamp: "2025-01-01T00:00:00.000Z" }), { now: NOW })).toBe("judicial");
  });

  it("timestamp 無效不標", () => {
    expect(temporalStateFor(event({ timestamp: "not-a-date" }), { now: NOW })).toBeUndefined();
  });
});

describe("applyTemporal", () => {
  it("無標記者回傳同一參考，有標記者淺拷貝加 temporal 欄位", () => {
    const current = event({ id: "current" });
    const old = event({ id: "old", timestamp: "2025-01-01T00:00:00.000Z" });

    const result = applyTemporal([current, old], { now: NOW });

    expect(result[0]).toBe(current);
    expect(result[1]).not.toBe(old);
    expect(result[1]).toMatchObject({ id: "old", temporal: "historical" });
  });
});
