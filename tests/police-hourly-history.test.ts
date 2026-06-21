import { describe, expect, it } from "vitest";
import {
  applyPoliceHourlyRun,
  eventFingerprint,
} from "../scripts/lib/police-hourly-history.mjs";

function event(id: string, category = "治安") {
  return {
    id,
    title: `警政資料 ${id}`,
    category,
    region: "全國",
    timestamp: "2026-06-17T08:00:00+08:00",
    riskLevel: "low",
    source: {
      name: category === "交通" ? "警政署 114年傷亡道路交通事故資料" : "臺北市政府警察局 犯罪點位",
      datasetId: category === "交通" ? "177136" : "130105",
      recordRef: id,
      fetchedAt: "2026-06-17T00:05:00.000Z",
    },
  };
}

describe("police hourly new-record history", () => {
  it("uses stable police fingerprints instead of fetchedAt for new-record counting", () => {
    const a = event("same");
    const refetch = {
      ...a,
      source: { ...a.source, fetchedAt: "2026-06-17T01:05:00.000Z" },
    };

    expect(eventFingerprint(a)).toBe(eventFingerprint(refetch));
  });

  it("counts only records not seen in previous hours", () => {
    const first = applyPoliceHourlyRun({
      generatedAt: "2026-06-17T00:05:00.000Z",
      events: [event("a"), event("b", "交通")],
      previousHistory: { runs: [] },
      previousLedger: { seen: [] },
      minimumNewPerHour: 2,
    });

    expect(first.run.newPoliceRelatedCount).toBe(2);
    expect(first.run.meetsNewHourlyMinimum).toBe(true);
    expect(first.ledger.seen).toHaveLength(2);

    const second = applyPoliceHourlyRun({
      generatedAt: "2026-06-17T01:05:00.000Z",
      events: [event("a"), event("b", "交通"), event("c")],
      previousHistory: first.history,
      previousLedger: first.ledger,
      minimumNewPerHour: 2,
    });

    expect(second.run.hourLocal).toBe("2026-06-17 09:00");
    expect(second.run.totalFetchedPoliceRelated).toBe(3);
    expect(second.run.newPoliceRelatedCount).toBe(1);
    expect(second.run.duplicateFromPriorCount).toBe(2);
    expect(second.run.meetsNewHourlyMinimum).toBe(false);
    expect(second.run.newRecords.map((r) => r.id)).toEqual(["c"]);
    expect(second.ledger.seen).toHaveLength(3);
  });

  it("merges multiple runs in the same local hour without double-counting", () => {
    const first = applyPoliceHourlyRun({
      generatedAt: "2026-06-17T00:05:00.000Z",
      events: [event("a")],
      previousHistory: { runs: [] },
      previousLedger: { seen: [] },
      minimumNewPerHour: 2,
    });
    const second = applyPoliceHourlyRun({
      generatedAt: "2026-06-17T00:30:00.000Z",
      events: [event("a"), event("b")],
      previousHistory: first.history,
      previousLedger: first.ledger,
      minimumNewPerHour: 2,
    });

    expect(second.history.runs).toHaveLength(1);
    expect(second.history.runs[0].newPoliceRelatedCount).toBe(2);
    expect(second.history.runs[0].meetsNewHourlyMinimum).toBe(true);
    expect(second.history.runs[0].newRecords.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("caps new records per hour and defers extra unseen candidates", () => {
    const result = applyPoliceHourlyRun({
      generatedAt: "2026-06-17T00:05:00.000Z",
      events: [event("a"), event("b"), event("c")],
      previousHistory: { runs: [] },
      previousLedger: { seen: [] },
      minimumNewPerHour: 2,
      maxNewPerRun: 2,
    });

    expect(result.run.newPoliceRelatedCount).toBe(2);
    expect(result.run.meetsNewHourlyMinimum).toBe(true);
    expect(result.run.deferredNewCandidateCount).toBe(1);
    expect(result.ledger.seen).toHaveLength(2);
    expect(result.ledger.seen).not.toContain(eventFingerprint(event("c")));
  });

  it("does not consume more backlog after the same hour already reached its cap", () => {
    const first = applyPoliceHourlyRun({
      generatedAt: "2026-06-17T00:05:00.000Z",
      events: [event("a"), event("b"), event("c")],
      previousHistory: { runs: [] },
      previousLedger: { seen: [] },
      minimumNewPerHour: 2,
      maxNewPerRun: 2,
    });
    const second = applyPoliceHourlyRun({
      generatedAt: "2026-06-17T00:30:00.000Z",
      events: [event("a"), event("b"), event("c")],
      previousHistory: first.history,
      previousLedger: first.ledger,
      minimumNewPerHour: 2,
      maxNewPerRun: 2,
    });

    expect(second.history.runs).toHaveLength(1);
    expect(second.run.newPoliceRelatedCount).toBe(2);
    expect(second.run.newRecords.map((r) => r.id)).toEqual(["a", "b"]);
    expect(second.run.deferredNewCandidateCount).toBe(1);
    expect(second.ledger.seen).toHaveLength(2);
  });
});
