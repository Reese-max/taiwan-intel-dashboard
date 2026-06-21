import { describe, it, expect } from "vitest";
import { mapMissingEvents, photoToken } from "../scripts/lib/fetch-missing.mjs";

const FETCHED_AT = "2026-06-20T00:00:00.000Z";

const RECORDS = [
  {
    E8_SJ_NM: "林O成",
    E8_SJ_GENDER: "男",
    E8_SJ_BIRTH_YEAR: "19970711",
    E8_SJ_HEIGHT: "168",
    E8_SJ_SHAPE: "中等身材",
    E8_SJ_SHIRT: "白色襯衫",
    E8_SJ_PANT: "黑色長褲",
    E8_OC_DATE: "20260619",
    E8_OC_PLACE: "01",
    E8_PIC_URL: "https://eze8.npa.gov.tw/E82OpendataWebE/missingPerson/ShowPhoto/Z115069AB6O1K7F",
  },
  {
    E8_SJ_NM: "王O婷",
    E8_SJ_GENDER: "女",
    E8_SJ_BIRTH_YEAR: "20150101",
    E8_OC_DATE: "20260601",
    E8_PIC_URL: "https://eze8.npa.gov.tw/E82OpendataWebE/missingPerson/ShowPhoto/ABC123",
  },
  // 重複 photo token → 應去重
  {
    E8_SJ_NM: "林O成",
    E8_SJ_GENDER: "男",
    E8_OC_DATE: "20260619",
    E8_PIC_URL: "https://eze8.npa.gov.tw/E82OpendataWebE/missingPerson/ShowPhoto/Z115069AB6O1K7F",
  },
];

describe("photoToken", () => {
  it("extracts the unique token from a ShowPhoto url", () => {
    expect(photoToken("https://eze8.npa.gov.tw/E82OpendataWebE/missingPerson/ShowPhoto/Z115069AB6O1K7F")).toBe(
      "Z115069AB6O1K7F",
    );
    expect(photoToken("")).toBe("");
  });
});

describe("mapMissingEvents", () => {
  it("maps records, dedupes by photo token, builds stable ids", () => {
    const events = mapMissingEvents({ records: RECORDS, fetchedAt: FETCHED_AT, nowYear: 2026 });
    expect(events).toHaveLength(2); // 去重後 2 筆
    const lin = events.find((e) => e.id === "missing-Z115069AB6O1K7F");
    expect(lin).toBeDefined();
    expect(lin!.category).toBe("協尋");
    expect(lin!.scope).toBe("domestic");
    expect(lin!.lat).toBeNull();
    expect(lin!.timestamp).toBe("2026-06-19T00:00:00+08:00");
    expect(lin!.title).toContain("林O成");
    expect(lin!.title).toContain("29歲"); // 2026 - 1997
    expect(lin!.summary).toContain("白色襯衫");
    expect(lin!.source.datasetId).toBe("14420");
    expect(lin!.source.recordRef).toBe("Z115069AB6O1K7F");
  });

  it("escalates risk for minors and elderly", () => {
    const events = mapMissingEvents({ records: RECORDS, fetchedAt: FETCHED_AT, nowYear: 2026 });
    expect(events.find((e) => e.id === "missing-ABC123")!.riskLevel).toBe("high"); // 11 歲未成年
    expect(events.find((e) => e.id === "missing-Z115069AB6O1K7F")!.riskLevel).toBe("medium"); // 29 歲
  });

  it("returns empty for no records", () => {
    expect(mapMissingEvents({ records: [], fetchedAt: FETCHED_AT })).toEqual([]);
  });
});
