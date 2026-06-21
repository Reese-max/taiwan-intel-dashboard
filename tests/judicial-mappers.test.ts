import { describe, it, expect } from "vitest";
import { mapJudicialEvents } from "../scripts/lib/fetch-judicial.mjs";

const FETCHED_AT = "2026-06-19T00:00:00.000Z";

const CASES = [
  {
    jid: "TYDM,115,桃交簡,382,20260331,1",
    jtitle: "公共危險",
    jdate: "20260331",
    court_code: "TYDM",
    issue: "酒後騎乘機車致不能安全駕駛之公共危險罪責",
    outcome_type: "有罪",
    sentence: "有期徒刑2月，併科罰金新臺幣8萬元",
    key_reasoning: "吐氣酒精濃度達每公升0.70毫克，自撞路樹",
    jpdf: "https://data.judicial.gov.tw/x.pdf",
    similarity: 0.72,
  },
  {
    jid: "KSDM,114,訴,55,20251101,1",
    jtitle: "殺人",
    jdate: "20251101",
    court_code: "KSDM",
    sentence: "無期徒刑",
  },
  // 重複 jid → 應去重
  {
    jid: "TYDM,115,桃交簡,382,20260331,1",
    jtitle: "公共危險",
    jdate: "20260331",
    court_code: "TYDM",
  },
];

describe("mapJudicialEvents", () => {
  it("maps cases, dedupes by jid, geolocates by court prefix", () => {
    const events = mapJudicialEvents({ cases: CASES, fetchedAt: FETCHED_AT });
    expect(events).toHaveLength(2); // 去重後 2 筆
    const ty = events.find((e) => e.id.includes("TYDM"));
    expect(ty).toBeDefined();
    expect(ty!.region).toBe("桃園市");
    expect(ty!.lat).toBeCloseTo(24.9937, 2);
    expect(ty!.timestamp).toBe("2026-03-31T00:00:00+08:00");
    expect(ty!.category).toBe("司法判決");
    expect(ty!.scope).toBe("domestic");
    expect(ty!.summary).toContain("刑度");
    expect(ty!.source.datasetId).toBe("judicial");
    expect(ty!.source.query).not.toContain("警政");
  });

  it("escalates risk for severe crimes", () => {
    const events = mapJudicialEvents({ cases: CASES, fetchedAt: FETCHED_AT });
    expect(events.find((e) => e.id.includes("KSDM"))!.riskLevel).toBe("critical"); // 殺人/無期徒刑
    expect(events.find((e) => e.id.includes("TYDM"))!.riskLevel).toBe("warning"); // 有罪/有期徒刑
  });

  it("returns empty for no cases", () => {
    expect(mapJudicialEvents({ cases: [], fetchedAt: FETCHED_AT })).toEqual([]);
  });
});
