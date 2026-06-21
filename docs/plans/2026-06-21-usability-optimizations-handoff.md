# 情報網「使用者可用性」優化 — 完整計畫書（交接給 Codex）

- 日期：2026-06-21
- 文件性質：**自帶上下文、可獨立執行的實作計畫書**。執行者（Codex）不需額外口頭背景。
- 任務：在「已完成的情報網基礎」上，做 8 項使用者可用性優化（依價值÷工排序）。
- 語言：所有使用者可見文字一律**繁體中文（zh-TW）**；程式識別字、檔名保持原文。

---

## 0. 給執行者的話（先讀）

這個專案已經有一套運作中的「情報網」：把新聞事件依關聯（同案佐證／共享實體／同題）串成圖，
產出 `network.json`，並在兩個前端介面呈現。**你的工作是讓它更好用，不是重做。**

開工前務必：
1. 讀第 1、2、3 節（架構／現況／限制），建立對 codebase 的正確認知。
2. 按第 4 節由上而下（價值÷工高者先）實作；每項都有「改哪些檔／實作規格／驗收」。
3. 嚴守第 3 節的慣例與限制（最容易踩雷之處）。
4. 每完成一波，跑第 5 節的全域驗收。

---

## 1. 專案背景與架構

### 1.1 是什麼
`taiwan-intel-dashboard`：聚焦台灣的輕量情報儀表板。抓 ~90 條新聞 RSS ＋ 政府開放資料
（警政、判決、天氣、採購），正規化成統一 schema 的事件，前端讀靜態 JSON 呈現。重「可溯源」。

### 1.2 技術棧
- 建置：Vite + **Vanilla TypeScript（無框架）**；測試 Vitest。
- 地圖：classic 用 Leaflet；globe 用 globe.gl（**CDN 載入**，非 npm 依賴）。
- 唯一 runtime npm 依賴：`leaflet`。抓取腳本為 zero-dep Node ESM（`.mjs`）。

### 1.3 兩個前端介面（重要）
| 介面 | 進入點 | 說明 |
|---|---|---|
| **classic 儀表板** | `src/main.ts`（dev 首頁；prod 為 `classic.html`） | Leaflet 地圖＋事件列表＋時間軸＋篩選＋來源＋AI 摘要 |
| **globe 情報中心** | `static/intel.html`（**prod 首頁** `dist/index.html`） | 電影感 globe.gl，標點/分群/弧線＋右側情報流＋詳情面板 |

> 注意：`npm run dev` 服務的首頁是 **classic**（`index.html` 載 `src/main.ts`）。
> `npm run build` 後 `dist/index.html` 是 **globe**（由 `static/intel.html` 複製），classic 變 `classic.html`。

### 1.4 資料流與位置
```
抓取(scripts/fetch-live.mjs) → public/data/*.json ──(build-static 複製)──> dist/data/*.json
                                      │
              前端 fetch('./data/xxx.json')（dev 服務 public/，prod 服務 dist/）
```
- `public/data/`：**實際服務的真實資料**（domestic.json ~8000+ 筆、network.json…）。
- `data/`（專案根）：15 筆策展種子，**非**服務用。
- `dist/data/`：build 後的部署副本。
- **要測試前端，先確保 `public/data/network.json` 是最新**：跑 `npm run build:network`。

### 1.5 指令速查
```bash
npm run dev            # 啟 Vite dev（首頁=classic，讀 public/data）
npm run build          # tsc --noEmit && build-network && build-static → dist/
npm run build:network  # 只重算 public/data + dist/data 的 network.json
npm test               # = vitest run
npx tsc --noEmit       # 型別檢查（strict）
npx vite preview --port 5174   # 服務 dist/（首頁=globe）以測 intel.html
```
測 classic：`npm run dev` 開 localhost:5173。
測 globe：`npm run build` 後 `npx vite preview` 開 localhost:4173/5174（dist/index.html）。

---

## 2. 已完成的基礎（情報網現況，build on this）

### 2.1 關聯引擎 `scripts/lib/correlate.mjs`（純函式、零依賴）
匯出：
- `extractSignals(event)` → `{ id, region, category, scope, t, keywords:Set, entities:Set, bigrams:Set, sourceName, sourceType }`
- `correlateEvents(events, opts?)` → **回傳整張網**（見 2.2 結構）
- `relatedIds(network, id, limit=20)` → `[{ id, type, weight, why }]`（依 weight 降冪）
- `isNewsLikeEvent(e)` → `e.source.type==='news-rss' || e.source.datasetId==='tw-news'`

三種關聯邊（edge.type）：
- `same-incident`（跨源佐證；同地+案類/用詞重疊+時間相近+不同來源；全國無座標者需更強證據）
- `same-entity`（跨地共享具名實體：分局/地檢署/法院/路名/車站/園區…）
- `same-topic`（同縣市同類同關鍵詞、時序相近；非地理性「全國」不連）

設計決定（勿回退）：情報網**只含新聞事件**（`isNewsLikeEvent`），排除政府模板化統計資料
（竊盜點位、路口錄監…）以免標題雷同把網黏成毛球。

### 2.2 `network.json` 結構（前端契約）
```jsonc
{
  "generatedAt": "ISO",
  "scopeNote": "…",
  "domestic": {
    "nodes":   [{ "id","region","category","riskLevel","scope","degree" }],
    "edges":   [{ "a","b","type","weight","why" }],          // 無向；a<b 去重
    "clusters":[{ "id":"c0","members":["id1","id2",…],"size":N }],  // 連通分量，size≥2
    "stats":   { "events","edges","byType":{…},"clusters","largestCluster","skippedGenericEntities" }
  },
  "international": { …同上… },
  "excluded": { "domestic":N,"international":N }   // 被排除的非新聞事件數
}
```
> 注意：目前 `clusters[]` **只有** `{id,members,size}`，**沒有**代表標題等 label——這是 P0-A 要補的。

### 2.3 產出與排程
- `scripts/build-network.mjs`：讀 `public/data/domestic.json`+`international.json` → 寫 `network.json`（public+dist）。`npm run build:network`。
- `scripts/fetch-live.mjs`：每次 live 抓取後自動重算並 `writeJson('network.json', …)`（純加法）。
- `scripts/daily-refresh-loop.cmd`（**純 ASCII**）+ Startup 捷徑 `TaiwanIntelDailyRefresh.lnk`：每日重抓新聞→情報網每天自動更新（已驗證）。

### 2.4 classic 前端（已建情報網 UI）
- `src/data/network.ts`：
  - `class NetworkIndex`：`related(id) → RelatedRef[]`、`count(id) → number`（已依 weight 排序）。
  - `loadNetwork(scope) → Promise<NetworkIndex>`（fetch `./data/network.json`，404 容錯回空索引）。
  - `edgeTypeLabel(type) → '跨源佐證'|'共享實體'|'同題情勢'`。
  - 型別：`EdgeType / NetEdge / ScopeNetwork / IntelNetwork / RelatedRef`。
- `src/components/EventCard.ts`：`eventCard(e, relatedCount=0)` → 有相連時渲染
  `<button class="rel-link" data-rel="{id}">🔗 關聯 N</button>`（在卡片 header 右側）。
- `src/components/EventList.ts`：`renderEventList(container, events, opts?)`，
  `opts.relatedCount?: (id)=>number`。
- `src/main.ts`：聚焦機制——
  - 模組變數 `focusId: string|null`；`netCache[scope]: NetworkIndex`。
  - `refresh()`：focus 時只顯示「該事件 + 其相連事件」（依 weight 排序，中心置頂）；否則 `filterEvents`。
  - `#focusbar`：聚焦橫幅（標題＋N 則相連＋「✕ 返回全部」`#clear-focus`）。
  - `#eventlist` 上事件委派：點 `.rel-link` → 設 `focusId` → `refresh()`。
- 樣式：`src/styles/global.css` 末段有 `.rel-link/.focusbar/.clear-focus`（暗色作戰室主題，token 見 `tokens.css`）。

### 2.5 globe 前端 `static/intel.html`（已建情報網弧線）
- 全域：`window.globeInstance`、`NET_ARCS[]`、`netStats`、`ARC_COLOR`、`ARC_TYPE_LABEL`、`ALL[]`（map 後事件）、`currentFilter`。
- `buildNetworkArcs(net)`：把 `network.domestic.edges`（排除 same-topic）兩端有座標者轉成弧線
  `{startLat,startLng,endLat,endLng,type,weight}`，依 weight 取前 `NET_ARC_MAX(600)`；
  含 `hashJit(seed,span)` 穩定 jitter（同縣市事件散開）。
- `updateGlobe()`：`g.arcsData(NET_ARCS)` ＋ `updateNetLegend()`（左下圖例）。
- `initGlobe()`：弧線 accessor 已是 per-arc 起訖（`arcStartLat(d=>d.startLat)`…），`arcColor` 依型別，`arcLabel` hover 顯示型別+強度。
- 既有互動：`selectIntel(id)`（~L378，顯示 `#detail-panel`）、`focusCity(c)`（判決城市分群）、`renderListData(data)`（~L344 渲染右側 `#intel-list`）、`renderList(filter)`、`updateStats(hourly)`。
- 關鍵 DOM id：`#intel-list`（情報流）、`#list-count`、`#detail-panel`、`.left-panel`（左上 HUD）、`.side-panel`（右側）。
- `loadData()`：`grab('./data/network.json')` 已載入，呼叫 `buildNetworkArcs(network.domestic)`；每 5 分鐘自動重抓。

### 2.6 測試
`tests/correlate.test.ts`（12 測試，引擎行為）。`npx vitest run` 目前全綠（共 78）。

---

## 3. 慣例與限制（務必遵守，最易踩雷）

1. **繁體中文** 所有 UI 文字；勿用簡體。
2. **零框架 vanilla TS**；勿引入 React/Vue 等。globe 既有 globe.gl 走 CDN。
3. **盡量零新依賴**。若某項（如 force-graph）確需新 lib，先在該項標注並走 CDN（與 globe.gl 同模式），勿擅自加進 `package.json` runtime deps；不確定就先不加、留 TODO 問 owner。
4. **tsc strict**：`noUnusedLocals`/`noUnusedParameters` 開啟——勿留未使用 import/變數。`tests/` 不被 tsc include。
5. **不可變 / surgical**：只動與本任務相關的行，勿順手重構無關程式或改既有風格。
6. **不動抓取層語意**：correlate 引擎的關聯邏輯與 `isNewsLikeEvent` 範圍維持不變（除非該項明指要改 engine，如 P0-A 只是「加欄位」不改既有判定）。
7. **`.cmd`/`.bat` 必須純 ASCII**（cmd 以 cp950 解析，非 ASCII 會毀行）。
8. **兩個介面都要顧**：標注「both」的項目，classic 與 globe 都要做；資料契約共用 `network.json`。
9. 改完 `correlate.mjs` 或 `network.json` 結構 → **同步更新/新增測試**，並重跑 `build:network` 讓前端有新資料。
10. **驗收要看行為不只看畫面**：用無頭瀏覽器 evaluate 斷言（如「亮起弧線數＝該事件 degree」），不要只截圖。

---

## 4. 待辦：8 項優化（依價值÷工排序）

### 排序總表
| 序 | # | 項目 | 介面 | 工 | ratio |
|---|---|---|---|---|---|
| 1 | 2 | 今日最大情報群（排行入口） | both | S | 4.0 |
| 2 | 3 | 顯示「為什麼相關」 | classic→both | S | 3.0 |
| 3 | 4 | 列表預設近期/重點 + 自動刷新 | classic | S | 2.0 |
| 4 | 1 | 點事件→點亮它的網（核心） | globe(主)+classic | M | 1.7 |
| 5 | 8 | 首次提示「🔗 可點」 | both | S | 1.5 |
| 6 | 5 | URL 記住狀態（可分享） | both | M | 1.2 |
| 7 | 6 | 關鍵字搜尋→子網 | both | M | 1.0 |
| 8 | 7 | 手機可用性 | both | M | 1.0 |

---

### Phase 0 — 共享基礎（先做，後面省工）

#### P0-A 群集加標籤（engine）
- **檔**：`scripts/lib/correlate.mjs`、`tests/correlate.test.ts`
- **規格**：`correlateEvents` 對每個 cluster 物件補欄位（用引擎已收到的 event 物件與已算的 degree）：
  - `representativeTitle`：群內 degree 最高成員的 `title`（平手取最新 timestamp）。
  - `topCategory`：群內最多數的 `category`。
  - `regions`：出現最多的前 2 個 `region`。
  - `latestTs`：群內最新 `timestamp`（ISO）。
  - `sourceCount`：群內不同 `source.name` 數。
  - 保留既有 `id/members/size`。
- **驗收**：新增測試（cluster 帶上述欄位、`representativeTitle` 為最高 degree 成員）；
  `npx vitest run` 綠；`npm run build:network` 後 `node -e "console.log(require('./public/data/network.json').domestic.clusters[0])"` 可見新欄位。

#### P0-B globe 端鄰接表（globe）
- **檔**：`static/intel.html`
- **規格**：`loadData()` 內，由 `network.domestic.edges` 建 `NET_ADJ = new Map()`：
  `id → [{ id, type, weight, why }]`（雙向、依 weight 降冪、**含 same-topic**，與弧線不同）。
  供 #1、#7 查鄰居用。
- **驗收**：browser evaluate `window` 取得某 id 鄰居正確（注意若為區域變數，臨時掛 `window.NET_ADJ` 以便驗證或用 console 驗）。

---

### Phase 1（第一波）

#### #2 今日最大情報群（排行入口）　ratio 4.0
- **What**：列前 N（建議 8）大情報群：`representativeTitle｜topCategory｜regions｜sourceCount 源·size 則｜latestTs`；點一群 → 展開該群全部成員。
- **Where**：
  - classic `src/main.ts`：右側 `aside.col-side` 新增 `#topclusters` 區塊（新元件 `src/components/TopClusters.ts`，依現有元件風格）。點群 → **群聚焦**：把 `focusId` 機制擴成可吃 cluster（新增 `focusCluster: string|null`，`refresh()` 顯示該 cluster `members` 對應事件）。
  - globe `static/intel.html`：`.left-panel` 或 `.side-panel` 加「最大情報群」清單；點群 → `pointOfView` 飛到群質心（成員座標平均）＋ 只亮該群弧線（接 #1 機制）＋ `renderListData(成員)`。
- **資料**：`network.domestic.clusters`（P0-A 後含 label），依 `size`（或 `latestTs` 加權）排序。
- **Verify**：榜排序正確；點群載入成員數＝`cluster.size`；classic、globe 皆可點；`tsc`/`vitest`/`build` 綠。
- **工**：S

#### #3 顯示「為什麼相關」　ratio 3.0
- **What**：聚焦/關聯清單每則相連事件標出型別＋原因 chip（如「跨源佐證」「共享實體：鳳山分局」「同題情勢」）。
- **Where**：
  - classic：focus 模式下，`main.ts` 把當前中心的 `NetworkIndex.related(centerId)` 轉成 `Map<id,{type,why}>`，傳進列表渲染；`EventCard`/`EventList` 接受可選 `relationOf?:(id)=>{type,why}|undefined`，於卡片 header 顯示 chip（`edgeTypeLabel` 已可用）。
  - globe：`selectIntel(id)` 的 `#detail-panel` 內，列出該事件鄰居（`NET_ADJ.get(id)`）及型別/原因。
- **資料**：edge 已有 `type`/`why`，純渲染。
- **Verify**：聚焦一群，逐張相連卡片顯示正確型別 chip＋`why` 字串；globe 詳情面板列鄰居。
- **工**：S

#### #4 列表預設近期/重點 + 自動刷新　ratio 2.0
- **What**：classic 列表預設只顯示近 3 天（或前 200 筆依時間/風險），加「全部」切換；每 5 分鐘自動重抓 JSON 更新（與 globe 一致）。
- **Where**：`src/main.ts`（refresh 預設套 `sinceDays`；`setInterval` 清 cache 後重載 events+network 再 refresh）；`src/components/FilterBar.ts` 加「時間範圍 / 全部」控制。
- **資料**：`filterEvents` 已支援 `sinceDays`（`src/data/loader.ts`）。
- **Verify**：預設 count 變小且為近期；切「全部」回到完整；等一個 interval count 自動更新、不需重整；非 focus 模式才套預設範圍。
- **工**：S–M

#### #1 點事件→點亮它的網（核心解鎖）　ratio 1.7（價值最高，排第一波）
- **What**：點一個事件 → 它的關聯弧線高亮、其餘變暗；同時列出相連事件；點空白/再點還原。鏈式可再點鄰居續追。
- **Where**：
  - globe `static/intel.html`（主）：`selectIntel(id)` 時，依 `NET_ADJ`（P0-B）標記與該 id 相連的弧線。
    作法：`NET_ARCS` 每條加 `srcId/dstId`（在 `buildNetworkArcs` 補上原始 `e.a/e.b`），
    新增 `highlightArcsFor(id)`：設模組變數 `focusArcId`，`arcColor`/`arcStroke`/`arcAltitudeAutoScale`
    依「該弧是否含 focusArcId」給亮/暗（不含時用低 alpha）；`g.arcsData([...NET_ARCS])` 觸發重繪。
    `#detail-panel` 同步列鄰居（可點 → 再 `selectIntel`）。關閉詳情 → `focusArcId=null` 還原。
  - classic：已有 focus（重用）；加碼把 Leaflet 非相連標記變淡（`MapView` 接受 highlight 集合，選做）。
- **Verify**：browser evaluate——點某事件後，亮起（非 dim）的弧線數＝該事件在 NET_ADJ 的（有座標）鄰居數；點別處/關閉還原；鄰居清單正確。
- **工**：M

---

### Phase 2（第二波）

#### #8 首次使用提示　ratio 1.5
- **What**：首訪顯示一句「🔗＝點我看關聯；點事件可追整張情報網」，可關閉，`localStorage` 記住不再顯示。
- **Where**：classic（`main.ts` 注入小 banner）＋ globe（`intel.html`）。
- **Verify**：首訪顯示；關閉後重整不再出現（localStorage key 存在）。
- **工**：S

#### #5 URL 記住狀態（可分享）　ratio 1.2
- **What**：scope/篩選/聚焦（cluster 或 event id）寫進 `location.hash`；載入時還原；瀏覽器上一頁可回。
- **Where**：classic `main.ts`、globe `intel.html`。
- **How**：狀態變更 → 更新 hash（如 `#scope=domestic&focus=twnews-xxx`）；`load`/`hashchange` 解析還原。
- **Verify**：聚焦一群→URL 改變；重整→同畫面；連結貼新分頁→同畫面還原。
- **工**：M

#### #6 關鍵字搜尋 → 子網　ratio 1.0
- **What**：搜尋框；輸入關鍵字 → 只顯示標題/摘要命中的事件**及其相連事件**（子網）。
- **Where**：classic `FilterBar`+`main.ts`；globe `intel.html`。
- **How**：命中集合用 `NetworkIndex`/`NET_ADJ` 擴張一層鄰居；列表只留子網，globe 只亮子網弧線。
- **Verify**：搜「詐騙」→ 列表/弧線限縮為相關子網；清空還原。
- **工**：M

---

### Phase 3（第三波）

#### #7 手機可用性（responsive）　ratio 1.0
- **What**：classic 三欄在窄螢幕堆疊、列表可變底部抽屜；globe 控制可觸及、觸控目標夠大、側面板可收。
- **Where**：`src/styles/global.css` media queries；`static/intel.html` 內嵌 CSS。
- **Verify**：320/375/768/1024 寬無水平溢位、列表/詳情可用；Playwright 各斷點截圖佐證。
- **工**：M

---

## 5. 全域驗收（每波結束都要過）

1. `npx vitest run` 全綠（含為 engine 變更新增的測試）。
2. `npx tsc --noEmit` 0 錯。
3. `npm run build` 成功（含 build-network、build-static）。
4. **行為驗收（非只截圖）**：用無頭瀏覽器對該波互動做 evaluate 斷言。
   - 測 classic：`npm run dev`（5173）。
   - 測 globe：`npm run build` → `npx vite preview`（4173/5174）。
   - 測前先 `npm run build:network` 確保 `public/data/network.json` 最新。
5. **不破壞既有**：globe 標點/分群/每小時新進卡、classic 既有篩選/地圖/來源/AI 摘要照常。
6. 收尾自檢：無未使用 import（tsc 會擋）；無簡體字；`.cmd` 純 ASCII（若有改動）。

---

## 6. 附錄：關鍵檔案清單

| 檔 | 角色 |
|---|---|
| `scripts/lib/correlate.mjs` | 關聯引擎（P0-A 改這裡） |
| `scripts/build-network.mjs` | 產出 network.json |
| `scripts/fetch-live.mjs` | 抓取＋整合情報網（勿動關聯語意） |
| `public/data/network.json` | 前端契約資料（跑 build:network 重生） |
| `src/data/network.ts` | classic：NetworkIndex / loadNetwork / edgeTypeLabel |
| `src/main.ts` | classic：聚焦/refresh/列表協調（#2/#3/#4/#5/#6 主場） |
| `src/components/EventCard.ts`, `EventList.ts`, `FilterBar.ts` | classic 元件 |
| `src/styles/global.css`, `tokens.css` | classic 樣式（#7） |
| `static/intel.html` | globe：globeInstance/NET_ARCS/selectIntel/renderListData（P0-B/#1/#2 主場） |
| `tests/correlate.test.ts` | 引擎測試（engine 變更要補） |

執行順序建議：P0-A → P0-B →（#2、#3、#4、#1）→（#8、#5、#6）→ #7。
每完成一項即跑第 5 節驗收，綠了再下一項。
