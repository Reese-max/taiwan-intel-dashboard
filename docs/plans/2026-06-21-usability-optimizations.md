# 情報網「使用者可用性」優化計畫

- 日期：2026-06-21
- 狀態：待 review（規劃，尚未實作）
- 排序原則：**使用者價值 ÷ 工**（ratio 高者先做）
- 核心判斷：情報網目前「看得到、點不動」。要把它從「漂亮 demo」變成「能查的工具」——
  讓使用者一眼看到頭條（最大群）、點事件能順線追、且知道為什麼相關。
- 共通前提：所有項目**重用引擎已算好的資料**（`network.json` 的 `clusters / edges / why / degree`、
  前端 `NetworkIndex`、`filterEvents(sinceDays)`、`edgeTypeLabel`、classic 既有 focus 邏輯），
  不動抓取層，風險低。

## 兩個介面

- **globe**：`static/intel.html`（production 首頁，vanilla + globe.gl，`globeInstance`、`NET_ARCS`）
- **classic**：`src/main.ts` + components + `src/data/network.ts`（`NetworkIndex`）

---

## 價值÷工 排序總表

| 排序 | # | 項目 | 價值 | 工 | ratio | 介面 |
|---|---|---|---|---|---|---|
| 1 | 2 | 今日最大情報群（排行入口） | 高(4) | S(1) | 4.0 | both |
| 2 | 3 | 顯示「為什麼相關」（why） | 中(3) | S(1) | 3.0 | classic→both |
| 3 | 4 | 列表預設近期/重點 + 自動刷新 | 中(3) | S(1.5) | 2.0 | classic |
| 4 | 1 | 點事件→點亮它的網（核心解鎖） | 高(5) | M(3) | 1.7 | globe(主)＋classic |
| 5 | 8 | 首次使用提示「🔗＝點我看關聯」 | 低(1.5) | S(1) | 1.5 | both |
| 6 | 5 | URL 記住狀態（可分享連結） | 中(3) | M(2.5) | 1.2 | both |
| 7 | 6 | 關鍵字搜尋 → 該主題子網 | 中(3) | M(3) | 1.0 | both |
| 8 | 7 | 手機可用性（responsive） | 中(3) | M(3) | 1.0 | both |

> 註：#1「點了亮網」依 ratio 排第 4，但它是**最高價值的核心互動**，建議排進第一波一起做。

---

## 共享基礎（Phase 0，先做一次給後面省工）

**P0-A 群集加標籤（engine）** — `scripts/lib/correlate.mjs`
- `correlateEvents` 對每個 cluster 補：`topCategory`、`regions`(前2)、`latestTs`、
  `representativeTitle`（群內 degree 最高成員的標題）、`sourceCount`（不同 `source.name` 數）。
- 標題需讀事件物件（引擎已收到完整 events），degree 已算。
- 驗證：新增 1–2 個測試（cluster 帶 label 欄位、representativeTitle 為最高 degree 成員）；
  `npx vitest run` 綠；`node scripts/build-network.mjs` 後 `network.json` 的 cluster 有新欄位。

**P0-B globe 端鄰接表（globe）** — `static/intel.html`
- 目前 globe 只有 `NET_ARCS`（弧線），沒有「id→相連事件」查詢。
- 加 `NET_ADJ = Map<id, [{id,type,weight,why}]>`（從 `network.domestic.edges` 建，含 same-topic）。
- 供 #1、#6 使用。
- 驗證：`window` 上 `NET_ADJ.get(someId)` 回正確鄰居（browser evaluate）。

---

## Phase 1（第一波：最高 CP，全部重用現成資料）

### #2 今日最大情報群（排行入口）　ratio 4.0
- **What**：一塊「最大情報群」榜，列前 N 群（representativeTitle｜類別｜地區｜N 源 M 則｜最新時間），點一群展開該群全部事件。
- **Where**：
  - classic `main.ts`：側欄新增 `#topclusters` 區塊；點群 → 進入「群聚焦」（把 focus 從「單一事件的鄰居」擴成「整個 cluster 成員」）。
  - globe `intel.html`：左側情報流上方加「最大情報群」HUD；點群 → 飛到群質心 + 高亮該群弧線 + 列成員。
- **How**：讀 `network.json` 的 clusters（已含 P0-A label），依 size（或 latestTs 加權）排序。
- **Verify**：榜依大小正確排序；點擊載入的成員數＝cluster.size；classic 與 globe 都可點。
- **工**：S（資料現成）

### #3 顯示「為什麼相關」（why）　ratio 3.0
- **What**：聚焦/關聯清單裡，每則相連事件標出關聯型別與原因（跨源佐證／共享實體「鳳山分局」／同題情勢）。
- **Where**：
  - classic：`EventList`/`EventCard` 在 focus 模式時，依 `NetworkIndex.related(id)` 的 `{type,why}`
    渲染小 chip（`edgeTypeLabel` 已存在於 `network.ts`，重新引用）。
  - globe：點選事件的詳情面板列出鄰居時附型別/原因（弧線 hover 已有 `arcLabel`）。
- **How**：資料已在每條 edge 的 `why`/`type`，純渲染。
- **Verify**：聚焦一群，每張相連卡片顯示正確型別 chip + 原因字串。
- **工**：S

### #4 列表預設近期/重點 + 自動刷新　ratio 2.0
- **What**：classic 列表預設只顯示近 3 天（或前 200 筆依時間/風險），加「全部」切換；每 5 分鐘自動重抓 JSON 更新（與 globe 一致）。
- **Where**：`main.ts`（refresh 預設套 `sinceDays`；`setInterval` 重載 events+network；`FilterBar` 加「時間範圍/全部」）。
- **How**：`filterEvents` 已支援 `sinceDays`；自動刷新清掉 cache 後重跑 refresh。
- **Verify**：預設顯示近期子集、count 變小；切「全部」回到 8336；等待一次 interval 後 count 自動更新、不需重整。
- **工**：S–M

### #1 點事件→點亮它的網（核心解鎖）　ratio 1.7（高價值，排進第一波）
- **What**：點一個事件 → 它的關聯弧線高亮、其餘變暗；同時列出相連事件；點空白/再點還原。
- **Where**：
  - globe `intel.html`（主戰場）：`selectIntel(id)` 時，依 P0-B 的 `NET_ADJ` 標記與該 id 相連的弧線；
    `arcColor`/`arcStroke` 依「是否屬於選中節點」給亮/暗；詳情面板列出鄰居（可再點，鏈式追線）。
  - classic：已有 focus（重用）；可加碼把 Leaflet 地圖上非相連標記變淡。
- **How**：globe 重建/重標 `NET_ARCS`（加 `dim` 旗標），`g.arcsData()` 重設；NET_ADJ 取鄰居。
- **Verify**：browser evaluate — 點某事件後，亮起弧線數＝該事件 degree；點別處還原；鄰居清單正確。
- **工**：M（globe 互動 + 鄰接）

---

## Phase 2（第二波：狀態/搜尋/觸達）

### #8 首次使用提示　ratio 1.5
- **What**：第一次造訪顯示一句話提示「🔗＝點我看關聯／點事件追整張網」，可關閉、`localStorage` 記住。
- **Where**：classic + globe 小 banner。
- **Verify**：首訪顯示、關閉後重整不再出現。
- **工**：S

### #5 URL 記住狀態（可分享）　ratio 1.2
- **What**：把 scope/篩選/聚焦（群或事件 id）寫進 `location.hash`；載入時還原；上一頁可回。
- **Where**：classic `main.ts`、globe `intel.html`（讀寫 hash）。
- **How**：狀態變更 → 更新 hash；`hashchange`/載入時 parse 還原。
- **Verify**：聚焦一群→URL 改變；重整→同畫面；把連結貼到新分頁→同畫面。
- **工**：M

### #6 關鍵字搜尋 → 子網　ratio 1.0
- **What**：搜尋框，輸入關鍵字 → 只顯示標題/摘要命中的事件**及其相連事件**（子網）。
- **Where**：classic `FilterBar`+`main.ts`；globe `intel.html`。
- **How**：命中集合用 `NetworkIndex`/`NET_ADJ` 擴張一層鄰居，列表/弧線只留該子網。
- **Verify**：搜「詐騙」→ 列表/弧線限縮為詐騙相關子網；清空還原。
- **工**：M

---

## Phase 3（第三波：觸達面）

### #7 手機可用性（responsive）　ratio 1.0
- **What**：classic 三欄在窄螢幕堆疊、列表變底部抽屜；globe 控制可觸及、觸控目標夠大。
- **Where**：`src/styles/global.css` media queries；`intel.html` CSS。
- **Verify**：320/375/768 寬無水平溢位、列表可用；Playwright 各斷點截圖。
- **工**：M

---

## 執行建議

- **第一波（建議一次做）**：P0-A、P0-B、#2、#3、#4、#1
  → 完成後「打開看到頭條、點事件追線、知道為什麼相關、列表清爽自動更新」全到位，
  把情報網從 demo 變成可用工具。全部重用現成資料，風險低。
- **第二波**：#8、#5、#6（狀態可分享 + 主動搜尋）
- **第三波**：#7（手機）

## 全域驗收（每波結束）
- `npx vitest run` 全綠、`npx tsc --noEmit` 0 錯、`npm run build` 成功。
- 真實資料 + 瀏覽器端到端：對應互動以 `browser_evaluate` 驗證行為（非只看畫面）。
- 不破壞既有：globe 既有標點/分群/每小時新進卡、classic 既有篩選/地圖/來源面板照常。
