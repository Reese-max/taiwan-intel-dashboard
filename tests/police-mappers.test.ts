import { describe, it, expect } from "vitest";
import {
  dedupeTrafficRows,
  calendarTimestamp,
  formatNtd,
  fraudDashRisk,
  gregorianYmd8ToIso,
  localDateTimeToIso,
  parseCasualties,
  parseCoordPair,
  rocChineseDateTimeToIso,
  rocYmdHmToIso,
  rocYmd7ToIso,
  rocYmToIso,
  speedRisk,
  trafficRisk,
  trafficTimestamp,
  weeklyCrimeRisk,
} from "../scripts/lib/police-mappers.mjs";

describe("police-mappers", () => {
  it("parses ROC 7-digit date", () => {
    expect(rocYmd7ToIso("1140401")).toBe("2025-04-01T12:00:00+08:00");
  });

  it("parses ROC year-month", () => {
    expect(rocYmToIso("11412")).toBe("2025-12-01T00:00:00+08:00");
  });

  it("builds traffic timestamp", () => {
    expect(trafficTimestamp("20251201", "930")).toBe("2025-12-01T00:09:30+08:00");
  });

  it("parses casualties and risk", () => {
    const text = "死亡1;受傷2";
    expect(parseCasualties(text)).toEqual({ deaths: 1, injuries: 2 });
    expect(trafficRisk("A1", text)).toBe("critical");
    expect(trafficRisk("A2", "死亡0;受傷1")).toBe("medium");
  });

  it("parses coord pair and calendar timestamp", () => {
    expect(parseCoordPair("22.907613, 120.273524")).toEqual({
      lat: 22.907613,
      lng: 120.273524,
    });
    expect(calendarTimestamp("2025", "01", "9", "0", "55")).toBe(
      "2025-01-09T00:55:00+08:00",
    );
    expect(gregorianYmd8ToIso("20241212")).toBe("2024-12-12T12:00:00+08:00");
  });

  it("parses police news, assembly, and historical traffic timestamps", () => {
    expect(localDateTimeToIso("2026-06-09T10:00")).toBe("2026-06-09T10:00:00+08:00");
    expect(localDateTimeToIso("2026/06/17 09:00")).toBe("2026-06-17T09:00:00+08:00");
    expect(localDateTimeToIso('"2019/1/2-08:37"')).toBe("2019-01-02T08:37:00+08:00");
    expect(localDateTimeToIso("2019/5/1 下午 12:35:00")).toBe("2019-05-01T12:35:00+08:00");
    expect(rocYmdHmToIso("1140729  2109")).toBe("2025-07-29T21:09:00+08:00");
    expect(rocChineseDateTimeToIso("104年01月01日 00時02分00秒")).toBe(
      "2015-01-01T00:02:00+08:00",
    );
  });

  it("formats money and tier-2 risk helpers", () => {
    expect(formatNtd(881431867)).toBe("NT$881,431,867");
    expect(formatNtd("1234567")).toBe("NT$1,234,567");
    expect(formatNtd("not-a-number")).toBe("NT$not-a-number");
    expect(speedRisk(99, 3768)).toBe("high");
    expect(fraudDashRisk(946786867)).toBe("high");
    expect(weeklyCrimeRisk("毒品", 203)).toBe("high");
    expect(rocYmd7ToIso("1130726")).toBe("2024-07-26T12:00:00+08:00");
  });

  it("dedupes traffic rows by incident key", () => {
    const columns = ["發生日期", "發生時間", "發生地點", "當事者順位"];
    const rows = [
      ["20251201", "100", "A路", "2"],
      ["20251201", "100", "A路", "1"],
      ["20251202", "200", "B路", "1"],
    ];
    const out = dedupeTrafficRows(rows, columns);
    expect(out).toHaveLength(2);
    expect(out[0][3]).toBe("1");
  });
});
