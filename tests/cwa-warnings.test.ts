import { afterEach, describe, it, expect, vi } from "vitest";
import { fetchCwa, fetchCwaWarnings, mapCwaWarningEvents } from "../scripts/lib/fetch-cwa.mjs";

const FETCHED_AT = "2026-06-19T00:00:00.000Z";

afterEach(() => vi.unstubAllGlobals());

// 真實 W-C0033-001 結構（取自實打）：location[] 內每縣市帶 hazardConditions.hazards[]，
// 每筆 hazard = { info:{phenomena, significance}, validTime:{startTime, endTime} }。
const LOCATIONS = [
  // 無生效告警 → 不應產生事件
  { locationName: "臺中市", geocode: 66, hazardConditions: { hazards: [] } },
  // 單一告警（真實樣本）
  {
    locationName: "連江縣",
    geocode: 9007,
    hazardConditions: {
      hazards: [
        {
          info: { language: "zh-TW", phenomena: "陸上強風", significance: "特報" },
          validTime: { startTime: "2026-06-19 11:00:00", endTime: "2026-06-19 17:00:00" },
        },
      ],
    },
  },
  // 同縣多重告警 → 應各自產生一筆
  {
    locationName: "宜蘭縣",
    geocode: 1002,
    hazardConditions: {
      hazards: [
        {
          info: { phenomena: "大雨", significance: "特報" },
          validTime: { startTime: "2026-06-19 08:00:00", endTime: "2026-06-19 20:00:00" },
        },
        {
          info: { phenomena: "豪雨", significance: "特報" },
          validTime: { startTime: "2026-06-19 09:00:00", endTime: "2026-06-19 18:00:00" },
        },
      ],
    },
  },
  // 最嚴重等級
  {
    locationName: "花蓮縣",
    geocode: 1005,
    hazardConditions: {
      hazards: [
        {
          info: { phenomena: "超大豪雨", significance: "特報" },
          validTime: { startTime: "2026-06-19 06:00:00", endTime: "2026-06-19 23:00:00" },
        },
      ],
    },
  },
  // 最輕等級
  {
    locationName: "澎湖縣",
    geocode: 1009,
    hazardConditions: {
      hazards: [
        {
          info: { phenomena: "濃霧", significance: "特報" },
          validTime: { startTime: "2026-06-19 05:00:00", endTime: "2026-06-19 10:00:00" },
        },
      ],
    },
  },
];

describe("mapCwaWarningEvents", () => {
  it("地震與警特報遇到暫時性連線失敗時各自有限重試", async () => {
    const attempts = new Map<string, number>();
    const fetchMock = vi.fn(async (url: string) => {
      const datasetId = url.includes("E-A0015-001") ? "E-A0015-001" : "W-C0033-001";
      const attempt = (attempts.get(datasetId) || 0) + 1;
      attempts.set(datasetId, attempt);
      if (attempt === 1) {
        const cause = Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" });
        throw new TypeError("fetch failed", { cause });
      }
      const payload = datasetId === "E-A0015-001"
        ? {
          records: {
            Earthquake: [{
              EarthquakeNo: 1,
              Web: "https://scweb.cwa.gov.tw/zh-tw/earthquake/details/1",
              EarthquakeInfo: {
                OriginTime: "2026-06-19T01:00:00+08:00",
                Epicenter: { Location: "花蓮縣政府東方 10 公里", EpicenterLatitude: 24, EpicenterLongitude: 122 },
                EarthquakeMagnitude: { MagnitudeValue: 4.5 },
              },
            }],
          },
        }
        : { records: { location: LOCATIONS } };
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const quakes = await fetchCwa({ apiKey: "test", retryDelayMs: 0 });
    const warnings = await fetchCwaWarnings({ apiKey: "test", retryDelayMs: 0 });
    expect(quakes).toHaveLength(1);
    expect(warnings).toHaveLength(5);
    expect(attempts).toEqual(new Map([["E-A0015-001", 2], ["W-C0033-001", 2]]));
  });

  it("skips counties with no active hazards and emits one event per hazard", () => {
    const events = mapCwaWarningEvents({ locations: LOCATIONS, fetchedAt: FETCHED_AT });
    // 連江 1 + 宜蘭 2 + 花蓮 1 + 澎湖 1 = 5（臺中無告警被略過）
    expect(events).toHaveLength(5);
    expect(events.some((e) => e.region === "臺中市")).toBe(false);
  });

  it("maps a single warning to a fully-formed IntelEvent with county centroid", () => {
    const events = mapCwaWarningEvents({ locations: LOCATIONS, fetchedAt: FETCHED_AT });
    const ev = events.find((e) => e.region === "連江縣");
    expect(ev).toBeDefined();
    expect(ev!.id).toBe("cwa-warn-9007-陸上強風-20260619110000");
    expect(ev!.title).toBe("連江縣陸上強風特報");
    expect(ev!.lat).toBe(26.1608);
    expect(ev!.lng).toBe(119.9512);
    expect(ev!.timestamp).toBe("2026-06-19T11:00:00+08:00");
    expect(ev!.category).toBe("災防");
    expect(ev!.scope).toBe("domestic");
    expect(ev!.riskLevel).toBe("medium");
    expect(ev!.summary).toContain("2026-06-19 11:00:00");
    expect(ev!.summary).toContain("2026-06-19 17:00:00");
    expect(ev!.source.datasetId).toBe("W-C0033-001");
    expect(ev!.source.type).toBe("cwa");
    // 不可被誤判為警政事件：query 不得含「警政」
    expect(ev!.source.query).not.toContain("警政");
  });

  it("emits separate events for multiple hazards in one county", () => {
    const events = mapCwaWarningEvents({ locations: LOCATIONS, fetchedAt: FETCHED_AT });
    const yilan = events.filter((e) => e.region === "宜蘭縣");
    expect(yilan).toHaveLength(2);
    expect(yilan.map((e) => e.title).sort()).toEqual(["宜蘭縣大雨特報", "宜蘭縣豪雨特報"]);
  });

  it("derives risk level from phenomenon severity", () => {
    const events = mapCwaWarningEvents({ locations: LOCATIONS, fetchedAt: FETCHED_AT });
    const risk = (title: string) => events.find((e) => e.title === title)?.riskLevel;
    expect(risk("花蓮縣超大豪雨特報")).toBe("critical");
    expect(risk("宜蘭縣豪雨特報")).toBe("high");
    expect(risk("宜蘭縣大雨特報")).toBe("medium");
    expect(risk("連江縣陸上強風特報")).toBe("medium");
    expect(risk("澎湖縣濃霧特報")).toBe("low");
  });

  it("produces unique ids across all events", () => {
    const events = mapCwaWarningEvents({ locations: LOCATIONS, fetchedAt: FETCHED_AT });
    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns empty for no locations", () => {
    expect(mapCwaWarningEvents({ locations: [], fetchedAt: FETCHED_AT })).toEqual([]);
    expect(mapCwaWarningEvents({ locations: undefined, fetchedAt: FETCHED_AT })).toEqual([]);
  });
});
