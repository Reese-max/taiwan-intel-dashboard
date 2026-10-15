import { describe, expect, it } from "vitest";
import { gdeltRetryAt } from "../scripts/lib/gdelt-cooldown.mjs";

describe("GDELT optional supplement cooldown", () => {
  const now = Date.parse("2026-09-29T06:00:00Z");

  it("waits six hours after 429 and carries the original limit time across skipped runs", () => {
    const failed = { ok: false, error: "GDELT HTTP 429", lastAttemptAt: "2026-09-29T03:00:00Z" };
    expect(gdeltRetryAt(failed, { now })).toBe("2026-09-29T09:00:00.000Z");
    expect(gdeltRetryAt({ skipped: true, lastRateLimitAt: failed.lastAttemptAt }, { now })).toBe(
      "2026-09-29T09:00:00.000Z",
    );
    expect(gdeltRetryAt(failed, { now: now + 3 * 60 * 60 * 1000 })).toBeNull();
  });

  it("does not suppress healthy or unrelated failed attempts", () => {
    expect(gdeltRetryAt({ ok: true, lastRateLimitAt: "2026-09-29T03:00:00Z" }, { now })).toBeNull();
    expect(gdeltRetryAt({ ok: false, error: "fetch failed", lastAttemptAt: "2026-09-29T03:00:00Z" }, { now })).toBeNull();
    expect(gdeltRetryAt({ ok: false, error: "GDELT HTTP 429" }, { now })).toBeNull();
  });
});
