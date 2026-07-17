import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { normalizeInternational, normalizeDomesticNews, eventIdFor } from "../scripts/lib/nvidia.mjs";

describe("normalize cross-run cache", () => {
  it("derives a deterministic link-based event id", () => {
    const a = eventIdFor("international", "https://example.com/a");
    const b = eventIdFor("international", "https://example.com/a");
    expect(a).toBe(b);
    expect(a.startsWith("intl-")).toBe(true);
    expect(eventIdFor("domestic", "https://example.com/a").startsWith("twnews-")).toBe(true);
    expect(eventIdFor("international", "")).toBe(null);
  });

  it("reuses prior events by link id without calling the LLM", async () => {
    const items = [
      { title: "國際事件甲", link: "https://example.com/a", description: "", source: "X", sourceUrl: "https://example.com" },
      { title: "國際事件乙", link: "https://example.com/b", description: "", source: "X", sourceUrl: "https://example.com" },
    ];
    // Prior run already normalized both → cache covers all input → no LLM call needed.
    const priorById = new Map(
      items.map((it) => {
        const id = eventIdFor("international", it.link);
        return [id, { id, title: it.title, riskLevel: "high", scope: "international", source: { name: "X" } }];
      }),
    );

    // No LLM API key is configured in tests; this must still resolve purely from cache.
    const out = await normalizeInternational(items, { max: 20, priorById });

    expect(out.length).toBe(2);
    expect(out.map((e: { id: string }) => e.id).sort()).toEqual(
      [eventIdFor("international", "https://example.com/a"), eventIdFor("international", "https://example.com/b")].sort(),
    );
  });

  it("reuses prior enriched domestic events from cache without the LLM", async () => {
    const items = [
      { title: "詐騙案甲", link: "https://ltn.com.tw/a", description: "", source: "自由時報", sourceUrl: "https://ltn.com.tw" },
      { title: "車禍乙", link: "https://ltn.com.tw/b", description: "", source: "自由時報", sourceUrl: "https://ltn.com.tw" },
    ];
    const priorById = new Map(
      items.map((it) => {
        const id = eventIdFor("domestic", it.link);
        return [
          id,
          {
            id,
            title: it.title,
            region: "境外",
            lat: -33.8688,
            lng: 151.2093,
            riskLevel: "medium",
            scope: "domestic",
            aiTopic: "舊事件主題",
            source: { name: "自由時報" },
          },
        ];
      }),
    );
    const out = await normalizeDomesticNews(items, { max: 250, priorById });
    expect(out.length).toBe(2);
    expect(out.every((e: { aiTopic?: string }) => e.aiTopic === "舊事件主題")).toBe(true);
    expect(out.every((e: { region?: string; lat?: number | null; lng?: number | null }) => e.region === "全國" && e.lat === null && e.lng === null)).toBe(true);
  });

  it("refreshes a reused domestic event timestamp from the current RSS item", async () => {
    const item = {
      title: "資安事件",
      link: "https://example.com/security",
      description: "",
      source: "iThome Security RSS",
      sourceUrl: "https://www.ithome.com.tw/rss/security",
      pubDate: "2026-07-17T10:06+08:00",
    };
    const id = eventIdFor("domestic", item.link);
    const priorById = new Map([[id, {
      id,
      title: item.title,
      timestamp: "2026-07-17T10:06:00.000Z",
      region: "全國",
      riskLevel: "medium",
      scope: "domestic",
      aiTopic: "既有分析",
      source: { name: item.source },
    }]]);

    const [event] = await normalizeDomesticNews([item], { max: 10, priorById });

    expect(event.timestamp).toBe("2026-07-17T02:06:00.000Z");
    expect(event.aiTopic).toBe("既有分析");
  });
});
