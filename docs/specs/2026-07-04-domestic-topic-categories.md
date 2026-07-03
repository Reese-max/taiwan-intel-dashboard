# 國內新主題分類（食安/衛生/環境/資安）＋ EN 來源支援

- 日期：2026-07-04
- 狀態：已核准，待實作
- 背景：2026-07-03 來源漏斗診斷（`docs/reports/2026-07-03-news-source-funnel-diagnosis.md`）
  找出 9 個「原始→最終貢獻趨近 0」的來源。使用者裁定：
  7 個中文主題錯配來源給獨立分類（四分類全拆）；2 個 EN 來源補英文警政關鍵字。
  另：彰化縣警局/刑事局高去重率已抽驗 recordRef（同輪零重複、跨次 link 100% 穩定），
  判定為 GN `when:5d` 視窗跨輪去重的正常行為，非 bug，收案。

## 1. 目標與非目標

### 目標
- 9 個近零貢獻來源產生實際貢獻：中文主題來源走各自主題漏斗入獨立分類；EN 來源過警政漏斗。
- 既有來源（hint 治安/反詐/災防）行為零改變。

### 非目標
- 不新增資料檔、不動 CI、不改前端版面（分類篩選僅加選項）。
- 不處理 EN 與中文報同一事件的跨語言去重（使用者已接受重複風險）。
- 不動來源 URL、不增刪來源。

## 2. 設計

### 2.1 資料層 `scripts/lib/news-bulk.mjs`（核心）

- 新增 per-hint 主題關鍵字表 `TOPIC_RE`：
  | hint | 關鍵字方向 |
  |---|---|
  | 食安 | 黑心、餿水油、病死豬、瘦肉精、農藥殘留、標示不實、逾期、下架、回收、查獲、違規 |
  | 衛生 | 疫情、群聚、確診、疫苗、傳染、食物中毒、院內感染 |
  | 環境 | 污染、廢水、偷排、裁罰、稽查、廢棄物、棄置、排放、空污、盜採、濫墾 |
  | 資安 | 資安、駭客、個資、外洩、漏洞、勒索病毒、釣魚、盜刷 |
- 相關性判定改為 hint 分派：`feed.hint ∈ TOPIC_RE` → 用該主題正則；否則照舊 `POLICE_RE`。
  `fetch-live.mjs` 的預篩與 `mapBulkNews` 內部檢查兩處必須用同一判定函式（單一出口）。
- `POLICE_RE` 補英文警政詞（police/arrest/fraud/scam/drug/murder/smuggl/prosecut/indict…，case-insensitive）。
- `riskFromTitle` HIGH/MED 補英文詞（murder/killed/dead → high；fraud/arrest/drug/theft → medium），
  否則 EN 事件全判 low。
- `HINT_TO_CAT` 補 食安/衛生/環境/資安 四映射；現行 `資安→治安` 硬映射改為 `資安→資安`。

### 2.2 Feed 清單 `scripts/lib/fetch-rss.mjs`（只改 hint）

| 來源 | hint 變更 |
|---|---|
| GN 食安黑心、農業部官網、食藥署官網 | → `食安` |
| 疾管署官網 | → `衛生` |
| GN 環境污染偷排、環境部官網 | → `環境` |
| TechNews / INSIDE / GN TechNews 資安 | 已是 `資安`，不動 |
| Focus Taiwan (EN)、Taipei Times (EN) | 維持 `治安`（靠 EN 關鍵字） |

### 2.3 LLM 層 `scripts/lib/nvidia.mjs`

`TW_CATEGORIES` 由 `[治安, 社會, 交通, 災防, 反詐]` 擴為加上 `食安, 衛生, 環境, 資安` 共 9 個
（新主題 item 會進 LLM 精修佇列，不擴會被 `clampTwCat` 打回「社會」）。
附帶效應：每輪 LLM 精修多 ~50-80 則，成本小幅上升，可接受。

### 2.4 前端 `src/components/FilterBar.ts`

`CATS.domestic` 加 `食安, 衛生, 環境, 資安`（category 純文字顯示、無顏色/圖示綁定）。

## 3. 相容性確認（已盤查）

- carry-over：`isPoliceDomesticEvent` 靠 datasetId/id 前綴判斷，不吃分類清單，新分類無影響。
- tw-news 保留窗 union 依 `datasetId === "tw-news"` 切分，與分類無關。
- 來源貢獻報表（provenance）依 feed label 統計，無需改動。

## 4. 已知取捨

- EN 與中文報同一事件會重複（標題去重跨語言對不上）——使用者已接受。
- `categoryFromItem` 標題規則先於 hint fallback：TechNews 詐騙報導歸「反詐」而非「資安」——語意合理，不處理。
- 疾管署每輪 ~7 則，「衛生」分類偏空——使用者選四分類全拆時已知。

## 5. 測試與驗證

- 單元測試（先寫）：`TOPIC_RE` 各 hint 通過/拒絕案例；EN 標題過 `POLICE_RE`；EN 風險評級；
  未列 `TOPIC_RE` 的 hint（治安/反詐/災防）行為不變（回歸保護）。
- 既有 210 測試不退化。
- 端到端驗證：跑 `--sources=twnews` 一輪，來源貢獻報表中 9 個來源最終貢獻 > 0；
  新分類事件出現在 `domestic.json`；前端分類篩選可選到新分類且結果正確。
