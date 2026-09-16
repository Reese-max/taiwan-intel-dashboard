import { describe, it, expect } from "vitest";
import { filterEvents } from "../src/data/loader";
import type { IntelEvent } from "../src/types/event";

const base: IntelEvent = {
  id: "base",
  title: "測試事件",
  region: "臺北市",
  timestamp: "2026-09-16T12:00:00Z",
  category: "治安",
  scope: "domestic",
  riskLevel: "low",
  summary: "測試摘要",
  source: { name: "測試來源", type: "manual", fetchedAt: "2026-09-16T12:05:00Z" },
};

describe("filterEvents — Issue #27 滾動 N*24 小時與日期邊界契約", () => {
  const fixedNow = Date.parse("2026-09-16T12:00:00.000Z"); // 2026-09-16T20:00:00+08:00
  const cutoff3Days = fixedNow - 3 * 86400000; // 2026-09-13T12:00:00.000Z
  const maxFuture = fixedNow + 86400000; // 2026-09-17T12:00:00.000Z

  it("無效日期在限定時間窗口（sinceDays）下不可無聲通過", () => {
    const events: IntelEvent[] = [
      { ...base, id: "valid", timestamp: "2026-09-15T12:00:00Z" },
      { ...base, id: "invalid-string", timestamp: "not-a-date" },
      { ...base, id: "empty-string", timestamp: "" },
    ];
    const res = filterEvents(events, { sinceDays: 3, now: fixedNow });
    expect(res.map((e) => e.id)).toEqual(["valid"]);
  });

  it("若明確啟用 includeUnknownTime，則允許無效日期通過", () => {
    const events: IntelEvent[] = [
      { ...base, id: "valid", timestamp: "2026-09-15T12:00:00Z" },
      { ...base, id: "invalid-string", timestamp: "not-a-date" },
    ];
    const res = filterEvents(events, { sinceDays: 3, now: fixedNow, includeUnknownTime: true });
    expect(res.map((e) => e.id)).toEqual(["valid", "invalid-string"]);
  });

  it("全部時間（無 sinceDays）時不丟棄無效或缺少日期", () => {
    const events: IntelEvent[] = [
      { ...base, id: "valid", timestamp: "2026-09-15T12:00:00Z" },
      { ...base, id: "invalid-string", timestamp: "not-a-date" },
    ];
    const res = filterEvents(events, { now: fixedNow });
    expect(res.map((e) => e.id)).toEqual(["valid", "invalid-string"]);
  });

  it("精確 cutoff 邊界判定（包含 cutoff，排除 cutoff 前 1ms）", () => {
    const events: IntelEvent[] = [
      { ...base, id: "exact-cutoff", timestamp: new Date(cutoff3Days).toISOString() },
      { ...base, id: "before-cutoff", timestamp: new Date(cutoff3Days - 1).toISOString() },
      { ...base, id: "after-cutoff", timestamp: new Date(cutoff3Days + 1).toISOString() },
    ];
    const res = filterEvents(events, { sinceDays: 3, now: fixedNow });
    expect(res.map((e) => e.id)).toEqual(["exact-cutoff", "after-cutoff"]);
  });

  it("未來預警容錯窗口判定（包含未來的 24h 預警，排除未來 >24h 項目）", () => {
    const events: IntelEvent[] = [
      { ...base, id: "near-future", timestamp: "2026-09-16T18:00:00Z" },
      { ...base, id: "exact-max-future", timestamp: new Date(maxFuture).toISOString() },
      { ...base, id: "exceed-max-future", timestamp: new Date(maxFuture + 1).toISOString() },
    ];
    const res = filterEvents(events, { sinceDays: 3, now: fixedNow });
    expect(res.map((e) => e.id)).toEqual(["near-future", "exact-max-future"]);
  });

  it("時區與 offset 等價判定（UTC vs +08:00 同一時刻）", () => {
    const events: IntelEvent[] = [
      { ...base, id: "utc", timestamp: "2026-09-16T12:00:00Z" },
      { ...base, id: "tpe", timestamp: "2026-09-16T20:00:00+08:00" },
    ];
    const res = filterEvents(events, { sinceDays: 3, now: fixedNow });
    expect(res.map((e) => e.id)).toEqual(["utc", "tpe"]);
  });
});
