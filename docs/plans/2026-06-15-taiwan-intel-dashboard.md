# 台灣情報儀表板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **使用者規則覆蓋**：本專案**不自動 git commit**。各 Task 末的 commit 步驟為建議；實際執行前需經使用者同意，或先累積到使用者要求時再一次提交。

**Goal:** 一個聚焦台灣國內/國際、可溯源的輕量情報儀表板（Vite + Vanilla TS + Leaflet，真實台灣資料靜態快照）。

**Architecture:** 純靜態前端 fetch 靜態 JSON 快照 → loader 過濾 → 小型發布/訂閱 store → 各視圖（地圖/卡片/時間軸/篩選/來源）渲染。每筆事件自帶可重現的溯源資訊（Provenance），另有批次 manifest。

**Tech Stack:** Vite, TypeScript, Leaflet, Vitest, 原生 CSS（design token）。

工作目錄：`D:\Users\Administrator\Desktop\爬蟲資料\taiwan-intel-dashboard`

---

## File Structure

| 檔案 | 責任 |
|---|---|
| `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html` | 腳手架 |
| `src/types/event.ts` | 統一事件 + 溯源型別 |
| `src/data/loader.ts` | fetch + 過濾（scope/分類/風險/時間） |
| `src/store.ts` | 發布/訂閱狀態 |
| `src/components/*.ts` | MapView / EventList / EventCard / RiskBadge / TimelineView / FilterBar / SourcePanel |
| `src/i18n/zh-TW.ts` | 介面繁中字串 |
| `src/styles/*.css` | tokens + global + components |
| `data/domestic.json` / `data/international.json` / `data/provenance.json` | 真實快照 + 溯源 manifest |
| `scripts/fetch-snapshot.md` | 抓取來源/查詢/更新方式紀錄 |
| `tests/*.test.ts` | loader 過濾、schema 驗證 |

---

## Task 1: 腳手架與可跑的空殼

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.ts`, `vitest.config.ts`

- [ ] **Step 1: 建 package.json**

```json
{
  "name": "taiwan-intel-dashboard",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": { "leaflet": "^1.9.4" },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0",
    "@types/leaflet": "^1.9.12"
  }
}
```

- [ ] **Step 2: tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["vite/client"],
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: vite.config.ts 與 vitest.config.ts**

`vite.config.ts`:
```typescript
import { defineConfig } from "vite";
export default defineConfig({ base: "./", build: { outDir: "dist" } });
```
`vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```

- [ ] **Step 4: index.html**

```html
<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>台灣情報儀表板</title>
    <link rel="stylesheet" href="/src/styles/global.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: 最小 main.ts**

```typescript
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<h1>台灣情報儀表板</h1>`;
```

- [ ] **Step 6: 安裝並啟動**

Run: `npm install`
Run: `npm run dev`
Expected: 終端顯示 `Local: http://localhost:5173`，瀏覽器可見標題。

- [ ] **Step 7: Commit（依使用者規則需先確認）**

```bash
git init && git add -A && git commit -m "chore: scaffold taiwan-intel-dashboard"
```

---

## Task 2: 統一事件 + 溯源型別

**Files:**
- Create: `src/types/event.ts`

- [ ] **Step 1: 寫型別**

```typescript
export type Scope = "domestic" | "international";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type SourceType = "gov-open-data" | "news-rss" | "cwa" | "manual";

export interface Provenance {
  name: string;
  type: SourceType;
  datasetId?: string;
  recordRef?: string;
  url?: string;
  fetchedAt: string; // ISO8601
  query?: string;
}

export interface IntelEvent {
  id: string;
  title: string;
  region: string;
  lat?: number;
  lng?: number;
  timestamp: string; // ISO8601
  category: string;
  scope: Scope;
  riskLevel: RiskLevel;
  summary: string;
  source: Provenance;
}

export const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0, medium: 1, high: 2, critical: 3,
};
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

---

## Task 3: loader 過濾邏輯（TDD）

**Files:**
- Create: `src/data/loader.ts`
- Test: `tests/loader.test.ts`

- [ ] **Step 1: 寫失敗測試**

```typescript
import { describe, it, expect } from "vitest";
import { filterEvents } from "../src/data/loader";
import type { IntelEvent } from "../src/types/event";

const base: IntelEvent = {
  id: "1", title: "t", region: "臺北市", timestamp: "2026-06-14T00:00:00+08:00",
  category: "治安", scope: "domestic", riskLevel: "low", summary: "s",
  source: { name: "x", type: "manual", fetchedAt: "2026-06-15T00:00:00+08:00" },
};
const evs: IntelEvent[] = [
  base,
  { ...base, id: "2", category: "災防", riskLevel: "high" },
  { ...base, id: "3", scope: "international", category: "資安", riskLevel: "critical" },
];

describe("filterEvents", () => {
  it("filters by scope", () => {
    expect(filterEvents(evs, { scope: "domestic" }).map(e => e.id)).toEqual(["1", "2"]);
  });
  it("filters by category", () => {
    expect(filterEvents(evs, { scope: "domestic", category: "災防" }).map(e => e.id)).toEqual(["2"]);
  });
  it("filters by minimum risk", () => {
    expect(filterEvents(evs, { minRisk: "high" }).map(e => e.id)).toEqual(["2", "3"]);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/loader.test.ts`
Expected: FAIL（`filterEvents` 未定義）。

- [ ] **Step 3: 實作 loader**

```typescript
import type { IntelEvent, Scope, RiskLevel } from "../types/event";
import { RISK_ORDER } from "../types/event";

export interface FilterOptions {
  scope?: Scope;
  category?: string;
  minRisk?: RiskLevel;
  source?: string;
  sinceDays?: number;
}

export function filterEvents(events: IntelEvent[], opts: FilterOptions): IntelEvent[] {
  const cutoff = opts.sinceDays
    ? Date.now() - opts.sinceDays * 86400000
    : undefined;
  return events.filter((e) => {
    if (opts.scope && e.scope !== opts.scope) return false;
    if (opts.category && e.category !== opts.category) return false;
    if (opts.minRisk && RISK_ORDER[e.riskLevel] < RISK_ORDER[opts.minRisk]) return false;
    if (opts.source && e.source.name !== opts.source) return false;
    if (cutoff && new Date(e.timestamp).getTime() < cutoff) return false;
    return true;
  });
}

export async function loadEvents(scope: Scope): Promise<IntelEvent[]> {
  const res = await fetch(`./data/${scope}.json`);
  if (!res.ok) throw new Error(`載入 ${scope}.json 失敗: ${res.status}`);
  return (await res.json()) as IntelEvent[];
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/loader.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: Commit（依使用者規則需先確認）**

```bash
git add src/types src/data tests && git commit -m "feat: event schema and loader filtering with tests"
```

---

## Task 4: 發布/訂閱 store

**Files:**
- Create: `src/store.ts`

- [ ] **Step 1: 實作 store**

```typescript
import type { Scope, RiskLevel } from "./types/event";

export interface AppState {
  scope: Scope;
  category?: string;
  minRisk?: RiskLevel;
  source?: string;
}

type Listener = (s: AppState) => void;

const state: AppState = { scope: "domestic" };
const listeners = new Set<Listener>();

export function getState(): AppState { return { ...state }; }
export function setState(patch: Partial<AppState>): void {
  Object.assign(state, patch);
  listeners.forEach((l) => l(getState()));
}
export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

---

## Task 5: 抓真實台灣資料快照 + 溯源 manifest

> 本 Task 由具 twinkle-hub MCP 的代理（Claude）執行；產生靜態 JSON 與溯源紀錄。

**Files:**
- Create: `data/domestic.json`, `data/international.json`, `data/provenance.json`, `scripts/fetch-snapshot.md`

- [ ] **Step 1: 抓國內資料**

用 twinkle-hub 抓可得的真實資料，每筆轉成 `IntelEvent`：
- 政府採購決標：`query_rows("pcc-tender", where="announcement_type='決標公告' AND date >= '<近30天>'", limit=40)` → category「採購」，`source.datasetId="pcc-tender"`，`recordRef=標案編號`，`query` 記錄 where。
- 其他可得 domain（治安/裁罰/災防）：依實際可抓取者加入；無座標者 lat/lng 留空。
- 地震（CWA 開放資料，若可由 WebFetch 取得）：category「災防」，`source.type="cwa"`。

每筆 `source.fetchedAt` 填當下時間（ISO8601）。

- [ ] **Step 2: 抓國際資料**

公開來源整理近 30 天地緣政治/災害/資安/金融重點，每筆附 `url` 與 `fetchedAt`，存 `international.json`。

- [ ] **Step 3: 寫溯源 manifest**

`data/provenance.json`：
```jsonc
{
  "generatedAt": "<ISO8601>",
  "sources": [
    { "datasetId": "pcc-tender", "name": "政府電子採購網", "type": "gov-open-data",
      "query": "announcement_type='決標公告' AND date >= '...'", "count": 40, "fetchedAt": "<ISO8601>" }
    // …每個來源一筆
  ]
}
```

- [ ] **Step 4: 記錄抓取方式**

`scripts/fetch-snapshot.md` 寫下每個來源的 dataset、查詢、限制筆數/取樣方式、重抓步驟。

- [ ] **Step 5: 驗證**

Run: `node -e "const d=require('./data/domestic.json'); console.log('count', d.length); console.log('has source', d.every(e=>e.source&&e.source.fetchedAt))"`
Expected: count > 0、`has source true`。

- [ ] **Step 6: Commit（依使用者規則需先確認）**

```bash
git add data scripts && git commit -m "data: real Taiwan intel snapshot with provenance"
```

---

## Task 6: RiskBadge 與 EventCard（含溯源連結）

**Files:**
- Create: `src/components/RiskBadge.ts`, `src/components/EventCard.ts`

- [ ] **Step 1: RiskBadge**

```typescript
import type { RiskLevel } from "../types/event";

const LABEL: Record<RiskLevel, string> = {
  low: "低", medium: "中", high: "高", critical: "危急",
};

export function riskBadge(level: RiskLevel): string {
  return `<span class="risk-badge risk-${level}">${LABEL[level]}</span>`;
}
```

- [ ] **Step 2: EventCard（顯示來源 + 可點回原始 + 抓取時間）**

```typescript
import type { IntelEvent } from "../types/event";
import { riskBadge } from "./RiskBadge";

export function eventCard(e: IntelEvent): string {
  const time = new Date(e.timestamp).toLocaleString("zh-TW", { hour12: false });
  const src = e.source.url
    ? `<a class="src-link" href="${e.source.url}" target="_blank" rel="noopener">↗ ${e.source.name}</a>`
    : `<span class="src-link src-none" title="無原始連結">${e.source.name}（無原始連結）</span>`;
  const fetched = new Date(e.source.fetchedAt).toLocaleString("zh-TW", { hour12: false });
  return `
    <article class="event-card" data-id="${e.id}">
      <header>${riskBadge(e.riskLevel)} <span class="cat">${e.category}</span>
        <span class="region">${e.region}</span></header>
      <h3>${e.title}</h3>
      <p class="summary">${e.summary}</p>
      <footer>
        <time>${time}</time>
        ${src}
        <span class="fetched" title="抓取時間">擷取於 ${fetched}</span>
      </footer>
    </article>`;
}
```

- [ ] **Step 3: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

---

## Task 7: EventList 與 MapView

**Files:**
- Create: `src/components/EventList.ts`, `src/components/MapView.ts`

- [ ] **Step 1: EventList**

```typescript
import type { IntelEvent } from "../types/event";
import { eventCard } from "./EventCard";

export function renderEventList(container: HTMLElement, events: IntelEvent[]): void {
  container.innerHTML = events.length
    ? events.map(eventCard).join("")
    : `<p class="empty">無符合條件的情報</p>`;
}
```

- [ ] **Step 2: MapView（Leaflet 標記 + 風險色）**

```typescript
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { IntelEvent, RiskLevel } from "../types/event";

const RISK_COLOR: Record<RiskLevel, string> = {
  low: "#3b82f6", medium: "#eab308", high: "#f97316", critical: "#ef4444",
};

export class MapView {
  private map: L.Map;
  private layer = L.layerGroup();
  constructor(el: HTMLElement) {
    this.map = L.map(el).setView([23.7, 121], 7);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap", maxZoom: 18,
    }).addTo(this.map);
    this.layer.addTo(this.map);
  }
  render(events: IntelEvent[]): void {
    this.layer.clearLayers();
    for (const e of events) {
      if (e.lat == null || e.lng == null) continue;
      L.circleMarker([e.lat, e.lng], {
        radius: 7, color: RISK_COLOR[e.riskLevel], fillOpacity: 0.7,
      }).bindPopup(`<b>${e.title}</b><br>${e.region}｜${e.category}`).addTo(this.layer);
    }
  }
}
```

- [ ] **Step 3: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

---

## Task 8: FilterBar、TimelineView、SourcePanel

**Files:**
- Create: `src/components/FilterBar.ts`, `src/components/TimelineView.ts`, `src/components/SourcePanel.ts`

- [ ] **Step 1: FilterBar（分類/風險 下拉，觸發 store）**

```typescript
import { setState } from "../store";
import type { RiskLevel } from "../types/event";

const CATS: Record<string, string[]> = {
  domestic: ["治安", "災防", "採購", "交通"],
  international: ["地緣政治", "災害", "資安", "金融"],
};

export function renderFilterBar(container: HTMLElement, scope: "domestic" | "international"): void {
  const cats = CATS[scope].map((c) => `<option value="${c}">${c}</option>`).join("");
  container.innerHTML = `
    <select id="f-cat"><option value="">全部分類</option>${cats}</select>
    <select id="f-risk">
      <option value="">全部風險</option>
      <option value="medium">中以上</option>
      <option value="high">高以上</option>
      <option value="critical">僅危急</option>
    </select>`;
  container.querySelector<HTMLSelectElement>("#f-cat")!.onchange = (ev) =>
    setState({ category: (ev.target as HTMLSelectElement).value || undefined });
  container.querySelector<HTMLSelectElement>("#f-risk")!.onchange = (ev) =>
    setState({ minRisk: ((ev.target as HTMLSelectElement).value || undefined) as RiskLevel | undefined });
}
```

- [ ] **Step 2: TimelineView（近 7 天分組計數）**

```typescript
import type { IntelEvent } from "../types/event";

export function renderTimeline(container: HTMLElement, events: IntelEvent[]): void {
  const days: { label: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    const count = events.filter((e) => {
      const t = new Date(e.timestamp);
      return t.getMonth() === d.getMonth() && t.getDate() === d.getDate();
    }).length;
    days.push({ label, count });
  }
  const max = Math.max(1, ...days.map((d) => d.count));
  container.innerHTML = `<div class="timeline">${days
    .map((d) => `<div class="tl-bar"><div class="tl-fill" style="height:${(d.count / max) * 100}%"></div><span>${d.label}</span><b>${d.count}</b></div>`)
    .join("")}</div>`;
}
```

- [ ] **Step 3: SourcePanel（讀 provenance manifest）**

```typescript
interface ProvSource { name: string; datasetId?: string; count: number; fetchedAt: string; query?: string; }
interface Manifest { generatedAt: string; sources: ProvSource[]; }

export async function renderSourcePanel(container: HTMLElement): Promise<void> {
  const res = await fetch("./data/provenance.json");
  if (!res.ok) { container.innerHTML = `<p>來源資訊不可用</p>`; return; }
  const m = (await res.json()) as Manifest;
  container.innerHTML = `<h4>資料來源（擷取於 ${new Date(m.generatedAt).toLocaleString("zh-TW", { hour12: false })}）</h4>
    <ul class="source-list">${m.sources
      .map((s) => `<li><b>${s.name}</b>（${s.count} 筆）${s.query ? `<code title="可重現查詢">${s.query}</code>` : ""}</li>`)
      .join("")}</ul>`;
}
```

- [ ] **Step 4: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

---

## Task 9: 組裝 main.ts（雙頁切換 + 串接所有視圖）

**Files:**
- Modify: `src/main.ts`
- Create: `src/i18n/zh-TW.ts`

- [ ] **Step 1: i18n 繁中字串**

```typescript
export const t = {
  appTitle: "台灣情報儀表板",
  tabDomestic: "國內",
  tabInternational: "國際",
  map: "情勢地圖",
  events: "情報列表",
  timeline: "近 7 天",
  sources: "資料來源",
};
```

- [ ] **Step 2: main.ts 組裝**

```typescript
import { t } from "./i18n/zh-TW";
import { getState, setState, subscribe } from "./store";
import { loadEvents, filterEvents } from "./data/loader";
import { renderEventList } from "./components/EventList";
import { renderFilterBar } from "./components/FilterBar";
import { renderTimeline } from "./components/TimelineView";
import { renderSourcePanel } from "./components/SourcePanel";
import { MapView } from "./components/MapView";
import type { IntelEvent, Scope } from "./types/event";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="topbar">
    <h1>${t.appTitle}</h1>
    <nav class="tabs">
      <button data-scope="domestic" class="active">${t.tabDomestic}</button>
      <button data-scope="international">${t.tabInternational}</button>
    </nav>
  </header>
  <div id="filterbar" class="filterbar"></div>
  <main class="layout">
    <section class="col-map"><h2>${t.map}</h2><div id="map" class="map"></div>
      <div id="timeline"></div></section>
    <section class="col-list"><h2>${t.events}</h2><div id="eventlist"></div></section>
    <aside class="col-side"><div id="sourcepanel"></div></aside>
  </main>`;

const mapView = new MapView(document.getElementById("map")!);
const cache: Partial<Record<Scope, IntelEvent[]>> = {};

async function refresh(): Promise<void> {
  const s = getState();
  if (!cache[s.scope]) cache[s.scope] = await loadEvents(s.scope);
  const filtered = filterEvents(cache[s.scope]!, s);
  renderEventList(document.getElementById("eventlist")!, filtered);
  mapView.render(filtered);
  renderTimeline(document.getElementById("timeline")!, filtered);
}

document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const scope = btn.dataset.scope as Scope;
    setState({ scope, category: undefined, minRisk: undefined });
    renderFilterBar(document.getElementById("filterbar")!, scope);
  };
});

subscribe(() => { void refresh(); });
renderFilterBar(document.getElementById("filterbar")!, "domestic");
void renderSourcePanel(document.getElementById("sourcepanel")!);
void refresh();
```

- [ ] **Step 3: 啟動驗證**

Run: `npm run dev`
Expected: 地圖顯示台灣、國內事件卡片與標記出現、切到「國際」資料更換、篩選即時生效、來源面板列出 provenance。

- [ ] **Step 4: Commit（依使用者規則需先確認）**

```bash
git add src && git commit -m "feat: assemble dashboard with dual-page switching and provenance UI"
```

---

## Task 10: 樣式（design token）與風險色

**Files:**
- Create: `src/styles/tokens.css`, `src/styles/global.css`

- [ ] **Step 1: tokens.css**

```css
:root {
  --color-surface: #0f172a; --color-panel: #1e293b; --color-text: #e2e8f0;
  --color-muted: #94a3b8; --color-accent: #38bdf8;
  --risk-low: #3b82f6; --risk-medium: #eab308; --risk-high: #f97316; --risk-critical: #ef4444;
  --space: 12px; --radius: 10px;
}
```

- [ ] **Step 2: global.css（含 import、版面、卡片、風險徽章、時間軸）**

```css
@import "./tokens.css";
* { box-sizing: border-box; }
body { margin: 0; font-family: "Noto Sans TC", system-ui, sans-serif;
  background: var(--color-surface); color: var(--color-text); }
.topbar { display: flex; justify-content: space-between; align-items: center;
  padding: var(--space) 20px; background: var(--color-panel); }
.tabs button { background: transparent; color: var(--color-muted); border: none;
  padding: 8px 16px; cursor: pointer; font-size: 1rem; }
.tabs button.active { color: var(--color-accent); border-bottom: 2px solid var(--color-accent); }
.filterbar { display: flex; gap: var(--space); padding: var(--space) 20px; }
.filterbar select { background: var(--color-panel); color: var(--color-text);
  border: 1px solid #334155; border-radius: 6px; padding: 6px; }
.layout { display: grid; grid-template-columns: 1.4fr 1fr 0.7fr; gap: var(--space); padding: 0 20px 20px; }
@media (max-width: 1000px) { .layout { grid-template-columns: 1fr; } }
.map { height: 420px; border-radius: var(--radius); overflow: hidden; }
.event-card { background: var(--color-panel); border-radius: var(--radius);
  padding: var(--space); margin-bottom: var(--space); }
.event-card h3 { margin: 6px 0; font-size: 1rem; }
.event-card .summary { color: var(--color-muted); font-size: 0.9rem; }
.event-card footer { display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
  font-size: 0.78rem; color: var(--color-muted); margin-top: 8px; }
.src-link { color: var(--color-accent); text-decoration: none; }
.src-none { color: var(--color-muted); }
.risk-badge { padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; color: #0b1220; font-weight: 700; }
.risk-low { background: var(--risk-low); } .risk-medium { background: var(--risk-medium); }
.risk-high { background: var(--risk-high); } .risk-critical { background: var(--risk-critical); color: #fff; }
.timeline { display: flex; gap: 6px; align-items: flex-end; height: 80px; margin-top: 10px; }
.tl-bar { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
  font-size: 0.7rem; color: var(--color-muted); height: 100%; }
.tl-fill { width: 70%; background: var(--color-accent); border-radius: 4px 4px 0 0; min-height: 2px; }
.source-list { list-style: none; padding: 0; font-size: 0.82rem; }
.source-list code { display: block; color: var(--color-muted); font-size: 0.72rem; margin-top: 2px; }
.empty { color: var(--color-muted); padding: var(--space); }
```

- [ ] **Step 3: 視覺驗證**

Run: `npm run dev`
Expected: 深色情報風介面、風險色正確、版面三欄（窄螢幕單欄）。

---

## Task 11: 效能與 build 收尾

**Files:**
- 無新增（驗證為主）

- [ ] **Step 1: 型別 + 測試 + build**

Run: `npm run test`
Expected: loader 測試 PASS。

Run: `npm run build`
Expected: `tsc --noEmit` 無錯、`dist/` 產出成功。

- [ ] **Step 2: 產物大小檢查**

Run: `node -e "const fs=require('fs');const f=fs.readdirSync('dist/assets');f.forEach(x=>console.log(x, (fs.statSync('dist/assets/'+x).size/1024).toFixed(1)+'KB'))"`
Expected: JS 主包合理（Leaflet 為主要重量），無異常巨大檔。

- [ ] **Step 3: Lighthouse（手動）**

`npm run preview` 後對 `http://localhost:4173` 跑 Lighthouse。
Expected: Performance 良好、LCP < 2.5s、CLS < 0.1。

- [ ] **Step 4: Commit（依使用者規則需先確認）**

```bash
git add -A && git commit -m "chore: styles and performance pass"
```

---

## Self-Review 結果

- **Spec 覆蓋**：技術選型(Task 1)、schema+溯源(Task 2)、loader(Task 3)、store(Task 4)、真實快照+manifest(Task 5)、卡片/風險/溯源 UI(Task 6)、地圖/列表(Task 7)、篩選/時間軸/來源(Task 8)、雙頁(Task 9)、繁中+樣式(Task 9/10)、效能(Task 11) — 全部對應。
- **型別一致**：`filterEvents`/`loadEvents`/`MapView.render`/`renderEventList` 等命名於各 Task 一致；`IntelEvent`/`Provenance`/`RiskLevel` 沿用 Task 2 定義。
- **無 placeholder**：各步驟均含可執行 code 與驗證命令。
- **誠實溯源**：無原始連結者明確標示，不以合成連結偽裝。
