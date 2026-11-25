import { describe, expect, it, vi } from "vitest";

// @ts-expect-error JS ESM module without declarations
import { dispatchNextRefresh, hasOtherActiveRun, nextRefreshDelay, nextRefreshMode, PROVENANCE_URL } from "../scripts/dispatch-next-refresh.mjs";

const CREATED = "2026-09-26T07:00:00Z";
const NOW = Date.parse("2026-09-26T07:20:00Z");
const provenance = (lastAttemptAt: string) => ({ sources: [{ datasetId: "tfda-noncompliant-food", lastAttemptAt }] });

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
      if (url === PROVENANCE_URL) {
        expect(new Headers(options?.headers).has("Authorization")).toBe(false);
        return Response.json(provenance("2026-09-25T18:40:00Z"));
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
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("補跑被延遲或丟棄的每日重建：只在 UTC 18:30–20:30 且每日來源逾 20 小時沒嘗試才改派 daily", async () => {
    const now = Date.parse("2026-11-25T18:47:00Z");
    expect(nextRefreshMode(provenance("2026-11-24T04:12:39Z"), now)).toBe("daily");
    expect(nextRefreshMode(provenance("2026-11-25T04:12:39Z"), now)).toBe("hourly");
    // daily 失敗不發布時 provenance 不變：時窗外一律 hourly，不會每 30 分鐘重派 daily 卡住全站更新。
    expect(nextRefreshMode(provenance("2026-11-24T04:12:39Z"), Date.parse("2026-11-25T20:30:00Z"))).toBe("hourly");
    expect(nextRefreshMode(provenance("2026-11-24T04:12:39Z"), Date.parse("2026-11-25T08:00:00Z"))).toBe("hourly");
    expect(nextRefreshMode(provenance("2026-11-24T04:12:39Z"), Date.parse("2026-11-25T18:29:00Z"))).toBe("hourly");
    // 缺標記、壞時間、讀不到 provenance 一律維持 hourly，不形成 daily 迴圈。
    expect(nextRefreshMode({ sources: [] }, now)).toBe("hourly");
    expect(nextRefreshMode(provenance("not-a-date"), now)).toBe("hourly");
    expect(nextRefreshMode(null, now)).toBe("hourly");

    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith("/actions/runs/123")) return Response.json({ id: 123, created_at: CREATED });
      if (url.includes("/runs?")) return Response.json({ workflow_runs: [{ id: 123, status: "in_progress" }] });
      if (url === PROVENANCE_URL) return Response.json(provenance("2026-09-25T04:00:00Z"));
      bodies.push(JSON.parse(String(options?.body)));
      return new Response(null, { status: 204 });
    });
    const windowRun = { created: "2026-09-26T18:30:00Z", now: Date.parse("2026-09-26T19:00:00Z") };
    const windowFetch = vi.fn(async (url: string, options?: RequestInit) => url.endsWith("/actions/runs/123")
      ? Response.json({ id: 123, created_at: windowRun.created }) : fetchImpl(url, options));
    await dispatchNextRefresh({ token: "t", repository: "Reese-max/taiwan-intel-dashboard", runId: 123, now: () => windowRun.now, fetchImpl: windowFetch, sleepImpl: vi.fn(async () => {}) });
    expect(bodies).toEqual([{ ref: "main", inputs: { mode: "daily", renorm_intl: "false" } }]);

    bodies.length = 0;
    const failingProvenance = vi.fn(async (url: string, options?: RequestInit) =>
      url === PROVENANCE_URL ? new Response("down", { status: 503 }) : fetchImpl(url, options));
    const failingInWindow = vi.fn(async (url: string, options?: RequestInit) => url.endsWith("/actions/runs/123")
      ? Response.json({ id: 123, created_at: windowRun.created }) : failingProvenance(url, options));
    await dispatchNextRefresh({ token: "t", repository: "Reese-max/taiwan-intel-dashboard", runId: 123, now: () => windowRun.now, fetchImpl: failingInWindow, sleepImpl: vi.fn(async () => {}) });
    expect(bodies).toEqual([{ ref: "main", inputs: { mode: "hourly", renorm_intl: "false" } }]);
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
