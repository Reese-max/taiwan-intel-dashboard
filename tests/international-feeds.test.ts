import { describe, expect, it } from "vitest";
import {
  INTERNATIONAL_FEEDS,
  getInternationalRuntimeConfig,
  selectInternationalFeeds,
} from "../scripts/lib/international-feeds.mjs";

const labels = (feeds: Array<{ label: string }>) => feeds.map((f) => f.label);

describe("international feed registry", () => {
  it("keeps current core feeds and expands to at least 21 total feeds", () => {
    expect(labels(INTERNATIONAL_FEEDS)).toContain("BBC World");
    expect(labels(INTERNATIONAL_FEEDS)).toContain("NPR World");
    expect(labels(INTERNATIONAL_FEEDS)).toContain("Al Jazeera");
    expect(labels(INTERNATIONAL_FEEDS)).toContain("The Hacker News");
    expect(labels(INTERNATIONAL_FEEDS)).toContain("CNBC Finance");
    expect(INTERNATIONAL_FEEDS.length).toBeGreaterThanOrEqual(21);
  });

  it("has unique labels and urls", () => {
    const feedLabels = labels(INTERNATIONAL_FEEDS);
    const urls = INTERNATIONAL_FEEDS.map((f) => f.url);
    expect(new Set(feedLabels).size).toBe(feedLabels.length);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("selects only core feeds when tier is core", () => {
    const feeds = selectInternationalFeeds({ tier: "core" });
    expect(labels(feeds)).toEqual(["BBC World", "NPR World", "Al Jazeera", "The Hacker News", "CNBC Finance"]);
  });

  it("selects expanded feeds by default", () => {
    const feeds = selectInternationalFeeds({});
    expect(feeds.length).toBeGreaterThan(5);
    expect(labels(feeds)).toContain("Guardian World");
    expect(labels(feeds)).toContain("CISA Cyber Advisories");
    expect(labels(feeds)).toContain("GDACS Alerts");
  });

  it("reads runtime config with safe numeric defaults", () => {
    const cfg = getInternationalRuntimeConfig({});
    expect(cfg.tier).toBe("expanded");
    expect(cfg.perFeed).toBe(5);
    expect(cfg.concurrency).toBe(5);
    expect(cfg.maxEvents).toBe(20);
  });

  it("clamps runtime config to safe ranges", () => {
    const cfg = getInternationalRuntimeConfig({
      INTERNATIONAL_FEED_TIER: "core",
      INTERNATIONAL_RSS_PER_FEED: "999",
      INTERNATIONAL_RSS_CONCURRENCY: "0",
      INTERNATIONAL_NORMALIZE_MAX: "999",
    });
    expect(cfg.tier).toBe("core");
    expect(cfg.perFeed).toBe(25);
    expect(cfg.concurrency).toBe(1);
    expect(cfg.maxEvents).toBe(40);
  });
});
