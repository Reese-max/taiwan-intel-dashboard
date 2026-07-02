import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { partitionByCache, eventIdFor } from "../scripts/lib/nvidia.mjs";

const NOW = new Date("2026-07-03T00:00:00Z").getTime();
const DAY = 86400000;

const rssItem = (link: string) => ({ title: `t-${link}`, link, description: "d" });
const cached = (link: string, fetchedAt?: string) => ({
  id: eventIdFor("international", link),
  riskLevel: "high",
  source: fetchedAt ? { fetchedAt } : {},
});

describe("partitionByCache 評級生命週期（C2）", () => {
  it("命中且未超齡（2 天前）→ reused", () => {
    const link = "https://x.test/a";
    const prior = new Map([[eventIdFor("international", link), cached(link, new Date(NOW - 2 * DAY).toISOString())]]);
    const { reused, fresh } = partitionByCache([rssItem(link)], "international", prior, { maxAgeMs: 3 * DAY, now: NOW });
    expect(reused).toHaveLength(1);
    expect(fresh).toHaveLength(0);
  });

  it("命中但超齡（4 天前）→ fresh 重評", () => {
    const link = "https://x.test/b";
    const prior = new Map([[eventIdFor("international", link), cached(link, new Date(NOW - 4 * DAY).toISOString())]]);
    const { reused, fresh } = partitionByCache([rssItem(link)], "international", prior, { maxAgeMs: 3 * DAY, now: NOW });
    expect(reused).toHaveLength(0);
    expect(fresh).toHaveLength(1);
  });

  it("fetchedAt 缺失 → 視為超齡重評（補齊 provenance）", () => {
    const link = "https://x.test/c";
    const prior = new Map([[eventIdFor("international", link), cached(link)]]);
    const { fresh } = partitionByCache([rssItem(link)], "international", prior, { maxAgeMs: 3 * DAY, now: NOW });
    expect(fresh).toHaveLength(1);
  });

  it("maxAgeMs 未設（停用）→ 超齡照樣 reused（向後相容）", () => {
    const link = "https://x.test/d";
    const prior = new Map([[eventIdFor("international", link), cached(link, new Date(NOW - 30 * DAY).toISOString())]]);
    const { reused, fresh } = partitionByCache([rssItem(link)], "international", prior, { now: NOW });
    expect(reused).toHaveLength(1);
    expect(fresh).toHaveLength(0);
  });

  it("未命中 → fresh（原行為不變）", () => {
    const prior = new Map([[eventIdFor("international", "https://x.test/other"), cached("https://x.test/other", new Date(NOW).toISOString())]]);
    const { fresh } = partitionByCache([rssItem("https://x.test/new")], "international", prior, { maxAgeMs: 3 * DAY, now: NOW });
    expect(fresh).toHaveLength(1);
  });
});
