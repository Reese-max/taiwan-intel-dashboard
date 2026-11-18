import { describe, expect, it } from "vitest";
import {
  canCarryOverSource,
  sourceCarryoverEvidence,
  SOURCE_CARRYOVER_POLICIES,
} from "../scripts/lib/police-carryover.mjs";

const now = Date.parse("2026-09-29T03:00:00Z");
const lastSuccessAt = "2026-09-28T03:00:00Z";

// A stale snapshot can still have a bounded, genuine last success; its newer
// fetchedAt alone must never renew the carry-over window.
describe("bounded source carry-over", () => {
  it("uses the latest international event fetchedAt across feeds, not provenance or event order", () => {
    const policy = SOURCE_CARRYOVER_POLICIES.international;
    expect(policy?.maxHours).toBe(24);
    const events = [
      { source: { datasetId: "international-news", fetchedAt: lastSuccessAt } },
      { source: { datasetId: "gdelt-doc", fetchedAt: "2026-09-28T10:00:00+08:00" } },
      { source: { fetchedAt: "invalid" } },
    ];
    const provenance = { sources: [{ lastSuccessAt: new Date(now).toISOString() }] };
    expect(sourceCarryoverEvidence({ events, provenance, ...policy, now })).toEqual({ count: 3, lastSuccessAt });
    expect(sourceCarryoverEvidence({ events, provenance, ...policy, now: now + 1 })).toBeNull();
  });

  it("ignores per-run MOFA travel warnings when dating international news", () => {
    const events = [
      { source: { datasetId: "international-news", fetchedAt: lastSuccessAt } },
      { source: { datasetId: "mofa-travel-warning", fetchedAt: new Date(now).toISOString() } },
    ];
    const policy = SOURCE_CARRYOVER_POLICIES.international;
    expect(sourceCarryoverEvidence({ events, ...policy, now })).toEqual({ count: 1, lastSuccessAt });
    expect(sourceCarryoverEvidence({ events: [events[1]], ...policy, now })).toBeNull();
  });

  it.each([
    [],
    [{}],
    [{ source: { fetchedAt: "invalid" } }],
    [{ source: { fetchedAt: new Date(now + 1).toISOString() } }],
    [{ source: { fetchedAt: lastSuccessAt } }, { source: { fetchedAt: new Date(now + 1).toISOString() } }],
  ].map((events) => ({ events })))("rejects international evidence without a valid, non-future latest timestamp: %j", ({ events }) => {
    expect(sourceCarryoverEvidence({ events, ...SOURCE_CARRYOVER_POLICIES.international, now })).toBeNull();
  });

  it.each([
    ["police", "13166", 336],
    ["missing", "14420", 72],
    ["cwa", "E-A0015-001", 24],
    ["cwaWarnings", "W-C0033-001", 24],
  ])("bounds %s evidence and any failure at %s's age limit", (name, datasetId, maxHours) => {
    const policy = { datasetId: String(datasetId), maxHours: Number(maxHours) };
    expect(SOURCE_CARRYOVER_POLICIES[name]).toEqual(policy);
    const events = [{ source: { datasetId } }, { source: { datasetId: "tw-news" } }];
    const provenance = { sources: [{ datasetId, lastSuccessAt, stale: true }] };
    const evidence = { count: 1, lastSuccessAt };
    const boundary = Date.parse(lastSuccessAt) + Number(maxHours) * 3_600_000;
    const failed = { ok: false, error: "Traceback: zipfile.BadZipFile: File is not a zip file", carryOver: evidence };
    expect(sourceCarryoverEvidence({ events, provenance, ...policy, now: boundary })).toEqual(evidence);
    expect(canCarryOverSource(failed, { ...policy, now: boundary })).toBe(true);
    expect(sourceCarryoverEvidence({ events, provenance, ...policy, now: boundary + 1 })).toBeNull();
    expect(canCarryOverSource(failed, { ...policy, now: boundary + 1 })).toBe(false);
    expect(canCarryOverSource({ ...failed, carryOver: { count: 0, lastSuccessAt } }, { ...policy, now })).toBe(false);
    expect(canCarryOverSource({ ...failed, ok: true }, { ...policy, now })).toBe(false);
    expect(sourceCarryoverEvidence({ events: [], provenance, ...policy, now })).toBeNull();
    expect(sourceCarryoverEvidence({ events, provenance: {}, ...policy, now })).toBeNull();
    expect(sourceCarryoverEvidence({ events, provenance: { sources: [{ datasetId, stale: true, fetchedAt: lastSuccessAt }] }, ...policy, now })).toBeNull();
    for (const invalidTime of ["invalid", new Date(now + 1).toISOString()]) {
      expect(canCarryOverSource({ ...failed, carryOver: { count: 1, lastSuccessAt: invalidTime } }, { ...policy, now })).toBe(false);
    }
  });
});
