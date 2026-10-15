import { describe, expect, it } from "vitest";
import { summarizeInternationalFeedAudit } from "../scripts/audit-international-feeds.mjs";

describe("international feed audit", () => {
  it("counts article-bearing fallback feeds separately from direct feeds", () => {
    const report = summarizeInternationalFeedAudit([
      { ok: true, count: 5 },
      { ok: true, count: 3, fallback: true, primaryError: "HTTP 403" },
      { ok: true, count: 0, fallback: true },
      { ok: false, count: 0, error: "HTTP 404" },
    ], { minOkFeeds: 2, minRawItems: 8 });
    expect(report).toMatchObject({ ok: true, okFeeds: 2, fallbackFeeds: 1, rawItems: 8 });
  });
});
