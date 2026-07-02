# 強化與可持續性計畫（Hardening & Sustainability）

- 日期：2026-07-03
- 狀態：待使用者 review
- 背景：2026-07-02 完成「國際新聞風險評斷校準」（5 commits，本地 main，未 push）。
  過程中盤點出的不足彙整為本計畫，按嚴重度分五個工作流（A→E），各項附證據與驗證標準。

## 0. 現況證據（2026-07-02/03 實測）

| 項目 | 實測值 |
|---|---|
| 生產國際風險分布 | high 89.6% / low 0%（250 筆，舊邏輯）|
| 校準後分布（本地 core 樣本）| critical 2.6 / high 21.1 / medium 39.5 / low 36.8 %，audit 健康 |
| `public/data/domestic.json`（本地）| **268MB / 150,046 筆**（無界成長）|
| 線上 `domestic.json` | 10.9MB（Cloudflare Pages 單檔上限 25MB）|
| 線上 `network.json` | 3.2MB |
| CI 已掛 audit | news-source-contribution、network-quality（**無** intl-risk）|
| LLM 全批靜默失敗實例 | core2 重評「正規化 0 筆」且 log 零錯誤（runBatch 雙重 catch 吞錯）|
| 前端測試 | 0（210 個測試全在資料層）|
| 來源漏斗 | 多來源「原始 45~65 則 → 最終貢獻 0~1 則」|

## 1. 目標與非目標

### 目標
- 把已完成的校準價值**兌現到生產**，並建立「故障會被看見」的監控底線。
- 解除 `domestic.json` 撞 Cloudflare 25MB 上限的定時炸彈，改善前端首載。
- 讓 LLM 管線在單點失敗（供應商、單輪全批失敗）時不再無聲退化。

### 非目標
- 不重構前端框架、不換 LLM 供應商（只加 fallback）。
- 不追求測試覆蓋率數字；前端只補關鍵路徑 E2E。
- 不做後端化／資料庫化（維持靜態 JSON 架構）。

## 2. 工作流 A — 校準收尾（P0，最小工作量、最高價值）

### A1 push + 生產全量重評
- push 本地 main（5 commits：d337e18…8b0e9ca）→ 觸發 CI。
- 以 workflow input 開一次 `INTL_RENORM_ALL=true`（沿用既有 input-gated 機制，e22fa6e 已還原的那個開關）讓生產 250 筆換血。
- **驗證**：線上 `data/international.json` 分布通過 `audit:intl-risk`（high ≤50%、low>0）；
  抽 5 筆人工確認評級合理。

### A2 `audit:intl-risk` 掛進 CI
- 在 `update-and-deploy.yml` 的 audit 區段（現有 news-source-contribution / network-quality 旁）加
  `npm run audit:intl-risk`。病態時 CI 標紅（先不擋部署，觀察兩週再決定是否升級為 gate）。
- **驗證**：CI run log 出現稽核輸出；人工塞病態資料時 step 失敗。

### A3 `runBatch` 靜默吞錯改為可見
- `scripts/lib/nvidia.mjs` 的 `runBatch` 雙重 `.catch(() => [])`：保留 graceful（單批失敗不拖垮整體），
  但每次 catch 必 `console.warn`（批次序號、錯誤訊息頭 200 字）；
  `normalizeInternational` 尾端若「輸入 fresh >0 但 llmEvents =0」→ `console.error` 全批失敗警告，
  並寫入 `status.international.normalizeFailed=true` 供 CI/稽核判讀。
- **驗證**：單元測試模擬全批 throw → 有 warn/error 且回傳 []；既有 210 測試不退化。

## 3. 工作流 B — 資料規模瘦身（P1，撞牆前處理）

### B1 `domestic.json` 保留窗 + 分層
- 現況：國內事件只進不出。方案（漸進，先 1 後 2）：
  1. **保留窗**：主檔只留近 N 天（草案 N=30，env 可調 `DOMESTIC_RETENTION_DAYS`），
     超窗事件移入 `domestic-archive-YYYYMM.json`（不部署、只留 repo/工作目錄，或直接丟棄——由使用者決定）。
  2. **前端分層**：首載只抓輕量 `domestic-recent.json`（近 72h），完整檔改為互動時 lazy 載入。
- 風險：`network.json`/關聯分析若吃全量 domestic，保留窗會改變其輸入 → 需先盤 `build-network.mjs` 依賴再定 N。
- **驗證**：線上 domestic.json < 5MB；儀表板 KPI/地圖/時間軸行為不變（E2E，見 D1）；
  Pages 部署體積告警解除。

### B2 `network.json` 同步瘦身
- 隨 B1 輸入變小自然縮；若仍 >2MB，砍長尾（低權重邊）。
- **驗證**：線上 <2MB，RelationGraph 顯示正常。

## 4. 工作流 C — LLM 管線可靠性（P1）

### C1 normalize 加 fallback profile
- 比照 summary 已有的雙 profile 機制：`LLM_FALLBACK_BASE_URL/KEY/MODEL`（未設則行為不變）。
  primary 全批失敗（A3 的 `normalizeFailed`）時整輪改走 fallback 重試一次。
- **驗證**：單元測試 mock primary 全失敗 → fallback 被呼叫；未設 fallback env 時零行為差異。

### C2 舊事件評級生命週期（取代手動全量重評）
- 跨輪快取命中的事件若 `source.fetchedAt` 距今 > `INTL_RECALIBRATE_DAYS`（草案 3 天），
  該輪視為 fresh 重送 LLM（自然攤平重評成本，每輪只多重評一小批）。
- 效果：prompt 變更後 ≤3 天全池自然換血，`INTL_RENORM_ALL` 降級為緊急開關。
- **驗證**：單元測試 partitionByCache 對過期事件回 fresh；成本估算（每輪增量 ≤ 上限）寫入 spec 附錄。

## 5. 工作流 D — 品質盲區（P2）

### D1 前端關鍵路徑 E2E（Playwright，最小集）
- 僅 3 條：①首頁載入 KPI+地圖+事件卡渲染 ②scope 切換 domestic/international ③風險篩選生效。
- 320/1440 兩個寬度截圖存檔（供人工視覺 diff，不上快照比對——避免 flaky）。
- **驗證**：`npm run test:e2e` 本地綠；CI 可選掛（非 gate）。

### D2 來源漏斗診斷
- 寫一次性報告腳本：對「原始→最終」貢獻率 <5% 的來源，拆解損耗在哪層
  （去重？關鍵字過濾？LLM 未選？），輸出 top10 建議（調關鍵字／降 perFeed／移除來源）。
- **驗證**：報告產出；處置由使用者逐來源決定，不自動動來源清單。

### D3 校準微調（依賴 A1 生產數據）
- A1 上線後觀察 ≥3 個排程日的生產分布（audit 記錄）。
  若 low 持續 >30% 或 critical 持續 <3%，微調 prompt few-shot（一次一個變因）。
- **驗證**：生產 audit 連續 3 日健康且 low 回落 15-25 區間（或使用者接受現狀收案）。

## 6. 工作流 E — 工程衛生（P3，順手做）

- E1 root `README.md`：專案定位、7 條資料管線、CI 排程、env 清單、本地跑法、audit 指令。
- E2 清 `_poll*.txt` / `_run-*.txt` 殘留；`.gitignore` 加 `_*.txt` 防再犯。
- E3 `docs/plans`、`docs/specs` 過期文件標註狀態（完成／廢棄）。

## 7. 執行順序與依賴

```
A1 → A2 → A3          （A 內可同 PR；A1 先行以兌現價值）
A1 ─┬→ D3             （D3 需生產數據）
B1 → B2               （B1 需先盤 build-network 依賴）
C1、C2                （獨立，可平行）
D1、D2、E*            （獨立）
```

建議節奏：A 一次做完（半天）→ B1 盤依賴後獨立 PR（1-2 天）→ C/D/E 按需插入。

## 8. 風險與開放問題

| # | 問題 | 待決者 |
|---|---|---|
| 1 | B1 超窗事件是歸檔還是丟棄？歸檔的話存放於 repo 會讓 repo 膨脹 | 使用者 |
| 2 | A2 audit 病態時要不要擋部署（gate）？先觀察兩週 | 使用者 |
| 3 | C2 的 3 天重評窗 × 250 筆 ≈ 每輪多重評 ~80 筆，MiniMax 成本可接受？ | 使用者 |
| 4 | D3 若生產分布與本地 core 樣本差異大，校準策略可能需回爐 | 觀察後定 |
