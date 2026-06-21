import { describe, it, expect } from "vitest";
import {
  parseRocPeriodLabel,
  latestRocPeriod,
  mapCrimeRateEvents,
  mapDuiTaichungEvents,
  mapDvTaipeiEvents,
} from "../scripts/lib/fetch-police.mjs";

const FETCHED_AT = "2026-06-19T00:00:00.000Z";

describe("ROC period parsing", () => {
  it("parses monthly labels (with and without 機關別總計 suffix)", () => {
    expect(parseRocPeriodLabel("114年12月")).toEqual({ year: 114, month: 12, key: "11412" });
    expect(parseRocPeriodLabel("115年 4月/ 機關別總計")).toEqual({ year: 115, month: 4, key: "11504" });
  });

  it("rejects annual and cumulative labels (no single month)", () => {
    expect(parseRocPeriodLabel("115年/ 機關別總計")).toBeNull();
    expect(parseRocPeriodLabel("115年 (1~4月)/ 機關別總計")).toBeNull();
  });

  it("picks the latest single month across mixed labels", () => {
    const latest = latestRocPeriod([
      "114年12月",
      "115年 3月/ 機關別總計",
      "115年/ 機關別總計",
      "115年 4月/ 機關別總計",
      "115年 (1~4月)/ 機關別總計",
    ]);
    expect(latest).toMatchObject({ year: 115, month: 4, key: "11504" });
  });
});

describe("mapCrimeRateEvents", () => {
  const occColumns = ["刑案發生及破獲率", "刑案發生率_件_10萬人口"];
  const clrColumns = ["刑案發生及破獲率", "刑案破獲率_%"];

  it("emits one national stat event for the latest month with both rates", () => {
    const occRows = [
      ["114年 12月/ 機關別總計", "100.50"],
      ["115年/ 機關別總計", "400.00"],
      ["115年 (1~4月)/ 機關別總計", "350.00"],
      ["115年 3月/ 機關別總計", "90.10"],
      ["115年 4月/ 機關別總計", "95.20"],
    ];
    const clrRows = [
      ["115年 3月/ 機關別總計", "85.00"],
      ["115年 4月/ 機關別總計", "88.30"],
    ];
    const [event, ...rest] = mapCrimeRateEvents({ occRows, occColumns, clrRows, clrColumns, fetchedAt: FETCHED_AT });
    expect(rest).toHaveLength(0);
    expect(event.id).toBe("crime-rate-11504");
    expect(event.region).toBe("全國");
    expect(event.category).toBe("治安");
    expect(event.scope).toBe("domestic");
    expect(event.summary).toContain("95.20");
    expect(event.summary).toContain("88.30");
    expect(event.source.datasetId).toBe("103351");
    expect(event.timestamp).toBe("2026-04-01T00:00:00+08:00");
  });

  it("returns empty when there is no monthly row", () => {
    expect(
      mapCrimeRateEvents({
        occRows: [["115年/ 機關別總計", "400"]],
        occColumns,
        clrRows: [],
        clrColumns,
        fetchedAt: FETCHED_AT,
      }),
    ).toEqual([]);
  });
});

describe("mapDuiTaichungEvents", () => {
  const columns = ["地區", "欄位名稱", "數值", "資料時間日期"];

  it("aggregates the latest month and breaks down disposition types", () => {
    const rows = [
      ["臺中市", "第一分局_無肇事-舉發_汽車", "3", "2026-04-01T00:00:00"],
      ["臺中市", "第一分局_無肇事-移送法辦_機車", "2", "2026-04-01T00:00:00"],
      ["臺中市", "第六分局_拒絕酒測_汽車", "1", "2026-04-01T00:00:00"],
      ["臺中市", "和平分局_肇事-舉發_汽車", "1", "2026-04-01T00:00:00"],
      ["臺中市", "舊月份_無肇事-舉發_汽車", "9", "2026-03-01T00:00:00"],
    ];
    const [event] = mapDuiTaichungEvents({ rows, columns, fetchedAt: FETCHED_AT });
    expect(event.id).toBe("dui-taichung-202604");
    expect(event.category).toBe("交通");
    expect(event.region).toContain("臺中");
    // 7 = 3 + 2 + 1 + 1（排除 2026-03 的 9）
    expect(event.summary).toContain("取締酒駕 7 件");
    expect(event.summary).toContain("移送法辦 2");
    expect(event.summary).toContain("拒絕酒測 1");
    // 「肇事」須排除「無肇事」：僅 和平分局_肇事-舉發_汽車（1）
    expect(event.summary).toContain("肇事 1");
    expect(event.source.datasetId).toBe("88170");
  });
});

describe("mapDvTaipeiEvents", () => {
  const columns = ["時間", "區", "村里", "村里代碼", "年齡區間", "性別", "案件類型", "總計"];

  it("aggregates the latest period by case type", () => {
    const rows = [
      ["114年12月", "士林區", "x", "x", "a", "2", "婚姻暴力", "10"],
      ["114年12月", "大安區", "y", "y", "b", "1", "兒少保護", "5"],
      ["114年12月", "中正區", "z", "z", "c", "2", "婚姻暴力", "8"],
    ];
    const [event] = mapDvTaipeiEvents({ rows, columns, period: "114年12月", fetchedAt: FETCHED_AT });
    expect(event.id).toBe("dv-taipei-11412");
    expect(event.category).toBe("治安");
    expect(event.region).toContain("臺北");
    expect(event.summary).toContain("合計 23 件");
    expect(event.summary).toContain("婚姻暴力18");
    expect(event.source.datasetId).toBe("145744");
    expect(event.timestamp).toBe("2025-12-01T00:00:00+08:00");
  });

  it("returns empty when no rows or period", () => {
    expect(mapDvTaipeiEvents({ rows: [], columns, period: "114年12月", fetchedAt: FETCHED_AT })).toEqual([]);
  });
});
