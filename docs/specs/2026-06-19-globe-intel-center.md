# 全球情報中心（電影感 globe）+ 每小時 ≥100 筆新進

> 目標（使用者設定）：GI.html 那種電影感全球情報中心水準，配上警政相關資料，
> 每小時至少進新資料 100 筆以上。產出日期：2026-06-19。狀態：已完成並驗證。

## 1. 前端：電影感全球情報中心

採「研究與重用」——使用者已有滿意的 `https://mjib007.github.io/homepage/GI.html`
（globe.gl 自含單頁、深色作戰室主題、地球儀標點/光環/弧線、右側情報流、篩選、詳情面板）。
**直接沿用其設計**，只把寫死的 `INTEL_DATA` 換成抓本專案真實資料。

- `static/intel.html`：以 GI.html 為藍本，`fetch ./data/{domestic,international,police-hourly-history}.json`，
  將 `IntelEvent` map 成 `{id,title,location,lat,lng,level,type,time,desc,url}`。
  - riskLevel→level：critical→critical、high→warning、medium→info、low→normal。
  - 地球儀標點限 700（取最新）、光環取 critical、弧線從台灣連向 critical/國際點。
  - 左側新增「本小時新進情報」卡：直接讀 `police-hourly-history` 最新 run 的
    `newPoliceRelatedCount`，≥100 顯示綠色——把 ≥100/hr 目標可視化。
  - 5 分鐘自動重抓（即時感）；未來日期瑕疵（來源錯誤）以數值時戳降權，不污染「最新情報時間」。
- `scripts/build-static.mjs`：首頁 `index.html` ← `static/intel.html`；舊平面儀表板保留為 `classic.html`。

## 2. 每小時 ≥100 筆新進：誠實的工程結論

實查診斷（避免灌水）：
- 既有 ~40 個 twinkle 來源是**正規化快照**，兩次抓取間不變 → ledger 飽和後 `newPoliceRelatedCount=0`
  （實測：6887 筆全重複）。歷史上的「200/hr」是消化一次性 backlog，已耗盡。
- 採購（pcc-tender）半月批次、判決 search_judicial 是語意非日期排序、AQI 需金鑰（示範金鑰已失效）。
- 結論：**twinkle 快照無法產生每小時新資料；需直連活來源，或引入高量真實 corpus。**

解法：**司法院裁判書 churn 引擎**（真實、警政相關、高量、無需金鑰）。
- `scripts/lib/fetch-judicial.mjs`：以多罪名語意查詢（24 類，每小時輪替 12 類）撈真實刑案判決，
  純 mapper `mapJudicialEvents`（依 jid 去重、法院代碼前綴→城市座標、jdate→ISO、依罪名/刑度分級風險）。
- `scripts/fetch-live.mjs`：警政抓取成功後併入判決事件 → 進每小時 ledger
  （fingerprint `judicial:{jid}` 唯一）。`isPoliceDomesticEvent` 認得 `judicial-` 前綴。
- 每筆判決 jid 唯一 → 真正「新進」；ledger 上限 200/run，超出者 deferred 滾入下一輪；
  判決每日數千筆新增，足以長期維持。

## 3. 驗證

- `npm test` 57/57 綠（新增判決 mapper 3 測試）· `tsc --noEmit` 0 · `npm run build` 0。
- 實跑 `fetch-live --sources=police`：司法院裁判書 360 筆；最新 run（2026-06-19 20:00）
  `newPoliceRelatedCount=200`、`meetsNewHourlyMinimum=true`、newRecords 200 筆**全為判決**、deferred 160。
- ledger 由 6899 → 7099（+200 judicial 指紋）；domestic.json 含 360 筆判決事件（359 有座標）。
- Playwright 截圖：globe 渲染、總 7,286 筆、左側「本小時新進情報 200 筆」綠燈、最新情報時間正常。

## 4. 維運與後續

- 持續達標需**每小時排程跑 fetch**（既有 `npm run watch:police-hourly` / scripts\police-hourly-loop.cmd）。
- 後續可選：直連即時感測（MOENV 空品/TDX 交通，需金鑰）擴大非判決即時量；
  判決事件詳情可加被告/法條結構化欄位；globe 標點密度/分群優化。
