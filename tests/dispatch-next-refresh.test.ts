import { describe, expect, it, vi } from "vitest";

// @ts-expect-error JS ESM module without declarations
import { dispatchNextRefresh, hasOtherActiveRun, nextRefreshDelay } from "../scripts/dispatch-next-refresh.mjs";

const CREATED = "2026-09-26T07:00:00Z";
const NOW = Date.parse("2026-09-26T07:20:00Z");

describe("self-dispatched data refresh", () => {
  it("waits until 30 minutes from run creation, then dispatches only one successor", async () => {
    expect(nextRefreshDelay({ createdAt: CREATED, now: NOW })).toBe(10 * 60_000);
    expect(nextRefreshDelay({ createdAt: CREATED, now: NOW + 15 * 60_000 })).toBe(0);

    const sleepImpl = vi.fn(async () => {});
    const fetchImpl = vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith("/actions/runs/123")) {
        return Response.json({ id: 123, created_at: CREATED });
      }
      if (url.includes("/runs?")) {
        return Response.json({ workflow_runs: [
          { id: 123, status: "in_progress" },
          { id: 122, status: "completed" },
        ] });
      }
      expect(url).toContain("/dispatches");
      expect(options.method).toBe("POST");
      expect(JSON.parse(String(options.body))).toEqual({
        ref: "main", inputs: { mode: "hourly", renorm_intl: "false" },
      });
      return new Response(null, { status: 204 });
    });
    const result = await dispatchNextRefresh({
      token: "test-token",
      repository: "Reese-max/taiwan-intel-dashboard",
      runId: 123,
      now: () => NOW,
      fetchImpl,
      sleepImpl,
    });
    expect(result).toEqual({ action: "dispatch", waitMs: 10 * 60_000 });
    expect(sleepImpl).toHaveBeenCalledWith(10 * 60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("lets a queued schedule or code release run instead of replacing it", async () => {
    expect(hasOtherActiveRun([{ id: 123, status: "in_progress" }, { id: 124, status: "pending" }], 123)).toBe(true);
    const fetchImpl = vi.fn(async (url: string) => url.endsWith("/actions/runs/123")
      ? Response.json({ id: 123, created_at: CREATED })
      : Response.json({ workflow_runs: [{ id: 123, status: "in_progress" }, { id: 124, status: "pending" }] }));
    const result = await dispatchNextRefresh({
      token: "test-token",
      repository: "Reese-max/taiwan-intel-dashboard",
      runId: 123,
      now: () => NOW,
      fetchImpl,
      sleepImpl: vi.fn(async () => {}),
    });
    expect(result.action).toBe("skip");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a transient GitHub API outage before deciding whether to dispatch", async () => {
    let first = true;
    const sleepImpl = vi.fn(async () => {});
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/actions/runs/123") && first) {
        first = false;
        return new Response("temporarily unavailable", { status: 503 });
      }
      return url.endsWith("/actions/runs/123")
        ? Response.json({ id: 123, created_at: CREATED })
        : Response.json({ workflow_runs: [{ id: 123, status: "in_progress" }, { id: 124, status: "queued" }] });
    });
    const result = await dispatchNextRefresh({
      token: "test-token",
      repository: "Reese-max/taiwan-intel-dashboard",
      runId: 123,
      now: () => NOW + 15 * 60_000,
      fetchImpl,
      sleepImpl,
    });
    expect(result.action).toBe("skip");
    expect(sleepImpl).toHaveBeenCalledWith(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid run context before using the token", async () => {
    const fetchImpl = vi.fn();
    await expect(dispatchNextRefresh({
      token: "test-token",
      repository: "someone/else",
      runId: 123,
      fetchImpl,
    })).rejects.toThrow("expected repository");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
