import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { fetchGdelt, getGdeltRuntimeConfig } from "../scripts/lib/fetch-gdelt.mjs";

describe("GDELT adapter", () => {
  it("normalizes article-list JSON into traceable raw items", async () => {
    const result = await fetchGdelt({
      query: "Taiwan",
      maxRecords: 2,
      now: new Date("2026-07-26T00:00:00.000Z"),
      fetchImpl: async (input: URL) => {
        expect(input.searchParams.get("query")).toBe("Taiwan");
        expect(input.searchParams.get("mode")).toBe("artlist");
        expect(input.searchParams.get("format")).toBe("json");
        return Response.json({
          articles: [
            {
              url: "https://example.com/one",
              title: "First event",
              seendate: "20260725T235959Z",
              domain: "example.com",
            },
            {
              url: "https://example.com/one",
              title: "Duplicate",
              seendate: "20260725T235958Z",
              domain: "example.com",
            },
          ],
        });
      },
    });

    expect(result).toMatchObject({ ok: true, label: "GDELT Global News", count: 1, query: "Taiwan" });
    expect(result.items[0]).toMatchObject({
      source: "GDELT Global News",
      sourceConfidence: "aggregated",
      aggregatorName: "GDELT",
      ingestMethod: "gdelt-doc",
      datasetId: "gdelt-doc",
      pubDate: "2026-07-25T23:59:59.000Z",
    });
  });

  it("uses bounded runtime defaults", () => {
    expect(getGdeltRuntimeConfig({ GDELT_MAX_RECORDS: "999", GDELT_TIMEOUT_MS: "1" })).toMatchObject({
      maxRecords: 250,
      timeoutMs: 1000,
    });
  });

  it("surfaces API failures for the caller to fail-soft", async () => {
    await expect(
      fetchGdelt({ fetchImpl: async () => new Response("rate limited", { status: 429 }) }),
    ).rejects.toThrow("GDELT HTTP 429");
  });
});

