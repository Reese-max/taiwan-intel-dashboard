# 警政查詢助手（Police Lookup Assistant）— 設計

> 目標：把「散落、查起來慢、但確實公開」的政府開放資料，變成值勤員警當下能快速查、
> 輔助判斷如何處理案件的工具。不是被動情資看板，而是主動查詢工具。
> 產出日期：2026-06-19。狀態：已與使用者確認設計，待 spec review。

## 1. 背景與決策脈絡

現有 `taiwan-intel-dashboard` 為純靜態情資看板（build JSON + HTML，無後端）。使用者回饋：
既有資料（天氣警特報、年度統計、設施點位）「和警察沒什麼相關」，需要的是**輔助警察處理資訊**的工具。

硬限制（已實查確認）：員警值勤核心的即時查詢——車牌車籍、通緝犯、前科、戶役政、M-Police
——皆為法律管制之非公開資料，開放資料拿不到。故本工具聚焦「公開但分散」的查詢能力。

四個候選場景的資料可用性（已實查 twinkle-hub）：

| 模組 | 可用性 | 證據 |
|---|---|---|
| 詐騙查驗 | ✓✓ 現成 | 165 三清單（176455/160055/38262）已在既有 pipeline 抓取 |
| 判決檢索 | ✓✓ 極佳 | `search_judicial`：124 萬筆判決、語意搜尋，回爭點/刑度/關鍵理由/PDF |
| 毒品速查 | ✓ 可行 | `search_drug(name="愷他命")` 回 `controlled_class:"第三級管制藥品"` |
| 法條裁罰 | ✗ 資料弱 | `search_legal_interpretations` 查酒駕回不相關函釋（相似度 0.39）；無乾淨法條+罰則庫 |

架構決策：使用者選擇 **方案 B — 輕量後端 proxy twinkle-hub**，做詐騙＋判決＋毒品三個即時模組。
法條模組因資料弱而延後。

部署前提（已確認）：**本機/個人自用優先**。Node server 跑在本機，沿用正在運行的 twinkle-hub。
日後若部署給實際警局，再回頭處理認證/hosting/法律責任（本次範圍外）。

## 2. 架構

```
server/
  index.mjs          HTTP server：服務 dist/ 靜態檔 + 路由 /api/{fraud,judicial,drug}
  twinkle.mjs        包一層既有 McpClient（scripts/lib/mcp-client.mjs）：
                     fraudLookup() / judicialSearch() / drugLookup()
  handlers/
    fraud.mjs        驗證輸入 → query_rows 三清單 → normalizeFraud → 回應
    judicial.mjs     驗證 → search_judicial → normalizeJudicial → 回應
    drug.mjs         驗證 → search_drug(name) → normalizeDrug → 回應
src/components/query/
  QueryPanel.ts      三分頁容器（詐騙/判決/毒品）
  （各分頁：輸入框 + 結果卡片清單，沿用 src/styles/global.css）
tests/
  query-fraud.test.ts / query-judicial.test.ts / query-drug.test.ts
                     normalize 純函式單測（真實 twinkle 回應 fixture）
```

設計原則：
- **網路/MCP 呼叫隔離在 `server/twinkle.mjs`**；各模組的 `normalize*` 為純函式、可離線單測，
  沿用既有 `scripts/lib/*-mappers` + `tests/*` 的模式。
- 既有基建可直接複用：`McpClient.callTool(name, args)` 為通用 MCP 呼叫，
  `query_rows` / `search_judicial` / `search_drug` 皆可呼叫；`.env` 已有 `TWINKLE_MCP_URL/TOKEN`。
- 後端用 Node 內建 `http`（零新相依，符合專案最小相依風格：目前僅 leaflet runtime dep）。

## 3. 資料流

```
瀏覽器輸入 q
  → fetch(`/api/fraud?q=...`)（或 judicial / drug）
  → handler 驗證 q（非空、長度 ≤ 200）
  → twinkle.mjs：new McpClient(url, token).init().callTool(...)
  → JSON.parse(raw)
  → normalize*(parsed) → 結構化結果
  → res 回 application/json
  → 前端渲染結果卡片 + 免責聲明
```

## 4. 三個模組行為

### 4.1 詐騙查驗（/api/fraud）
- 輸入：網址 / 關鍵字 / 投資平台名 / 賴 ID。
- 查詢：三個 dataset 各一次 `query_rows`，`where = "<關鍵欄位> ILIKE '%q%'"`：
  - `176455` 165 涉詐網站停解析、`160055` 假投資(博弈)網站、`38262` 詐騙闢謠專區。
  - 各 dataset 的關鍵比對欄位於實作時以 `get_dataset` 確認後寫死（如網址/名稱欄）。
- 回應：`{ query, hits: [{list, fields...}], verdict }`。
- 裁決語意：命中 → 列出命中清單與內容；**未命中 → 明確標「未命中不代表安全，僅表示不在此三份清單」**。

### 4.2 判決檢索（/api/judicial）
- 輸入：案情描述 / 罪名（自然語言）。
- 查詢：`search_judicial(query=q, limit=N)`（N 預設 5）。
- 回應每案：`jtitle 罪名 / court / jdate / issue 爭點 / outcome_type 罪責 / sentence 刑度 /
  key_reasoning 關鍵理由 / jpdf 連結 / similarity`。
- 純函式 `normalizeJudicial(parsed)` 取上述欄位、過濾缺漏、截斷過長理由。

### 4.3 毒品速查（/api/drug）
- 輸入：物質名（中/英）。
- 查詢：`search_drug(name=q)`。
- 回應每筆：`name_zh / name_en / controlled_class 管制級別 / indication 用途 / dosage_form`。
- **誠實警語（固定附帶）**：此為衛福部管制藥品**許可**庫，查無≠非毒品；純街頭毒品
  （如海洛因、甲基安非他命）可能不在許可庫，需另查《毒品危害防制條例》附表分級。

## 5. 錯誤處理與把關

- 輸入驗證：q 非空、長度 ≤ 200、trim；不合則回 400 JSON `{error}`。
- twinkle 失敗：回 502 JSON `{error: "查詢服務暫時無法使用"}`，**不洩漏 stack/密鑰**；
  server 端 console 記錄詳細錯誤。
- 限流：`McpClient` 既有 429/5xx 指數退避重試直接受用。
- 每個結果面板固定顯示**免責聲明**：「資料來源：政府開放資料，僅供參考，
  非正式法律意見/鑑識結論，以官方公告為準。」
- 密鑰僅存在於 server（讀 `.env`），絕不進前端 bundle。

## 6. 測試

- 三個 `normalize*` 純函式以真實 twinkle 回應 fixture 單測（命中/未命中/缺漏欄位/空結果）。
- 輸入驗證函式單測（空字串、超長、正常）。
- 沿用 vitest；維持既有 80% 覆蓋目標於新模組。
- live API smoke test 為手動（啟動 server 後 curl 三端點），不納入自動套件（避免測試依賴網路）。

## 7. 執行與建置

- 新增 npm script：`"serve": "node --env-file=.env server/index.mjs"`。
- server 監聽 `127.0.0.1`，port 取 `process.env.LOOKUP_PORT`，預設 `8088`
  （避開既有 `preview` 的 `police-control-server.mjs`）。
- 前端仍由既有 `vite build` 產 `dist/`；server 啟動時服務 `dist/` + `/api`。
- 開發：`npm run build` 後 `npm run serve`，瀏覽 `http://127.0.0.1:8088/`。

## 8. 刻意延後（YAGNI / 誠實標註）

- 法條裁罰模組：資料弱，無乾淨法條+罰則庫，本次不做。
- 部署強化：認證、HTTPS、多使用者、rate limiting——本機自用不需要。
- 毒品庫對非許可街頭毒品的涵蓋缺口：以警語誠實標註，不假裝完整。
- 判決全文：僅回摘要欄位 + PDF 連結，不在前端內嵌全文（量太大）。

## 9. 成功標準

- 三端點各能以一個真實查詢回傳結構化、正確、附來源與免責的結果。
- normalize 純函式測試綠、`tsc --noEmit` 綠、`npm run build` 綠。
- 啟動 server 後三模組前端可實際操作並顯示結果。

## 10. 實作結果（2026-06-19，已完成並驗證）

新增檔案：
- `server/normalize.mjs`：純函式層（`validateQuery` / `sqlEscape` / `normalizeFraud` /
  `normalizeJudicial` / `normalizeDrug`）。
- `server/twinkle.mjs`：網路層，複用既有 `McpClient` 呼叫 `query_rows` / `search_judicial` /
  `search_drug`。
- `server/index.mjs`：Node 內建 `http` server，服務 `dist/` + `/api/{fraud,judicial,drug}`，
  127.0.0.1:8088，含目錄穿越防護與 400/502 錯誤處理（不洩漏 stack/密鑰）。
- `src/query.ts` + `src/styles/query.css`：獨立查詢頁（三分頁 UI），不動既有 dashboard。
- `tests/lookup-normalize.test.ts`：12 個純函式測試。

修改：
- `scripts/build-static.mjs`：esbuild 多入口（加 `src/query.ts`）+ 產出 `query.html`。
- `package.json`：新增 `"serve": "node --env-file=.env server/index.mjs"`。

實查確認的資料細節：
- 詐騙比對欄位：176455=`網域`、160055=`WEBURL`/`WEBSITE_NM`（資料含雜散表頭列，已濾）、
  38262=`標題`/`發佈內容`。
- 毒品警語屬實：`search_drug("海洛因")` 回 0 筆（純毒品不在許可庫），`愷他命` 才命中
  （第三級管制藥品）——故固定附「查無≠非毒品」警語。

驗證：
- `npm test` 48/48 綠（新增 12）· `tsc --noEmit` exit 0 · `npm run build` exit 0
  （產出 query.js 5.3KB / query.css 3.3KB / query.html）。
- 啟動 server 後實打 HTTP 端點：`/query.html` 200；`/api/fraud?q=saxotader` 命中 5 筆；
  `/api/drug?q=愷他命` 第三級管制藥品；`/api/judicial?q=假投資詐欺` 回 5 案；
  `/api/fraud?q=`（空）回 400。
- Playwright 實際渲染詐騙查驗頁並截圖確認（紅色命中橫幅 + 5 張結果卡）。

過程踩雷：Write 工具寫入「含控制字元範圍的 regex 字面值」（如 `/[\x00-\x1f]/`）會在檔案
產生真正的 NUL byte → 破壞解析。改用 `charCodeAt(0) >= 32` 過濾，避免控制字元 regex 字面值。

## 11. 第四模組：通用開放資料查詢（2026-06-19 追加，已完成並驗證）

決策脈絡：使用者問「全接會不會太多」。結論——「全接成看板」會爆且無意義（每源需手刻
fetcher，多為靜態/週期統計、99% 與警政無關）；「全接成查詢」則因 twinkle-hub 已索引全部
53,000+ 資料集，只需**一條通用查詢路徑**即涵蓋全部，零 per-dataset 程式碼。故追加此模組。

實作（沿用既有四層）：
- `server/normalize.mjs`：新增 `validateDatasetId`（僅允許 `[A-Za-z0-9_-]`，擋注入）、
  `normalizeCatalog`（search_datasets → 資料集卡片）、`normalizeDatasetPreview`（query_rows →
  欄位 + 截斷前 50 列 + 真實總列數）。
- `server/twinkle.mjs`：`catalogSearch`（search_datasets）、`datasetPreview`（query_rows，
  **不接受使用者 WHERE**，僅拉前 50 列，避免任意 SQL）。
- `server/index.mjs`：`/api/catalog?q=`（主題搜尋）、`/api/dataset?id=`（id 驗證後預覽）。
- `src/query.ts`：新增「開放資料」分頁——輸入主題 → 資料集卡片 → 點「預覽前 50 列」下鑽成表格。
- `tests/lookup-catalog.test.ts`：6 個純函式測試（id 驗證含注入用例、catalog 映射、預覽截斷）。

驗證：`npm test` 54/54 綠（新增 6）· `tsc --noEmit` exit 0 · `npm run build` exit 0。
實打：`/api/catalog?q=空氣品質` 回 20 個資料集；`/api/dataset?id=28202` 回 8 欄 50 列；
非法 id `a';DROP` 回 400。Playwright 截圖確認分頁、清單、預覽表格渲染。

效果：這一個模組讓全台 5 萬+ 政府開放資料集全部「要用才查」，不佔看板、無雜訊、近乎零維護。

## 12. 後續可選項（未做）

- 法條裁罰模組（資料弱，待找到乾淨法條+罰則庫）。
- 把查詢入口連進主 dashboard 導覽（目前為獨立 `/query.html`）。
- 毒品查詢補《毒品危害防制條例》附表分級對照（補純毒品涵蓋缺口）。
- 通用查詢的進階篩選（安全的欄位級 WHERE 建構，目前僅前 50 列預覽）。
- 把高頻好用的通用查詢結果升級成精修模組（如停車場即時車位、空品 AQI）。
- 部署給實際警局所需的認證/HTTPS/稽核（本機自用本次不做）。
