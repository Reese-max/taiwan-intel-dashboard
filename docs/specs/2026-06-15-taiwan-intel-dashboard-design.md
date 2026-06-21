# 台灣情報儀表板 — 設計文件

- 日期：2026-06-15
- 狀態：待使用者 review
- 路線：輕量自建台灣版（參考 koala73/worldmonitor 的資訊架構與呈現方式，不 fork 其 codebase）

## 1. 目標與非目標

### 目標
- 一個聚焦**台灣國內 / 國際**的輕量情報儀表板，呈現方式參考 World Monitor（地圖 + 事件卡 + 風險分級 + 時間軸 + 篩選 + 來源）。
- **真實台灣資料快照**：以 twinkle-hub MCP（政府開放資料）+ 公開新聞為來源，整理成統一 schema 的靜態 JSON，前端讀檔，**第一版無後端**。
- **可溯源（一等公民）**：每筆情報都能追回原始出處、抓取時間、可重現的查詢條件，UI 可點回原始來源。
- **效能優先**：純靜態產出、輕量依賴（Leaflet 取代 3D 地球），符合 Core Web Vitals。

### 非目標（本版不做，留待之後）
- live 自動更新後端 / 排程抓取。
- AI 摘要實際串接（UI 先留版位）。
- World Monitor 的重型功能（3D globe、deck.gl 56 圖層、金融雷達、Tauri 桌面殼、多站變體）。

## 2. 技術選型

| 項目 | 選擇 | 理由 |
|---|---|---|
| 語言 / 建置 | Vite + Vanilla TypeScript | 型別安全、極簡、產出純靜態、與 World Monitor 同語言 |
| 地圖 | Leaflet + OpenStreetMap 圖磚 | 輕量、成熟、繁中友善、**免金鑰** |
| 樣式 | 原生 CSS + CSS 變數（design token） | 無框架負擔，符合效能目標 |
| 資料 | 靜態 JSON 快照（前端 fetch） | 無後端、輕快、可版控、天生可溯源 |
| 語系 | 繁體中文（zh-TW），介面字串集中管理 | 在地化 |

## 3. 架構與資料流

```
靜態 JSON 快照 (data/*.json)            ← 抓取階段一次性產生
        │  fetch
        ▼
   data/loader.ts  ── 解析 + 依 scope/分類/風險/時間過濾
        │
        ▼
   App 狀態 (目前頁 domestic|international, 篩選條件)
        │
        ├─► MapView      (Leaflet 標記 + 風險色)
        ├─► EventList    (事件卡片，含來源/溯源)
        ├─► TimelineView (近 7 天)
        ├─► FilterBar    (分類 / 風險 / 來源)
        └─► SourcePanel  (來源清單 + 溯源 manifest)
```

- 單向資料流：狀態改變 → 重新渲染各視圖。Vanilla TS，以小型 store（發布/訂閱）串接，不引入框架。
- 前端與資料源**解耦**：未來接 RSS/API 只需把新資料轉成統一 schema，前端不改。

## 4. 統一事件 Schema（含溯源）

`src/types/event.ts`

```typescript
type Scope = "domestic" | "international";
type RiskLevel = "low" | "medium" | "high" | "critical";
type SourceType = "gov-open-data" | "news-rss" | "cwa" | "manual";

interface Provenance {
  name: string;        // 來源名稱，如「政府電子採購網」
  type: SourceType;    // 來源類型
  datasetId?: string;  // twinkle-hub dataset id / RSS feed id，如 "pcc-tender"
  recordRef?: string;  // 原始主鍵（標案編號、地震編號…），用於回溯單筆
  url?: string;        // 可點回的原始連結
  fetchedAt: string;   // ISO8601，抓取時間
  query?: string;      // 可重現的查詢條件（如 where=...），供日後重抓核對
}

interface IntelEvent {
  id: string;
  title: string;
  region: string;          // 地區，如「臺北市」
  lat?: number;            // 座標（缺座標的事件仍可進卡片/時間軸，地圖跳過）
  lng?: number;
  timestamp: string;       // ISO8601，事件發生/公告時間
  category: string;        // 治安 / 災防 / 採購 / 地緣政治 / 災害 / 資安 / 金融 …
  scope: Scope;
  riskLevel: RiskLevel;
  summary: string;
  source: Provenance;      // ★ 可溯源核心
}
```

### 溯源機制（兩層）
1. **單筆自帶 `source`**：每筆事件帶完整 Provenance（出處、原始連結、抓取時間、可重現查詢條件、原始主鍵）。
2. **批次 manifest**：`data/provenance.json` 記錄這批快照的每個來源（dataset、查詢、抓取時間、筆數），供整體稽核與重抓。

### UI 溯源呈現
- 每張事件卡顯示來源名稱 + 「↗ 原始來源」可點連結。
- hover / 展開顯示抓取時間與查詢條件。
- SourcePanel 列出所有來源與最後更新時間（讀 manifest）。

## 5. 資料來源（真實快照）

抓取於規劃後的實作階段一次性執行，產生靜態 JSON 並記錄溯源。

### 國內（domestic）
- **政府採購決標**：twinkle-hub `pcc-tender`（記錄 where 查詢與標案編號）。
- **治安 / 裁罰 / 災防**：twinkle-hub 相關 domain dataset（依實抓可得者為準）。
- **地震**：中央氣象署開放資料（CWA）。
- 各筆保留 `datasetId` + `recordRef` + `query` 以可溯源。

### 國際（international）
- 地緣政治 / 災害 / 資安 / 金融：以公開來源整理的快照（每筆附 `url` 與 `fetchedAt`）。

> 抓取細節與實際 dataset 對應，於實作階段確認可得性後寫入 `scripts/fetch-snapshot.md`；無法取得 live 連結的項目，`url` 留空但保留 `name` 與 `fetchedAt`，不以合成資料偽裝為真實來源。

## 6. 頁面與模組

- **雙頁切換**：國內 / 國際（同一套版面，依 `scope` 過濾）。
- 模組：MapView、EventList（事件卡）、RiskBadge（低/中/高/危急，顏色語意化）、TimelineView（近 7 天）、FilterBar（分類/風險/來源）、SourcePanel。
- 分類：
  - 國內：治安、災防、採購、交通
  - 國際：地緣政治、災害、資安、金融

## 7. 效能

- 純靜態產出，無重型 3D/地圖引擎。
- Leaflet 與圖磚按需載入；JSON 預先生成（不在前端做重運算）。
- 圖片/圖示最小化；CSS 變數集中、無 UI 框架。
- 驗收：build 產物大小合理、Lighthouse 主要指標達標（LCP < 2.5s、CLS < 0.1）。

## 8. 檔案結構

```
爬蟲資料/taiwan-intel-dashboard/
├── index.html
├── package.json                 (vite + typescript + leaflet)
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── main.ts                  (進入點、初始化、頁面切換)
│   ├── store.ts                 (小型發布/訂閱狀態)
│   ├── types/event.ts           (Schema)
│   ├── data/loader.ts           (fetch + 過濾)
│   ├── components/
│   │   ├── MapView.ts
│   │   ├── EventList.ts
│   │   ├── EventCard.ts
│   │   ├── RiskBadge.ts
│   │   ├── TimelineView.ts
│   │   ├── FilterBar.ts
│   │   └── SourcePanel.ts
│   ├── i18n/zh-TW.ts            (介面字串)
│   └── styles/                  (tokens.css + global.css + components)
├── data/
│   ├── domestic.json
│   ├── international.json
│   └── provenance.json          (批次溯源 manifest)
├── scripts/
│   └── fetch-snapshot.md        (抓取來源、查詢、更新方式紀錄)
└── docs/specs/2026-06-15-taiwan-intel-dashboard-design.md
```

## 9. 分階段（每階段可驗證）

1. **腳手架 + schema + 一筆假資料** → 驗證：`npm run dev` 起得來、地圖+卡片渲染一筆、TS 無錯。
2. **抓真實台灣資料快照 + 溯源 manifest** → 驗證：`domestic.json` 有真資料、每筆 `source` 欄位齊全、`provenance.json` 對得上。
3. **國內頁完整**（地圖/卡片/風險/時間軸/篩選/溯源連結） → 驗證：互動正常、過濾正確、來源可點回。
4. **國際頁 + 雙頁切換** → 驗證：切換正常、各頁資料正確。
5. **效能 + 繁中收尾** → 驗證：`npm run build` 產物大小、Lighthouse 指標、介面全繁中。

## 10. 測試

- 單元：`data/loader.ts` 過濾邏輯（scope/分類/風險/時間）、schema 驗證。
- 視覺/互動：開發階段以瀏覽器驗證地圖標記、卡片渲染、篩選、溯源連結。
- 效能：build 後 Lighthouse。

## 11. 風險與緩解

- **twinkle-hub 某些 domain 可能無對應 live URL**：保留 `name`+`fetchedAt`+`query`，不以合成資料偽裝；UI 標示「無原始連結」。
- **座標缺漏**：事件無座標時仍進卡片/時間軸，地圖略過，不阻斷。
- **資料量過大**：快照階段限制每分類筆數（如近 N 天 / top N），並於 manifest 記錄取樣方式（不靜默截斷）。
