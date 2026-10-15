import { describe, expect, it } from "vitest";
import {
  canCarryOverPolice,
  isTransientPoliceFailure,
  policeCarryoverEvidence,
} from "../scripts/lib/police-carryover.mjs";

const now = Date.parse("2026-09-29T03:00:00Z");
const lastSuccessAt = "2026-09-28T03:00:00Z";

describe("police weekly carry-over", () => {
  it("requires a real previous weekly event and successful fetch timestamp", () => {
    const evidence = policeCarryoverEvidence({
      events: [{ source: { datasetId: "13166" } }, { source: { datasetId: "tw-news" } }],
      provenance: { sources: [{ datasetId: "13166", lastSuccessAt }] },
      now,
    });
    expect(evidence).toEqual({ count: 1, lastSuccessAt });
    expect(policeCarryoverEvidence({ events: [], provenance: {}, now })).toBeNull();
    expect(policeCarryoverEvidence({
      events: [{ source: { datasetId: "13166" } }],
      provenance: { sources: [{ datasetId: "13166", stale: true }] },
      now,
    })).toBeNull();
  });

  it("only permits bounded transient outages and keeps parser errors fatal", () => {
    const transient = { ok: false, error: "HTTP Error 502", carryOver: { count: 7, lastSuccessAt } };
    expect(isTransientPoliceFailure(transient.error)).toBe(true);
    expect(canCarryOverPolice(transient, { now })).toBe(true);
    expect(canCarryOverPolice(transient, { now: now + 15 * 86400_000 })).toBe(false);
    expect(canCarryOverPolice({ ...transient, error: "failed to parse weekly stats" }, { now })).toBe(false);
    expect(canCarryOverPolice({ ...transient, carryOver: { count: 0, lastSuccessAt } }, { now })).toBe(false);
  });
});
