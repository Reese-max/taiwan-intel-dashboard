import { describe, expect, it } from "vitest";
import { summarizeInternationalFeedAudit } from "../scripts/audit-international-feeds.mjs";

describe("summarizeInternationalFeedAudit", () => {
  it("passes when enough feeds and raw items are available", () => {
    const summary = summarizeInternationalFeedAudit(
      [
        { label: "A", ok: true, count: 10 },
        { label: "B", ok: true, count: 12 },
        { label: "C", ok: false, count: 0, error: "HTTP 500" },
      ],
      { minOkFeeds: 2, minRawItems: 20 },
    );
    expect(summary.ok).toBe(true);
    expect(summary.okFeeds).toBe(2);
    expect(summary.rawItems).toBe(22);
  });

  it("fails when live feed count is too low", () => {
    const summary = summarizeInternationalFeedAudit(
      [{ label: "A", ok: true, count: 10 }],
      { minOkFeeds: 2, minRawItems: 5 },
    );
    expect(summary.ok).toBe(false);
    expect(summary.errors).toContain("live feeds 1/2");
  });

  it("fails when raw item count is too low", () => {
    const summary = summarizeInternationalFeedAudit(
      [{ label: "A", ok: true, count: 3 }],
      { minOkFeeds: 1, minRawItems: 10 },
    );
    expect(summary.ok).toBe(false);
    expect(summary.errors).toContain("raw items 3/10");
  });
});
