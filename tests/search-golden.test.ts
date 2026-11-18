import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkIndex, type IntelNetwork } from "../src/data/network";
import { filterEvents } from "../src/data/loader";
import { applySearchSubnet } from "../src/search";
import { fold, parseSearchQuery, searchMismatch } from "../src/search-query";
import { SEARCH_TOPICS } from "../src/search-topics";
import { collapseSameIncident } from "../src/utils/collapse";
import type { IntelEvent } from "../src/types/event";

interface GoldenCase {
  query: string;
  minHits?: number;
  maxHits?: number;
  top10Contains?: string[];
  top10Relevant?: { terms: string[]; min: number };
  neverContains?: string[];
  sameHitsAs?: string;
  hitsAtMost?: string;
  note?: string;
}

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/search-golden/${name}.json`, import.meta.url), "utf8"));
const events = fixture("domestic") as IntelEvent[];
const network = fixture("network") as IntelNetwork;
const cases = fixture("cases") as GoldenCase[];
const net = new NetworkIndex(network.domestic);
const displayFor = (query: string) => applySearchSubnet(filterEvents(events, { query, scope: "domestic" }), net, query);
const topTitles = (display: IntelEvent[]) => collapseSameIncident(display, net).slice(0, 10).map(g => g.representative.title);
const diagnostic = (query: string, titles: string[]) => `${query}\n實際前 10 組代表標題：\n${titles.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;

describe("搜尋固定題庫", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(network.generatedAt));
  });
  afterEach(() => vi.useRealTimers());

  for (const c of cases) {
    it(c.query, () => {
      const display = displayFor(c.query);
      const titles = topTitles(display);
      const message = diagnostic(c.query, titles);
      if (c.minHits !== undefined) expect.soft(display.length, message).toBeGreaterThanOrEqual(c.minHits);
      if (c.maxHits !== undefined) expect.soft(display.length, message).toBeLessThanOrEqual(c.maxHits);
      for (const term of c.top10Contains ?? []) {
        expect.soft(titles.some(title => title.includes(term)), `${message}\n應含：${term}`).toBe(true);
      }
      if (c.top10Relevant) {
        const relevant = titles.filter(title => c.top10Relevant!.terms.some(term => title.includes(term)));
        expect.soft(relevant.length, message).toBeGreaterThanOrEqual(c.top10Relevant.min);
      }
      for (const term of c.neverContains ?? []) {
        const forbidden = display.filter(e => e.title.includes(term)).map(e => e.title);
        expect.soft(forbidden, `${message}\n不得含：${term}`).toEqual([]);
      }
      if (c.sameHitsAs !== undefined) expect.soft(display.length, message).toBe(displayFor(c.sameHitsAs).length);
      if (c.hitsAtMost !== undefined) expect.soft(display.length, message).toBeLessThanOrEqual(displayFor(c.hitsAtMost).length);
    });
  }

  it("詐騙：至少一組收合 10 篇報導", () => {
    const display = displayFor("詐騙");
    const groups = collapseSameIncident(display, net);
    expect(groups.some(g => g.members.length >= 10), diagnostic("詐騙", topTitles(display))).toBe(true);
  });

  it("交通：主題詞不比對來源名稱", () => {
    const parsed = parseSearchQuery("交通");
    const direct = events.filter(e => searchMismatch(e, parsed) === null);
    const terms = ["交通", ...SEARCH_TOPICS["交通"]].map(fold);
    const message = diagnostic("交通", topTitles(displayFor("交通")));
    expect(direct.length, message).toBeGreaterThan(0);
    const sourceOnly = direct.filter(e => {
      const content = fold(`${e.title} ${e.summary.replaceAll(e.source.name, "")} ${e.region} ${e.category}`);
      return !terms.some(term => content.includes(term));
    });
    expect(sourceOnly.map(e => ({ id: e.id, title: e.title, source: e.source.name })), message).toEqual([]);

    // 凍結資料的摘要也附有機關署名；另以同一筆資料移除摘要署名，隔離 source.name 的比對行為。
    const agencyEvent = events.find(e => e.source.name.includes("交通")
      && !terms.some(term => fold(`${e.title} ${e.region} ${e.category}`).includes(term)))!;
    expect(agencyEvent, message).toBeDefined();
    const sourceProbe = { ...agencyEvent, summary: agencyEvent.summary.replaceAll(agencyEvent.source.name, "") };
    expect(searchMismatch(sourceProbe, parsed), message).toBe("terms");
    expect(searchMismatch(sourceProbe, parseSearchQuery(agencyEvent.source.name)), message).toBeNull();
  });
});
