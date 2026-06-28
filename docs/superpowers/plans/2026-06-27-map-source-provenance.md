# Map Source Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the map and event cards from presenting Google News query labels such as `GN 詐騙逮捕` as real news sources, while clearly showing source chain and location precision.

**Architecture:** Add explicit provenance metadata at ingestion time, preserve aggregator/query information separately from publisher identity, and render this distinction in event cards and map popups. Add data-audit tests so future refreshes cannot regress to fake source names or unqualified inferred map points.

**Tech Stack:** TypeScript, Vite, Leaflet, Node ESM scripts, Vitest.

---

## File Structure

- Modify: `src/types/event.ts`
  - Add provenance and location-precision fields used by UI and tests.
- Modify: `scripts/lib/fetch-rss.mjs`
  - Parse Google News item-level publisher metadata and tag Google News as aggregator, not publisher.
- Modify: `scripts/lib/nvidia.mjs`
  - Preserve publisher/aggregator fields when normalizing LLM news events.
- Modify: `scripts/lib/news-bulk.mjs`
  - Preserve the same provenance fields for lightweight/non-LLM mapped news.
- Modify: `src/components/EventCard.ts`
  - Render publisher, aggregator, query, and link type without calling `GN ...` a source.
- Modify: `src/components/MapView.ts`
  - Add source-chain and location-precision labels in popups; visually dim aggregated/inferred items.
- Modify: `src/styles/global.css`
  - Add marker/popup styles for aggregated and inferred data.
- Create: `scripts/audit-source-provenance.mjs`
  - Static data audit against generated JSON files.
- Create/Modify tests:
  - `tests/source-provenance.test.ts`
  - `tests/event-card.test.ts`
  - `tests/map-view.test.ts` if DOM/Leaflet mocking is already practical; otherwise test helper output only.

---

## Task 1: Extend Event Types

**Files:**
- Modify: `src/types/event.ts`

- [ ] **Step 1: Add provenance fields**

Change `Provenance` to include explicit publisher/aggregator metadata:

```ts
export type SourceType = "gov-open-data" | "news-rss" | "cwa" | "manual";
export type IngestMethod = "direct-rss" | "google-news-rss" | "gov-open-data" | "manual";
export type SourceConfidence = "verified" | "aggregated" | "inferred";
export type LocationPrecision = "exact" | "address" | "district" | "city" | "country" | "global" | "unknown";

export interface Provenance {
  name: string;
  type: SourceType;
  datasetId?: string;
  recordRef?: string;
  url?: string;
  fetchedAt: string; // ISO8601
  query?: string;
  publisherName?: string;
  publisherUrl?: string;
  aggregatorName?: string;
  aggregatorUrl?: string;
  ingestMethod?: IngestMethod;
  sourceConfidence?: SourceConfidence;
}
```

- [ ] **Step 2: Add location metadata to events**

Extend `IntelEvent`:

```ts
export interface IntelEvent {
  id: string;
  title: string;
  region: string;
  lat?: number;
  lng?: number;
  locationPrecision?: LocationPrecision;
  locationNote?: string;
  timestamp: string; // ISO8601
  category: string;
  scope: Scope;
  riskLevel: RiskLevel;
  summary: string;
  source: Provenance;
  aiEntities?: string[];
  aiTopic?: string;
}
```

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run build:static
```

Expected: TypeScript accepts the new optional fields; build may still expose later logic failures to address in following tasks.

---

## Task 2: Parse Google News Publisher Separately

**Files:**
- Modify: `scripts/lib/fetch-rss.mjs`
- Test: `tests/source-provenance.test.ts`

- [ ] **Step 1: Add a failing test for Google News parsing**

Create `tests/source-provenance.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { deriveFeedProvenanceForTest } from "../scripts/lib/fetch-rss.mjs";

describe("source provenance", () => {
  it("does not treat Google News query labels as publishers", () => {
    const item = deriveFeedProvenanceForTest({
      title: "測試新聞",
      link: "https://news.google.com/rss/articles/example?oc=5",
      source: "GN 詐騙逮捕",
      sourceUrl: "https://news.google.com/rss/search?q=詐騙逮捕%20when%3A5d&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
      publisherName: "自由時報",
      publisherUrl: "https://news.ltn.com.tw/",
    });

    expect(item.name).toBe("自由時報");
    expect(item.publisherName).toBe("自由時報");
    expect(item.aggregatorName).toBe("Google News");
    expect(item.ingestMethod).toBe("google-news-rss");
    expect(item.sourceConfidence).toBe("aggregated");
    expect(item.query).toContain("GN 詐騙逮捕");
  });
});
```

- [ ] **Step 2: Export test helper from fetch-rss**

In `scripts/lib/fetch-rss.mjs`, add helper:

```js
function isGoogleNewsUrl(url = "") {
  try {
    return new URL(url).hostname === "news.google.com";
  } catch {
    return false;
  }
}

function feedQueryLabel(label = "") {
  return label.startsWith("GN ") ? label : undefined;
}

export function deriveFeedProvenanceForTest(item) {
  const viaGoogle = isGoogleNewsUrl(item.sourceUrl) || isGoogleNewsUrl(item.link);
  const queryLabel = feedQueryLabel(item.source);
  const publisherName = item.publisherName || (viaGoogle ? undefined : item.source);

  return {
    name: publisherName || (viaGoogle ? "Google News 聚合" : item.source),
    type: "news-rss",
    recordRef: item.link,
    url: item.link,
    publisherName,
    publisherUrl: item.publisherUrl,
    aggregatorName: viaGoogle ? "Google News" : undefined,
    aggregatorUrl: viaGoogle ? item.sourceUrl : undefined,
    ingestMethod: viaGoogle ? "google-news-rss" : "direct-rss",
    sourceConfidence: viaGoogle ? "aggregated" : "verified",
    query: queryLabel ? `${queryLabel}｜RSS ${item.sourceUrl}` : `RSS ${item.sourceUrl}`,
  };
}
```

- [ ] **Step 3: Parse RSS `<source>` inside `parseFeed`**

Update parsed item shape:

```js
function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) || [];
  for (const b of blocks) {
    const sourceMatch = b.match(/<source(?:\s+url="([^"]+)")?[^>]*>([\s\S]*?)<\/source>/i);
    items.push({
      title: pick(b, ["title"]),
      link: pickLink(b),
      description: pick(b, ["description", "summary", "content"]),
      pubDate: pick(b, ["pubDate", "updated", "published"]),
      publisherName: sourceMatch ? decode(sourceMatch[2]) : undefined,
      publisherUrl: sourceMatch?.[1],
    });
  }
  return items;
}
```

- [ ] **Step 4: Preserve publisher fields in `fetchOne`**

Ensure existing map keeps the parsed fields:

```js
.map((i) => ({ ...i, source: feed.label, sourceUrl: feed.url, hint: feed.hint }));
```

Expected: `publisherName` and `publisherUrl` remain on each item.

- [ ] **Step 5: Run targeted test**

Run:

```bash
npm test -- tests/source-provenance.test.ts
```

Expected: PASS.

---

## Task 3: Preserve Provenance in LLM Normalization

**Files:**
- Modify: `scripts/lib/nvidia.mjs`
- Modify: `scripts/lib/fetch-rss.mjs`
- Test: `tests/source-provenance.test.ts`

- [ ] **Step 1: Export production provenance helper**

Rename helper from Task 2:

```js
export function deriveNewsProvenance(item, { fetchedAt, model } = {}) {
  const viaGoogle = isGoogleNewsUrl(item.sourceUrl) || isGoogleNewsUrl(item.link);
  const queryLabel = feedQueryLabel(item.source);
  const publisherName = item.publisherName || (viaGoogle ? undefined : item.source);

  return {
    name: publisherName || (viaGoogle ? "Google News 聚合" : item.source),
    type: "news-rss",
    datasetId: "tw-news",
    recordRef: item.link,
    url: item.link,
    fetchedAt,
    publisherName,
    publisherUrl: item.publisherUrl,
    aggregatorName: viaGoogle ? "Google News" : undefined,
    aggregatorUrl: viaGoogle ? item.sourceUrl : undefined,
    ingestMethod: viaGoogle ? "google-news-rss" : "direct-rss",
    sourceConfidence: viaGoogle ? "aggregated" : "verified",
    query: queryLabel
      ? `${queryLabel}｜RSS ${item.sourceUrl} → LLM(${model}) 正規化`
      : `RSS ${item.sourceUrl} → LLM(${model}) 正規化`,
  };
}

export const deriveFeedProvenanceForTest = deriveNewsProvenance;
```

- [ ] **Step 2: Use helper in `normalizeDomesticNews` mapping path**

In `scripts/lib/nvidia.mjs`, import:

```js
import { deriveNewsProvenance } from "./fetch-rss.mjs";
```

Replace domestic source object:

```js
source: deriveNewsProvenance(it, { fetchedAt, model }),
```

- [ ] **Step 3: Apply same rule to international normalization**

For international items, use the same helper but allow dataset ID to remain absent if desired. Minimal acceptable version:

```js
source: {
  ...deriveNewsProvenance(it, { fetchedAt, model }),
  datasetId: undefined,
},
```

- [ ] **Step 4: Add regression assertion**

Extend `tests/source-provenance.test.ts`:

```ts
it("falls back to Google News 聚合 when publisher is unavailable", () => {
  const item = deriveFeedProvenanceForTest({
    title: "測試新聞",
    link: "https://news.google.com/rss/articles/example?oc=5",
    source: "GN 假投資假交友",
    sourceUrl: "https://news.google.com/rss/search?q=假投資%20when%3A5d&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
  });

  expect(item.name).toBe("Google News 聚合");
  expect(item.name.startsWith("GN ")).toBe(false);
  expect(item.query).toContain("GN 假投資假交友");
});
```

- [ ] **Step 5: Run test**

Run:

```bash
npm test -- tests/source-provenance.test.ts
```

Expected: PASS.

---

## Task 4: Preserve Provenance in Lightweight News Mapping

**Files:**
- Modify: `scripts/lib/news-bulk.mjs`
- Test: `tests/news-bulk.test.ts`

- [ ] **Step 1: Locate bulk event mapper**

Open `scripts/lib/news-bulk.mjs` and find the object that creates `source: { name: it.source, type: "news-rss", ... }`.

- [ ] **Step 2: Import provenance helper**

```js
import { deriveNewsProvenance } from "./fetch-rss.mjs";
```

- [ ] **Step 3: Replace source construction**

Use:

```js
source: deriveNewsProvenance(it, { fetchedAt, model: "bulk" }),
```

- [ ] **Step 4: Set default location precision for lightweight mapped news**

When location is derived from region/city, include:

```js
locationPrecision: lat != null && lng != null ? "city" : "unknown",
locationNote: lat != null && lng != null ? "依新聞地區推論，非精準事發地址" : undefined,
```

- [ ] **Step 5: Add test assertion**

In `tests/news-bulk.test.ts`, add assertion to existing mapped news case:

```ts
expect(event.source.name.startsWith("GN ")).toBe(false);
expect(event.source.aggregatorName).toBe("Google News");
expect(event.locationPrecision).toBe("city");
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- tests/news-bulk.test.ts tests/source-provenance.test.ts
```

Expected: PASS.

---

## Task 5: Render Source Chain in Event Cards

**Files:**
- Modify: `src/components/EventCard.ts`
- Test: `tests/event-card.test.ts`

- [ ] **Step 1: Add display helper**

Add helper near `sourceTypeLabel`:

```ts
function sourceDisplayName(e: IntelEvent): string {
  if (e.source.publisherName) return e.source.publisherName;
  if (e.source.aggregatorName) return `${e.source.aggregatorName} 聚合`;
  return e.source.name;
}

function sourceChain(e: IntelEvent): string {
  const bits = [];
  bits.push(`來源：${sourceDisplayName(e)}`);
  if (e.source.aggregatorName) bits.push(`經由：${e.source.aggregatorName}`);
  if (e.source.sourceConfidence === "aggregated") bits.push("聚合來源，請點開原文確認");
  return bits.join("｜");
}
```

- [ ] **Step 2: Use helper in footer link**

Replace footer source label:

```ts
const displaySource = sourceDisplayName(e);
const src =
  linkUrl && /^https?:\/\//.test(linkUrl)
    ? `<a class="src-link" href="${esc(linkUrl)}" target="_blank" rel="noopener" title="${esc(sourceChain(e))}">↗ ${esc(displaySource)}</a>`
    : `<span class="src-link src-none" title="無原始連結">${esc(displaySource)}（無原始連結）</span>`;
```

- [ ] **Step 3: Add source-chain context row**

In `eventContext(e)`, append:

```ts
if (e.source.aggregatorName) {
  parts.push(`<span class="ctx-aggregator"><b>經由</b>${esc(e.source.aggregatorName)}</span>`);
}
if (e.locationPrecision) {
  parts.push(`<span class="ctx-location"><b>定位</b>${esc(locationPrecisionLabel(e.locationPrecision))}</span>`);
}
```

Add helper:

```ts
function locationPrecisionLabel(value: IntelEvent["locationPrecision"]): string {
  switch (value) {
    case "exact":
    case "address":
      return "精準位置";
    case "district":
      return "行政區推論";
    case "city":
      return "縣市推論";
    case "country":
      return "國家層級";
    case "global":
      return "全球概略";
    default:
      return "未知";
  }
}
```

- [ ] **Step 4: Add event card regression test**

In `tests/event-card.test.ts`:

```ts
it("shows Google News as aggregator, not source name", () => {
  const html = eventCard({
    id: "twnews-test",
    title: "測試新聞",
    region: "臺北市",
    lat: 25.03,
    lng: 121.56,
    locationPrecision: "city",
    timestamp: "2026-06-27T00:00:00.000Z",
    category: "治安",
    scope: "domestic",
    riskLevel: "medium",
    summary: "摘要",
    source: {
      name: "Google News 聚合",
      type: "news-rss",
      datasetId: "tw-news",
      recordRef: "https://news.google.com/rss/articles/example?oc=5",
      url: "https://news.google.com/rss/articles/example?oc=5",
      fetchedAt: "2026-06-27T00:00:00.000Z",
      query: "GN 詐騙逮捕｜RSS https://news.google.com/rss/search?q=x",
      aggregatorName: "Google News",
      ingestMethod: "google-news-rss",
      sourceConfidence: "aggregated",
    },
  });

  expect(html).toContain("Google News 聚合");
  expect(html).toContain("經由");
  expect(html).toContain("縣市推論");
  expect(html).not.toContain(">GN 詐騙逮捕<");
});
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- tests/event-card.test.ts
```

Expected: PASS.

---

## Task 6: Render Source and Location Warnings in Map Popup

**Files:**
- Modify: `src/components/MapView.ts`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Add popup helper functions**

In `src/components/MapView.ts`, add:

```ts
function sourceDisplayName(e: IntelEvent): string {
  if (e.source.publisherName) return e.source.publisherName;
  if (e.source.aggregatorName) return `${e.source.aggregatorName} 聚合`;
  return e.source.name;
}

function locationPrecisionLabel(value: IntelEvent["locationPrecision"]): string {
  switch (value) {
    case "exact":
    case "address":
      return "精準位置";
    case "district":
      return "行政區推論";
    case "city":
      return "縣市推論";
    case "country":
      return "國家層級";
    case "global":
      return "全球概略";
    default:
      return "未知";
  }
}

function popupHtml(e: IntelEvent): string {
  const via = e.source.aggregatorName
    ? `<br><span class="map-popup-warn">經由：${esc(e.source.aggregatorName)}，請點開原文確認</span>`
    : "";
  const loc = e.locationPrecision
    ? `<br><span class="map-popup-muted">定位：${esc(locationPrecisionLabel(e.locationPrecision))}</span>`
    : "";
  return `<b>${esc(e.title)}</b><br>${esc(e.region)}｜${esc(e.category)}<br>來源：${esc(sourceDisplayName(e))}${via}${loc}`;
}
```

- [ ] **Step 2: Use helper in marker popup**

Replace:

```ts
}).bindPopup(`<b>${esc(e.title)}</b><br>${esc(e.region)}｜${esc(e.category)}`);
```

with:

```ts
}).bindPopup(popupHtml(e));
```

- [ ] **Step 3: Add marker classes for source confidence**

Update `markerClass`:

```ts
function markerClass(risk: RiskLevel, e?: IntelEvent): string {
  const confidence = e?.source.sourceConfidence ? ` source-${e.source.sourceConfidence}` : "";
  const precision = e?.locationPrecision ? ` loc-${e.locationPrecision}` : "";
  return `risk-${risk}${confidence}${precision}`;
}
```

Update call:

```ts
className: markerClass(e.riskLevel, e),
```

- [ ] **Step 4: Do not treat global/0,0 as normal points**

Change located filter:

```ts
this.located = events.filter(
  (e) =>
    e.lat != null &&
    e.lng != null &&
    !(e.lat === 0 && e.lng === 0) &&
    e.locationPrecision !== "global",
);
```

- [ ] **Step 5: Add CSS**

In `src/styles/global.css`:

```css
.leaflet-interactive.source-aggregated {
  stroke-dasharray: 4 3;
  fill-opacity: 0.45;
}

.leaflet-interactive.loc-city,
.leaflet-interactive.loc-district,
.leaflet-interactive.loc-country {
  opacity: 0.75;
}

.map-popup-warn {
  color: #facc15;
  font-weight: 700;
}

.map-popup-muted {
  color: #94a3b8;
}
```

- [ ] **Step 6: Run build**

Run:

```bash
npm run build:static
```

Expected: PASS; map bundle builds.

---

## Task 7: Add Static Data Audit Script

**Files:**
- Create: `scripts/audit-source-provenance.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create audit script**

Create `scripts/audit-source-provenance.mjs`:

```js
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const files = ["public/data/domestic.json", "public/data/international.json"];
let failures = 0;

function fail(file, id, message) {
  failures += 1;
  console.error(`${file} ${id}: ${message}`);
}

for (const file of files) {
  const events = JSON.parse(readFileSync(join(root, file), "utf8"));
  for (const e of events) {
    const s = e.source || {};
    if (typeof s.name === "string" && s.name.startsWith("GN ")) {
      fail(file, e.id, `source.name must not be Google News query label: ${s.name}`);
    }
    const url = String(s.url || s.recordRef || "");
    if (url.includes("news.google.com") && s.aggregatorName !== "Google News") {
      fail(file, e.id, "news.google.com URL must declare aggregatorName=Google News");
    }
    if (e.lat === 0 && e.lng === 0 && e.locationPrecision !== "global") {
      fail(file, e.id, "0,0 coordinate must be marked locationPrecision=global or omitted from map");
    }
    if (s.sourceConfidence === "aggregated" && !s.aggregatorName) {
      fail(file, e.id, "aggregated source must include aggregatorName");
    }
  }
}

if (failures) {
  console.error(`source provenance audit failed: ${failures} issue(s)`);
  process.exit(1);
}

console.log("source provenance audit passed");
```

- [ ] **Step 2: Add npm script**

In `package.json` scripts:

```json
"audit:source-provenance": "node scripts/audit-source-provenance.mjs"
```

- [ ] **Step 3: Run audit against current data**

Run:

```bash
npm run audit:source-provenance
```

Expected before full data refresh: FAIL with existing `GN ...` rows. This confirms the audit catches the current problem.

---

## Task 8: Refresh Data and Verify No Fake Sources Remain

**Files:**
- Generated: `public/data/domestic.json`
- Generated: `public/data/international.json`
- Generated: `dist/data/*.json`

- [ ] **Step 1: Refresh news data**

Run:

```bash
npm run refresh:news
```

Expected: new news events include `aggregatorName` and do not use `GN ...` as `source.name`.

- [ ] **Step 2: Rebuild static output**

Run:

```bash
npm run build:static
```

Expected: `dist/data/*.json` mirrors corrected data.

- [ ] **Step 3: Run provenance audit**

Run:

```bash
npm run audit:source-provenance
```

Expected: PASS. If old retained news still fails, either:

1. Let retention expire naturally, or
2. Add one-time migration script to rewrite retained `GN ...` rows based on `news.google.com` links and query labels.

---

## Task 9: Optional One-Time Migration for Retained JSON

**Files:**
- Create: `scripts/migrate-source-provenance.mjs`

Use only if retention keeps old `GN ...` events and immediate cleanup is required.

- [ ] **Step 1: Create migration script**

```js
import { readFileSync, writeFileSync } from "node:fs";

const files = ["public/data/domestic.json", "public/data/international.json"];

for (const file of files) {
  const events = JSON.parse(readFileSync(file, "utf8"));
  let changed = 0;
  for (const e of events) {
    const s = e.source || {};
    const url = String(s.url || s.recordRef || "");
    if (typeof s.name === "string" && s.name.startsWith("GN ")) {
      s.query = s.query ? `${s.name}｜${s.query}` : s.name;
      s.name = "Google News 聚合";
      s.aggregatorName = "Google News";
      s.aggregatorUrl = s.aggregatorUrl || s.url;
      s.ingestMethod = "google-news-rss";
      s.sourceConfidence = "aggregated";
      changed += 1;
    }
    if (url.includes("news.google.com") && !s.aggregatorName) {
      s.aggregatorName = "Google News";
      s.ingestMethod = "google-news-rss";
      s.sourceConfidence = "aggregated";
      changed += 1;
    }
  }
  writeFileSync(file, JSON.stringify(events, null, 2) + "\n");
  console.log(`${file}: migrated ${changed}`);
}
```

- [ ] **Step 2: Run migration**

```bash
node scripts/migrate-source-provenance.mjs
```

Expected: `GN ...` no longer appears in `source.name`.

- [ ] **Step 3: Re-run audit and build**

```bash
npm run audit:source-provenance
npm run build:static
```

Expected: PASS.

---

## Task 10: Final Verification

- [ ] **Step 1: Run complete tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run source audit**

```bash
npm run audit:source-provenance
```

Expected: PASS.

- [ ] **Step 3: Run build**

```bash
npm run build:static
```

Expected: PASS.

- [ ] **Step 4: Manual UI check**

Start preview:

```bash
npm run preview
```

Check map popup and event card:

- `GN ...` must not appear as the clickable source label.
- Google News items must show `經由：Google News`.
- City/district inferred locations must show `定位：縣市推論` or `定位：行政區推論`.
- `0,0` global events must not appear as ordinary map points.

---

## Self-Review

- Spec coverage: Covers ingestion, LLM normalization, lightweight mapping, UI rendering, map rendering, generated data audit, and verification.
- Placeholder scan: No `TBD` or vague implementation-only steps remain.
- Type consistency: Uses `publisherName`, `aggregatorName`, `ingestMethod`, `sourceConfidence`, `locationPrecision`, and `locationNote` consistently across model, scripts, and UI.
- Scope check: This plan intentionally does not solve true canonical publisher resolution from Google redirect URLs if RSS `<source>` is missing. It prevents false source display and clearly labels aggregation, which is the immediate product bug.
