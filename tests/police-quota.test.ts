import { describe, expect, it, vi } from "vitest";

// @ts-expect-error — JS ESM module without types
import { fetchPolice } from "../scripts/lib/fetch-police.mjs";

describe("direct police fetch", () => {
  it("performs one bounded official weekly fetch", async () => {
    const events = [{ id: "crime-week-test" }];
    const fetchWeekly = vi.fn(async () => events);

    const result = await fetchPolice({ fetchWeekly });

    expect(fetchWeekly).toHaveBeenCalledTimes(1);
    expect(result.events).toBe(events);
    expect(result.substatus.crimeWeekly).toEqual({ ok: true, count: 1 });
  });
});
