import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { normalizeInternational, eventIdFor } from "../scripts/lib/nvidia.mjs";

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
});
