import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { mapCrimeWeeklyPayload } from "../scripts/lib/fetch-police.mjs";

describe("crime weekly mapper", () => {
  it("maps the official parser payload without network or MCP", () => {
    const events = mapCrimeWeeklyPayload({
      period: "115年第34週",
      periodEnd: "2026-08-23T12:00:00+08:00",
      fileName: "crime-week-34.ods",
      totalCurrent: 200,
      currentCounts: { 毒品: 200, 詐欺: 0 },
      compiledAt: "2026-08-24",
    }, { fetchedAt: "2026-08-24T00:00:00.000Z" });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      id: "crime-week-summary-115年第34週",
      scope: "domestic",
      source: { datasetId: "13166", fetchedAt: "2026-08-24T00:00:00.000Z" },
    });
    expect(events[1]).toMatchObject({ title: "週統計｜毒品 200 件", riskLevel: "high" });
  });
});
