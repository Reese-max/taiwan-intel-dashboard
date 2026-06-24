# International News Pool Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the international news pool from the current 5 RSS feeds into a tested, auditable, configurable multi-source pool covering geopolitics, humanitarian crises, disasters, cybersecurity, public health, and finance without breaking CI cron reliability.

**Architecture:** Split international feed definitions out of the generic RSS parser into a dedicated feed registry with tiers and runtime config. Keep `fetchRssItems()` generic; have `fetch-live.mjs` select international feeds, record raw/source coverage in `provenance.json.pipeline.international`, and have CI assert both source success and feed diversity. Add a dedicated audit script so future international feed changes are live-probed before landing.

**Tech Stack:** Node.js 22 ESM, existing zero-dependency RSS parser in `scripts/lib/fetch-rss.mjs`, Vitest, GitHub Actions, existing LLM normalization via `scripts/lib/nvidia.mjs`.

---

## Current State and Evidence

### Current implementation

- Current international feed list lives in `scripts/lib/fetch-rss.mjs` as `FEEDS`.
- `scripts/fetch-live.mjs` imports `fetchRssItems, TW_NEWS_FEEDS` and calls international RSS with:

```js
const rss = await fetchRssItems({ perFeed: 5 });
intl = await normalizeInternational(rss.items, { max: 10 });
status.international = { ok: true, count: intl.length, feeds: feedStatus };
```

- This means expanding feeds without config will increase prompt size, but still only emits 10 normalized international events.
- Current CI assertion checks `international.ok === true`, but does not verify how many feeds were alive or how many raw items entered the pool.

### Current feed live probe

Command run from repo root:

```bash
node scripts/_audit-candidates.mjs %TEMP%/intl-existing-feeds.json
```

Result:

```txt
=== 可靠（>=3 則）：5 條 ===
  [50] rss ｜ The Hacker News
  [30] rss ｜ CNBC Finance
  [25] rss ｜ BBC World
  [25] rss ｜ Al Jazeera
  [10] rss ｜ NPR World
```

Current stable baseline = 5/5 existing sources alive.

### New candidate live probe

Command run from repo root:

```bash
node scripts/_audit-candidates.mjs %TEMP%/intl-candidates.json
```

Reliable candidates from the current parser and network behavior:

```txt
=== 可靠（>=3 則）：12 條 ===
  [100] rss ｜ DW All News
  [100] rss ｜ GDACS Alerts
  [50] rss ｜ CIS Advisories
  [50] rss ｜ Cisco Security Advisories
  [45] rss ｜ Guardian World
  [30] rss ｜ UN News All
  [30] rss ｜ CISA Cyber Advisories
  [25] rss ｜ WHO News
  [24] rss ｜ France24 English
  [10] rss ｜ Politico EU
  [10] rss ｜ KrebsOnSecurity
  [10] rss ｜ SecurityWeek
```

Additional Le Monde probe:

```txt
=== 可靠（>=3 則）：4 條 ===
  [20] rss ｜ Le Monde International EN
  [20] rss ｜ Le Monde Global Issues EN
  [20] rss ｜ Le Monde Pixels EN
  [20] rss ｜ Le Monde Health EN
```

Rejected for initial expansion because the current parser/fetcher saw failures or zero items:

```txt
AP Top News: fetch failed
ReliefWeb Updates: HTTP 406
NHK World English: HTTP 404
Euronews World: HTTP 404
BleepingComputer: HTTP 403
IMF News: 0 items
World Bank News: 0 items
```

Initial expansion should therefore add 16 new reliable feeds, increasing the pool from 5 to 21 feeds.

---

## Target Feed Pool

### Core feeds retained

```js
const CORE_FEEDS = [
  { label: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", hint: "地緣政治", tier: "core", topic: "general" },
  { label: "NPR World", url: "https://feeds.npr.org/1004/rss.xml", hint: "災害", tier: "core", topic: "general" },
  { label: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", hint: "地緣政治", tier: "core", topic: "general" },
  { label: "The Hacker News", url: "https://feeds.feedburner.com/TheHackersNews", hint: "資安", tier: "core", topic: "cyber" },
  { label: "CNBC Finance", url: "https://www.cnbc.com/id/10000664/device/rss/rss.html", hint: "金融", tier: "core", topic: "finance" },
];
```

### Expanded feeds to add

```js
const EXPANDED_FEEDS = [
  { label: "Guardian World", url: "https://www.theguardian.com/world/rss", hint: "地緣政治", tier: "expanded", topic: "general" },
  { label: "DW All News", url: "https://rss.dw.com/rdf/rss-en-all", hint: "地緣政治", tier: "expanded", topic: "general" },
  { label: "France24 English", url: "https://www.france24.com/en/rss", hint: "地緣政治", tier: "expanded", topic: "general" },
  { label: "UN News All", url: "https://news.un.org/feed/subscribe/en/news/all/rss.xml", hint: "地緣政治", tier: "expanded", topic: "humanitarian" },
  { label: "GDACS Alerts", url: "https://www.gdacs.org/xml/rss.xml", hint: "災害", tier: "expanded", topic: "disaster" },
  { label: "WHO News", url: "https://www.who.int/rss-feeds/news-english.xml", hint: "災害", tier: "expanded", topic: "health" },
  { label: "Politico EU", url: "https://www.politico.eu/feed/", hint: "地緣政治", tier: "expanded", topic: "general" },
  { label: "Le Monde International EN", url: "https://www.lemonde.fr/en/international/rss_full.xml", hint: "地緣政治", tier: "expanded", topic: "general" },
  { label: "Le Monde Global Issues EN", url: "https://www.lemonde.fr/en/global-issues/rss_full.xml", hint: "地緣政治", tier: "expanded", topic: "humanitarian" },
  { label: "Le Monde Pixels EN", url: "https://www.lemonde.fr/en/pixels/rss_full.xml", hint: "資安", tier: "expanded", topic: "cyber" },
  { label: "Le Monde Health EN", url: "https://www.lemonde.fr/en/health/rss_full.xml", hint: "災害", tier: "expanded", topic: "health" },
  { label: "CISA Cyber Advisories", url: "https://www.cisa.gov/cybersecurity-advisories/all.xml", hint: "資安", tier: "expanded", topic: "cyber" },
  { label: "CIS Advisories", url: "https://www.cisecurity.org/feed/advisories", hint: "資安", tier: "expanded", topic: "cyber" },
  { label: "Cisco Security Advisories", url: "https://sec.cloudapps.cisco.com/security/center/psirtrss10/CiscoSecurityAdvisory.xml", hint: "資安", tier: "expanded", topic: "cyber" },
  { label: "KrebsOnSecurity", url: "https://krebsonsecurity.com/feed/", hint: "資安", tier: "expanded", topic: "cyber" },
  { label: "SecurityWeek", url: "https://www.securityweek.com/feed/", hint: "資安", tier: "expanded", topic: "cyber" },
];
```

---

## File Structure

- Create: `scripts/lib/international-feeds.mjs`
  - Owns international feed metadata and runtime config.
  - Exports `INTERNATIONAL_FEEDS`, `selectInternationalFeeds()`, and `getInternationalRuntimeConfig()`.
- Modify: `scripts/lib/fetch-rss.mjs`
  - Remove inline international `FEEDS` definition.
  - Import `INTERNATIONAL_FEEDS` and re-export as `FEEDS` for backward compatibility.
- Modify: `scripts/fetch-live.mjs`
  - Use selected international feed list and runtime config.
  - Record `rawCount`, `okFeeds`, `totalFeeds`, `tier`, `perFeed`, and `maxEvents` in `status.international`.
- Create: `scripts/audit-international-feeds.mjs`
  - Live-probes the configured international feed pool.
  - Fails if too few feeds or raw items are available.
- Modify: `scripts/assert-pipeline-sources.mjs`
  - Add optional international feed coverage assertions for CI.
- Modify: `.github/workflows/update-and-deploy.yml`
  - Keep fetching `rss` via CI cron.
  - Strengthen post-fetch assertion with minimum international feed coverage.
- Modify: `package.json`
  - Add `audit:international-feeds` and include it in `validate:ci-mode` or a new validation command.
- Create: `tests/international-feeds.test.ts`
  - Unit tests for feed registry, uniqueness, tiers, and runtime config.
- Create: `tests/international-feed-audit.test.ts`
  - Unit tests for audit summary logic without hitting network.
- Modify: `tests/assert-pipeline-sources.test.ts`
  - Add tests for international feed diversity gates.

---

### Task 1: Extract international feed registry

**Files:**
- Create: `scripts/lib/international-feeds.mjs`
- Modify: `scripts/lib/fetch-rss.mjs`
- Create: `tests/international-feeds.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/international-feeds.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/international-feeds.test.ts
```

Expected: FAIL because `scripts/lib/international-feeds.mjs` does not exist.

- [ ] **Step 3: Implement feed registry**

Create `scripts/lib/international-feeds.mjs`:

```js
export const INTERNATIONAL_FEEDS = [
  { label: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", hint: "地緣政治", tier: "core", topic: "general" },
  { label: "NPR World", url: "https://feeds.npr.org/1004/rss.xml", hint: "災害", tier: "core", topic: "general" },
  { label: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", hint: "地緣政治", tier: "core", topic: "general" },
  { label: "The Hacker News", url: "https://feeds.feedburner.com/TheHackersNews", hint: "資安", tier: "core", topic: "cyber" },
  { label: "CNBC Finance", url: "https://www.cnbc.com/id/10000664/device/rss/rss.html", hint: "金融", tier: "core", topic: "finance" },
  { label: "Guardian World", url: "https://www.theguardian.com/world/rss", hint: "地緣政治", tier: "expanded", topic: "general" },
  { label: "DW All News", url: "https://rss.dw.com/rdf/rss-en-all", hint: "地緣政治", tier: "expanded", topic: "general" },
  { label: "France24 English", url: "https://www.france24.com/en/rss", hint: "地緣政治", tier: "expanded", topic: "general" },
  { label: "UN News All", url: "https://news.un.org/feed/subscribe/en/news/all/rss.xml", hint: "地緣政治", tier: "expanded", topic: "humanitarian" },
  { label: "GDACS Alerts", url: "https://www.gdacs.org/xml/rss.xml", hint: "災害", tier: "expanded", topic: "disaster" },
  { label: "WHO News", url: "https://www.who.int/rss-feeds/news-english.xml", hint: "災害", tier: "expanded", topic: "health" },
  { label: "Politico EU", url: "https://www.politico.eu/feed/", hint: "地緣政治", tier: "expanded", topic: "general" },
  { label: "Le Monde International EN", url: "https://www.lemonde.fr/en/international/rss_full.xml", hint: "地緣政治", tier: "expanded", topic: "general" },
  { label: "Le Monde Global Issues EN", url: "https://www.lemonde.fr/en/global-issues/rss_full.xml", hint: "地緣政治", tier: "expanded", topic: "humanitarian" },
  { label: "Le Monde Pixels EN", url: "https://www.lemonde.fr/en/pixels/rss_full.xml", hint: "資安", tier: "expanded", topic: "cyber" },
  { label: "Le Monde Health EN", url: "https://www.lemonde.fr/en/health/rss_full.xml", hint: "災害", tier: "expanded", topic: "health" },
  { label: "CISA Cyber Advisories", url: "https://www.cisa.gov/cybersecurity-advisories/all.xml", hint: "資安", tier: "expanded", topic: "cyber" },
  { label: "CIS Advisories", url: "https://www.cisecurity.org/feed/advisories", hint: "資安", tier: "expanded", topic: "cyber" },
  { label: "Cisco Security Advisories", url: "https://sec.cloudapps.cisco.com/security/center/psirtrss10/CiscoSecurityAdvisory.xml", hint: "資安", tier: "expanded", topic: "cyber" },
  { label: "KrebsOnSecurity", url: "https://krebsonsecurity.com/feed/", hint: "資安", tier: "expanded", topic: "cyber" },
  { label: "SecurityWeek", url: "https://www.securityweek.com/feed/", hint: "資安", tier: "expanded", topic: "cyber" },
];

const CORE_LABELS = new Set(["BBC World", "NPR World", "Al Jazeera", "The Hacker News", "CNBC Finance"]);

function numberEnv(env, name, fallback, min, max) {
  const value = Number(env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function selectInternationalFeeds({ tier = "expanded" } = {}) {
  const normalizedTier = String(tier || "expanded").trim().toLowerCase();
  if (normalizedTier === "core") return INTERNATIONAL_FEEDS.filter((feed) => CORE_LABELS.has(feed.label));
  return [...INTERNATIONAL_FEEDS];
}

export function getInternationalRuntimeConfig(env = process.env) {
  return {
    tier: String(env.INTERNATIONAL_FEED_TIER || "expanded").trim().toLowerCase() === "core" ? "core" : "expanded",
    perFeed: numberEnv(env, "INTERNATIONAL_RSS_PER_FEED", 5, 1, 25),
    concurrency: numberEnv(env, "INTERNATIONAL_RSS_CONCURRENCY", 5, 1, 10),
    maxEvents: numberEnv(env, "INTERNATIONAL_NORMALIZE_MAX", 20, 1, 40),
  };
}
```

- [ ] **Step 4: Modify fetch-rss compatibility export**

In `scripts/lib/fetch-rss.mjs`, replace the current inline `export const FEEDS = [...]` block with:

```js
import { INTERNATIONAL_FEEDS } from "./international-feeds.mjs";

export const FEEDS = INTERNATIONAL_FEEDS;
```

Keep `TW_NEWS_FEEDS`, `fetchRssItems()`, and parser functions unchanged.

- [ ] **Step 5: Verify feed tests pass**

Run:

```bash
npm test -- tests/international-feeds.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Commit checkpoint**

```bash
git add scripts/lib/international-feeds.mjs scripts/lib/fetch-rss.mjs tests/international-feeds.test.ts
git commit -m "feat: add configurable international feed registry"
```

---

### Task 2: Wire expanded pool into fetch-live provenance

**Files:**
- Modify: `scripts/fetch-live.mjs`
- Modify: `tests/international-feeds.test.ts`

- [ ] **Step 1: Add tests for runtime config source selection**

Append to `tests/international-feeds.test.ts`:

```ts
it("uses expanded feed count for CI-scale international pool", () => {
  const cfg = getInternationalRuntimeConfig({ INTERNATIONAL_FEED_TIER: "expanded" });
  const feeds = selectInternationalFeeds({ tier: cfg.tier });
  expect(feeds.length).toBeGreaterThanOrEqual(21);
});
```

- [ ] **Step 2: Run test and verify it passes before wiring**

Run:

```bash
npm test -- tests/international-feeds.test.ts
```

Expected: PASS. This proves the registry and config are usable before touching pipeline orchestration.

- [ ] **Step 3: Modify imports in fetch-live**

In `scripts/fetch-live.mjs`, change:

```js
import { fetchRssItems, TW_NEWS_FEEDS } from "./lib/fetch-rss.mjs";
```

to:

```js
import { fetchRssItems, TW_NEWS_FEEDS } from "./lib/fetch-rss.mjs";
import { getInternationalRuntimeConfig, selectInternationalFeeds } from "./lib/international-feeds.mjs";
```

- [ ] **Step 4: Modify international fetch block**

Replace the current international RSS block in `scripts/fetch-live.mjs` with:

```js
  // --- 國際：RSS → LLM 正規化 ---
  let intl = [];
  let feedStatus = [];
  if (want("rss")) {
    try {
      const intlCfg = getInternationalRuntimeConfig();
      const intlFeeds = selectInternationalFeeds({ tier: intlCfg.tier });
      const rss = await fetchRssItems({
        perFeed: intlCfg.perFeed,
        feeds: intlFeeds,
        concurrency: intlCfg.concurrency,
      });
      feedStatus = rss.feedStatus;
      const okFeeds = feedStatus.filter((f) => f.ok && f.count).length;
      console.log(
        `RSS：${rss.items.length} 則原文（${okFeeds}/${intlFeeds.length} 來源有回；${feedStatus
          .map((f) => `${f.label}:${f.ok ? f.count : "X"}`)
          .join(" ")}）`,
      );
      intl = await normalizeInternational(rss.items, { max: intlCfg.maxEvents });
      status.international = {
        ok: true,
        count: intl.length,
        rawCount: rss.items.length,
        okFeeds,
        totalFeeds: intlFeeds.length,
        tier: intlCfg.tier,
        perFeed: intlCfg.perFeed,
        maxEvents: intlCfg.maxEvents,
        feeds: feedStatus,
      };
      console.log(`國際正規化：${intl.length} 筆`);
    } catch (e) {
      status.international = { ok: false, error: e.message, feeds: feedStatus };
      console.error(`國際失敗：${e.message}`);
    }
  } else status.international = { skipped: true };
```

- [ ] **Step 5: Run targeted tests**

Run:

```bash
npm test -- tests/international-feeds.test.ts tests/ci-fetch-mode.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit checkpoint**

```bash
git add scripts/fetch-live.mjs tests/international-feeds.test.ts
git commit -m "feat: use expanded international feed pool in live fetch"
```

---

### Task 3: Add international feed coverage assertion

**Files:**
- Modify: `scripts/assert-pipeline-sources.mjs`
- Modify: `tests/assert-pipeline-sources.test.ts`
- Modify: `.github/workflows/update-and-deploy.yml`

- [ ] **Step 1: Write failing tests**

Append to `tests/assert-pipeline-sources.test.ts`:

```ts
import { assertInternationalFeedCoverage } from "../scripts/assert-pipeline-sources.mjs";

describe("assertInternationalFeedCoverage", () => {
  it("accepts international status with enough live feeds and raw items", () => {
    expect(() =>
      assertInternationalFeedCoverage(
        { ok: true, count: 20, okFeeds: 15, rawCount: 120 },
        { minFeeds: 10, minRawItems: 50 },
      ),
    ).not.toThrow();
  });

  it("rejects international status with too few live feeds", () => {
    expect(() =>
      assertInternationalFeedCoverage(
        { ok: true, count: 20, okFeeds: 4, rawCount: 120 },
        { minFeeds: 10, minRawItems: 50 },
      ),
    ).toThrow("International feed coverage too low: 4/10 live feeds");
  });

  it("rejects international status with too few raw items", () => {
    expect(() =>
      assertInternationalFeedCoverage(
        { ok: true, count: 3, okFeeds: 15, rawCount: 12 },
        { minFeeds: 10, minRawItems: 50 },
      ),
    ).toThrow("International raw item count too low: 12/50");
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/assert-pipeline-sources.test.ts
```

Expected: FAIL because `assertInternationalFeedCoverage` is not exported.

- [ ] **Step 3: Implement feed coverage assertion**

Add to `scripts/assert-pipeline-sources.mjs`:

```js
export function assertInternationalFeedCoverage(status, { minFeeds = 0, minRawItems = 0 } = {}) {
  if (!status || status.ok !== true) return;
  if (minFeeds > 0) {
    const okFeeds = Number(status.okFeeds || 0);
    if (okFeeds < minFeeds) throw new Error(`International feed coverage too low: ${okFeeds}/${minFeeds} live feeds`);
  }
  if (minRawItems > 0) {
    const rawCount = Number(status.rawCount || 0);
    if (rawCount < minRawItems) throw new Error(`International raw item count too low: ${rawCount}/${minRawItems}`);
  }
}
```

Modify the CLI block after `assertRequiredPipelineSources(...)`:

```js
  const minInternationalFeeds = Number(argValue("min-international-feeds") || 0);
  const minInternationalRaw = Number(argValue("min-international-raw") || 0);
  const pipeline = readPipeline(path);
  assertRequiredPipelineSources(pipeline, required, { allowStaleCwa });
  assertInternationalFeedCoverage(pipeline.international, {
    minFeeds: minInternationalFeeds,
    minRawItems: minInternationalRaw,
  });
```

Ensure the CLI reads the pipeline once:

```js
  const pipeline = readPipeline(path);
```

- [ ] **Step 4: Update workflow assertion command**

Change `.github/workflows/update-and-deploy.yml` assertion step to:

```yaml
      - name: 驗證必要來源已更新
        env:
          ALLOW_STALE_CWA: ${{ vars.ALLOW_STALE_CWA }}
        run: node scripts/assert-pipeline-sources.mjs --require=cwa,cwaWarnings,international --min-international-feeds=10 --min-international-raw=50
```

- [ ] **Step 5: Verify tests pass**

Run:

```bash
npm test -- tests/assert-pipeline-sources.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit checkpoint**

```bash
git add scripts/assert-pipeline-sources.mjs tests/assert-pipeline-sources.test.ts .github/workflows/update-and-deploy.yml
git commit -m "ci: assert international feed diversity"
```

---

### Task 4: Add dedicated live feed audit command

**Files:**
- Create: `scripts/audit-international-feeds.mjs`
- Create: `tests/international-feed-audit.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing unit tests**

Create `tests/international-feed-audit.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/international-feed-audit.test.ts
```

Expected: FAIL because script does not exist.

- [ ] **Step 3: Implement audit script**

Create `scripts/audit-international-feeds.mjs`:

```js
import { fetchRssItems } from "./lib/fetch-rss.mjs";
import { getInternationalRuntimeConfig, selectInternationalFeeds } from "./lib/international-feeds.mjs";

function argValue(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

export function summarizeInternationalFeedAudit(feedStatus, { minOkFeeds = 10, minRawItems = 50 } = {}) {
  const okFeeds = feedStatus.filter((f) => f.ok && Number(f.count || 0) > 0).length;
  const rawItems = feedStatus.reduce((sum, f) => sum + (f.ok ? Number(f.count || 0) : 0), 0);
  const errors = [];
  if (okFeeds < minOkFeeds) errors.push(`live feeds ${okFeeds}/${minOkFeeds}`);
  if (rawItems < minRawItems) errors.push(`raw items ${rawItems}/${minRawItems}`);
  return { ok: errors.length === 0, okFeeds, rawItems, errors };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  const cfg = getInternationalRuntimeConfig(process.env);
  const feeds = selectInternationalFeeds({ tier: cfg.tier });
  const minOkFeeds = Number(argValue("min-ok-feeds") || process.env.INTERNATIONAL_MIN_OK_FEEDS || 10);
  const minRawItems = Number(argValue("min-raw-items") || process.env.INTERNATIONAL_MIN_RAW_ITEMS || 50);
  const result = await fetchRssItems({ perFeed: cfg.perFeed, feeds, concurrency: cfg.concurrency });
  for (const status of result.feedStatus) {
    console.log(`${status.ok ? "OK" : "FAIL"}\t${status.count || 0}\t${status.label}${status.error ? `\t${status.error}` : ""}`);
  }
  const summary = summarizeInternationalFeedAudit(result.feedStatus, { minOkFeeds, minRawItems });
  console.log(`International feed audit: ${summary.okFeeds}/${feeds.length} live feeds, ${summary.rawItems} raw items`);
  if (!summary.ok) {
    console.error(`International feed audit failed: ${summary.errors.join(", ")}`);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Add package script**

Modify `package.json` scripts:

```json
"audit:international-feeds": "node scripts/audit-international-feeds.mjs --min-ok-feeds=10 --min-raw-items=50"
```

- [ ] **Step 5: Run tests and live audit**

Run:

```bash
npm test -- tests/international-feed-audit.test.ts
npm run audit:international-feeds
```

Expected:

```txt
PASS tests/international-feed-audit.test.ts
International feed audit: at least 10 live feeds, at least 50 raw items
```

Exact counts will vary by upstream source. Acceptance: exit code 0.

- [ ] **Step 6: Commit checkpoint**

```bash
git add scripts/audit-international-feeds.mjs tests/international-feed-audit.test.ts package.json
git commit -m "chore: add international feed audit command"
```

---

### Task 5: End-to-end verification and data refresh

**Files:**
- No source edits unless verification exposes a defect.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- tests/international-feeds.test.ts tests/international-feed-audit.test.ts tests/assert-pipeline-sources.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run:

```bash
npm test
```

Expected: all tests pass. Baseline before this plan: 23 files / 105 tests. After this plan expect at least 25 files / 118 tests.

- [ ] **Step 3: Run international feed audit**

Run:

```bash
npm run audit:international-feeds
```

Expected: exit code 0, at least 10 live feeds and 50 raw items.

- [ ] **Step 4: Run CI-equivalent hourly refresh**

Run:

```bash
npm run refresh:ci:hourly
```

Expected output includes:

```txt
本次來源：cwa, police, missing, twnews, rss
RSS：... 則原文（.../21 來源有回；...）
國際正規化：... 筆
```

Acceptance:

- `provenance.json.pipeline.international.ok === true`
- `provenance.json.pipeline.international.okFeeds >= 10`
- `provenance.json.pipeline.international.rawCount >= 50`
- `provenance.json.pipeline.international.count >= 10`

- [ ] **Step 5: Run strengthened assertion**

Run:

```bash
node scripts/assert-pipeline-sources.mjs --require=cwa,cwaWarnings,international --min-international-feeds=10 --min-international-raw=50
```

Expected:

```txt
Required pipeline sources ok: cwa, cwaWarnings, international
```

- [ ] **Step 6: Run static build**

Run:

```bash
npm run build
```

Expected: TypeScript and static build pass.

- [ ] **Step 7: Inspect international provenance**

Run:

```bash
node -e "const p=require('./public/data/provenance.json'); console.log(JSON.stringify(p.pipeline.international, null, 2))"
```

Expected shape:

```json
{
  "ok": true,
  "count": 20,
  "rawCount": 100,
  "okFeeds": 15,
  "totalFeeds": 21,
  "tier": "expanded",
  "perFeed": 5,
  "maxEvents": 20,
  "feeds": []
}
```

Counts may vary by upstream availability. Acceptance thresholds are `okFeeds >= 10`, `rawCount >= 50`, and `ok === true`.

- [ ] **Step 8: Commit final verification note only if data snapshots are intentionally tracked**

If generated data changed and this repository expects snapshots in version control, commit them separately:

```bash
git add public/data dist/data data
git commit -m "data: refresh international source snapshots"
```

If generated data is not intended for this implementation commit, leave it unstaged and report it as verification output only.

---

## Rollback Plan

If expanded feeds trigger provider quota, LLM prompt size issues, or upstream instability:

1. Set `INTERNATIONAL_FEED_TIER=core` in CI env to return to the original 5-feed pool without code rollback.
2. Set `INTERNATIONAL_NORMALIZE_MAX=10` to return to the original emitted international event count.
3. Keep the audit script and feed registry in place; remove only the failing feed entries after live audit.
4. If a cybersecurity feed is noisy, remove or demote that feed first instead of shrinking the entire pool.
5. If `--min-international-feeds=10` becomes too strict due a temporary widespread outage, lower it to `8` temporarily and open a follow-up task to re-audit sources.

---

## Self-Review

- Spec coverage:
  - Expands international pool: Task 1 adds 16 reliable live-probed feeds, increasing total to 21.
  - Keeps CI reliable: Task 3 adds feed diversity gates; rollback env allows core feed fallback.
  - Avoids overloading LLM: Task 1/2 make per-feed and max-event counts configurable with safe clamping.
  - Keeps parser generic: Task 1 moves source list out of `fetch-rss.mjs` while preserving `FEEDS` export.
  - Gives future operators a tool: Task 4 adds live feed audit command.
- Placeholder scan:
  - No placeholder tokens, no unexpanded future work, no unspecified files.
- Type consistency:
  - `tier`, `perFeed`, `concurrency`, `maxEvents`, `okFeeds`, `rawCount`, and `totalFeeds` are consistently named across registry, fetch-live, assertions, and verification.
