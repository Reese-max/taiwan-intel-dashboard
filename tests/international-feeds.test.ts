import { describe, expect, it } from "vitest";
import {
  INTERNATIONAL_FEEDS,
  INTERNATIONAL_TOPICS,
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

  it("exposes stable topic choices for manual international runs", () => {
    expect(INTERNATIONAL_TOPICS).toEqual([
      "general",
      "cyber",
      "disaster",
      "health",
      "humanitarian",
      "finance",
    ]);
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

  it("filters expanded feeds by cyber topic", () => {
    const feeds = selectInternationalFeeds({ tier: "expanded", topic: "cyber" });
    expect(labels(feeds)).toContain("The Hacker News");
    expect(labels(feeds)).toContain("CISA Cyber Advisories");
    expect(labels(feeds)).toContain("SecurityWeek");
    expect(labels(feeds)).not.toContain("BBC World");
    expect(feeds.length).toBeGreaterThanOrEqual(6);
  });

  it("combines core tier and topic filtering", () => {
    const feeds = selectInternationalFeeds({ tier: "core", topic: "cyber" });
    expect(labels(feeds)).toEqual(["The Hacker News"]);
  });

  it("filters health and disaster topic pools with enough manual-run diversity", () => {
    expect(labels(selectInternationalFeeds({ topic: "health" }))).toEqual(
      expect.arrayContaining(["WHO News", "Le Monde Health EN"]),
    );
    expect(labels(selectInternationalFeeds({ topic: "disaster" }))).toEqual(
      expect.arrayContaining(["NPR World", "GDACS Alerts", "WHO News"]),
    );
  });

  it("reads runtime config with safe numeric defaults", () => {
    const cfg = getInternationalRuntimeConfig({});
    expect(cfg.tier).toBe("expanded");
    expect(cfg.topic).toBe("all");
    expect(cfg.perFeed).toBe(8);
    expect(cfg.concurrency).toBe(5);
    expect(cfg.maxEvents).toBe(100);
  });

  it("clamps runtime config to safe ranges", () => {
    const cfg = getInternationalRuntimeConfig({
      INTERNATIONAL_FEED_TIER: "core",
      INTERNATIONAL_FEED_TOPIC: "CYBER",
      INTERNATIONAL_RSS_PER_FEED: "999",
      INTERNATIONAL_RSS_CONCURRENCY: "0",
      INTERNATIONAL_NORMALIZE_MAX: "999",
    });
    expect(cfg.tier).toBe("core");
    expect(cfg.topic).toBe("cyber");
    expect(cfg.perFeed).toBe(25);
    expect(cfg.concurrency).toBe(1);
    expect(cfg.maxEvents).toBe(150);
  });

  it("falls back to all topics when runtime topic is unknown", () => {
    const cfg = getInternationalRuntimeConfig({ INTERNATIONAL_FEED_TOPIC: "unknown-topic" });
    expect(cfg.topic).toBe("all");
  });

  it("uses expanded feed count for CI-scale international pool", () => {
    const cfg = getInternationalRuntimeConfig({ INTERNATIONAL_FEED_TIER: "expanded" });
    const feeds = selectInternationalFeeds({ tier: cfg.tier });
    expect(feeds.length).toBeGreaterThanOrEqual(21);
  });
});
