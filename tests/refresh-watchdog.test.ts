import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { decideRefreshWatchdog } from "../scripts/refresh-watchdog.mjs";

const NOW = Date.parse("2026-09-26T02:00:00Z");
const generatedAt = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const run = (minutesAgo: number, status = "completed") => ({
  created_at: generatedAt(minutesAgo),
  status,
});

describe("refresh watchdog decision", () => {
  it("keeps fresh canonical data and paused states read-only", () => {
    expect(decideRefreshWatchdog({ now: NOW, generatedAt: generatedAt(20), runs: [], state: "ACTIVE" }).reason)
      .toBe("canonical-fresh");
    expect(decideRefreshWatchdog({ now: NOW, generatedAt: generatedAt(120), runs: [], state: "PAUSED" }).action)
      .toBe("skip");
    expect(decideRefreshWatchdog({ now: NOW, generatedAt: generatedAt(120), runs: [], state: "RESTORING" }).action)
      .toBe("skip");
  });

  it("does not duplicate an active or recently created update", () => {
    expect(decideRefreshWatchdog({ now: NOW, generatedAt: generatedAt(120), runs: [run(90, "in_progress")], state: "DEGRADED" }).reason)
      .toBe("update-already-active");
    expect(decideRefreshWatchdog({ now: NOW, generatedAt: generatedAt(120), runs: [run(20)], state: "DEGRADED" }).reason)
      .toBe("recent-update-run");
  });

  it("requests one backup dispatch when the publication is stale and no run is recent", () => {
    expect(decideRefreshWatchdog({ now: NOW, generatedAt: generatedAt(120), runs: [run(100)], state: "DEGRADED" }))
      .toMatchObject({ action: "dispatch", reason: "canonical-stale-and-no-recent-run", ageMinutes: 120 });
    expect(decideRefreshWatchdog({ now: NOW, generatedAt: generatedAt(50), runs: [run(100)], state: "DEGRADED" }).action)
      .toBe("skip");
    expect(decideRefreshWatchdog({ now: NOW, generatedAt: generatedAt(51), runs: [run(100)], state: "DEGRADED" }).action)
      .toBe("dispatch");
  });

  it("fails closed for missing or future publication timestamps", () => {
    expect(decideRefreshWatchdog({ now: NOW, generatedAt: null, runs: [], state: "ACTIVE" }).action)
      .toBe("error");
    expect(decideRefreshWatchdog({ now: NOW, generatedAt: generatedAt(-10), runs: [], state: "ACTIVE" }).action)
      .toBe("error");
  });
});
