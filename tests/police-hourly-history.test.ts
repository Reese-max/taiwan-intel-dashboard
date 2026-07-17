import { describe, expect, it } from "vitest";
import {
  applyPoliceHourlyRun,
  calibratePoliceHourlyMinimum,
  eventFingerprint,
  taiwanLocalHour,
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
  it("用 7 日成功警政新聞時段的第 25 百分位校準門檻，忽略舊指標與失敗零值", () => {
    const generatedAt = "2026-06-17T08:05:00.000Z";
    const newsRun = (hoursAgo: number, count: number, datasetId = "tw-news") => {
      const runAt = new Date(Date.parse(generatedAt) - hoursAgo * 3600000).toISOString();
      return {
        generatedAt: runAt,
        hourLocal: taiwanLocalHour(runAt),
        newPoliceRelatedCount: count,
        newRecords: Array.from({ length: count }, (_, index) => ({
          fingerprint: `${datasetId}:${hoursAgo}-${index}`,
          datasetId,
        })),
      };
    };
    const previousHistory = {
      runs: [
        newsRun(1, 80),
        newsRun(2, 100),
        newsRun(3, 120),
        newsRun(4, 160, "7505"),
        newsRun(5, 200),
        newsRun(6, 0),
        newsRun(7, 5, "130105"),
        newsRun(24 * 8, 20),
        newsRun(0, 1),
      ],
    };

    expect(calibratePoliceHourlyMinimum({ generatedAt, previousHistory })).toEqual({
      minimumNewPerHour: 100,
      lookbackDays: 7,
      percentile: 25,
      sampleSize: 5,
    });
  });

  it("沒有 7 日成功警政新聞樣本時才使用冷啟動值", () => {
    expect(
      calibratePoliceHourlyMinimum({
        generatedAt: "2026-06-17T08:05:00.000Z",
        previousHistory: { runs: [] },
        fallback: 150,
      }),
    ).toEqual({
      minimumNewPerHour: 150,
      lookbackDays: 7,
      percentile: 25,
      sampleSize: 0,
    });
  });

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

  it("保留窗裁掉超齡 runs", () => {
    const generatedAt = "2026-06-17T00:05:00.000Z";
    const old20d = new Date(Date.parse(generatedAt) - 20 * 86400000).toISOString();
    const old10d = new Date(Date.parse(generatedAt) - 10 * 86400000).toISOString();
    const old1d = new Date(Date.parse(generatedAt) - 1 * 86400000).toISOString();
    const previousHistory = {
      runs: [
        { hourLocal: taiwanLocalHour(old20d), newRecords: [{ fingerprint: "130105:old-20d" }] },
        { hourLocal: taiwanLocalHour(old10d), newRecords: [{ fingerprint: "130105:old-10d" }] },
        { hourLocal: taiwanLocalHour(old1d), newRecords: [{ fingerprint: "130105:old-1d" }] },
      ],
    };
    const result = applyPoliceHourlyRun({
      generatedAt,
      events: [event("x")],
      previousHistory,
      previousLedger: { seen: [] },
      retentionDays: 14,
    });

    const keptHourLocals = result.history.runs.map((run) => run.hourLocal);
    const cutoffLocal = taiwanLocalHour(new Date(Date.parse(generatedAt) - 14 * 86400000).toISOString());
    const expectedWithinWindow = [taiwanLocalHour(old10d), taiwanLocalHour(old1d), taiwanLocalHour(generatedAt)];
    expect(keptHourLocals).toEqual(expect.arrayContaining(expectedWithinWindow));
    expect(keptHourLocals).not.toContain(taiwanLocalHour(old20d));
    expect(result.history.runs.map((run) => run.hourLocal).find((hourLocal) => hourLocal < cutoffLocal)).toBeUndefined();
    expect(result.history.runs).toHaveLength(3);
  });

  it("裁掉超齡 runs 後保留 ledger.seen 去重契約", () => {
    const generatedAt = "2026-06-17T00:05:00.000Z";
    const old20d = new Date(Date.parse(generatedAt) - 20 * 86400000).toISOString();
    const oldRunFingerprint = eventFingerprint(event("dup-old"));
    const previousHistory = {
      runs: [{ hourLocal: taiwanLocalHour(old20d), newRecords: [{ fingerprint: oldRunFingerprint }] }],
    };
    const result = applyPoliceHourlyRun({
      generatedAt,
      events: [event("dup-old")],
      previousHistory,
      previousLedger: { seen: [] },
      retentionDays: 14,
      minimumNewPerHour: 1,
    });

    expect(result.history.runs.some((run) => run.hourLocal === taiwanLocalHour(old20d))).toBe(false);
    expect(result.ledger.seen).toContain(oldRunFingerprint);
    expect(result.run.duplicateFromPriorCount).toBe(1);
    expect(result.run.newRecords).toHaveLength(0);

    const next = applyPoliceHourlyRun({
      generatedAt: "2026-06-17T01:05:00.000Z",
      events: [event("dup-old")],
      previousHistory: result.history,
      previousLedger: result.ledger,
      retentionDays: 14,
      minimumNewPerHour: 1,
    });

    expect(next.run.duplicateFromPriorCount).toBe(1);
    expect(next.run.newRecords).toHaveLength(0);
  });

  it("當前 hour 的 mergedRun 必定保留（即使其他 runs 被裁掉）", () => {
    const generatedAt = "2026-06-17T00:05:00.000Z";
    const old20d = new Date(Date.parse(generatedAt) - 20 * 86400000).toISOString();
    const result = applyPoliceHourlyRun({
      generatedAt,
      events: [event("new-current")],
      previousHistory: {
        runs: [{ hourLocal: taiwanLocalHour(old20d), newRecords: [{ fingerprint: eventFingerprint(event("old-current")) }] }],
      },
      previousLedger: { seen: [] },
      retentionDays: 14,
      minimumNewPerHour: 1,
    });

    expect(result.history.runs).toHaveLength(1);
    expect(result.run).toBe(result.history.runs[0]);
    expect(result.run.hourLocal).toBe(taiwanLocalHour(generatedAt));
  });

  it("預設不裁（未傳 retentionDays 及 Infinity）行為不變", () => {
    const generatedAt = "2026-06-17T00:05:00.000Z";
    const old20d = new Date(Date.parse(generatedAt) - 20 * 86400000).toISOString();
    const oldRun = { hourLocal: taiwanLocalHour(old20d), newRecords: [{ fingerprint: eventFingerprint(event("old")) }] };
    const first = applyPoliceHourlyRun({
      generatedAt,
      events: [event("new")],
      previousHistory: { runs: [oldRun] },
      previousLedger: { seen: [] },
      minimumNewPerHour: 1,
    });

    expect(first.history.runs).toHaveLength(2);

    const second = applyPoliceHourlyRun({
      generatedAt,
      events: [event("new2")],
      previousHistory: { runs: [oldRun] },
      previousLedger: { seen: [] },
      minimumNewPerHour: 1,
      retentionDays: Number.POSITIVE_INFINITY,
    });

    expect(second.history.runs).toHaveLength(2);
  });
});
