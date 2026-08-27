import { describe, expect, it } from "vitest";
import { crimeWeeklySpawnEnv, fetchPolice, isPoliceDomesticEvent } from "../scripts/lib/fetch-police.mjs";

describe("crime weekly parser spawn environment", () => {
  it("forces UTF-8 stdout on Windows code-page shells", () => {
    const env = crimeWeeklySpawnEnv({ PATH: "x" });

    expect(env.PYTHONIOENCODING).toBe("utf-8");
    expect(env.PYTHONUTF8).toBe("1");
    expect(env.PATH).toBe("x");
  });

  it("只接受直接警政來源，不沿用已移除的舊資料集", async () => {
    const event = { id: "crime-week-11530-竊盜", source: { datasetId: "13166" } };
    const result = await fetchPolice({ fetchWeekly: async () => [event] });

    expect(result.events).toEqual([event]);
    expect(result.substatus.crimeWeekly).toEqual({ ok: true, count: 1 });
    expect(isPoliceDomesticEvent(event)).toBe(true);
    expect(isPoliceDomesticEvent({ id: "police-news-old", source: { datasetId: "7505" } })).toBe(false);
  });
});
