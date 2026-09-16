# 地點連結與新聞關聯修正

基準：`main@bae82f6b2b2ccd66ee9e9fb5b784546b4b81a33d`。
本次為小範圍修正，不調整來源、模型、風險等級、排程或正式部署。

## 行為改變

- 事件卡片保留原文及關聯按鈕，另加地點連結。只有來源標記 `exact/address` 且有限、合法、非 `(0,0)` 的座標可開啟資料座標；其餘有具體區域名稱者只做區域查詢，明示「非案發點」。全國、未知與全球資料不猜地址。
- 同名路段、車站、校園等地名以 scope 與已知區域消歧；台／臺行政區別名可配對。地名在三日內可形成探索線索，但不能僅靠地名把新聞 union 成一個情報群。
- 地名不再同時充當具名身分與標題相似度證據。具名組織／品牌仍保留同 scope 的跨地線索；這不代表同名組織已完成實體辨識。
- 三個關聯階段均隔離國內／國際 scope。時間型連結排除無效時間；具名非地理實體的歷史線索及既有缺時降級資料保留。
- AI 同題限兩日窗口，跨區還須有共同的非地理具名實體；AI topic 本身只補 `same-topic`，不能單獨產生 `same-incident`。既有內容證據成立的較強關聯不被弱線索覆蓋。
- 區域文字不再直接作為正規表示式。

地點 URL 使用 Google Maps Search URL，不需要新增 API 呼叫或 API key：
https://developers.google.com/maps/documentation/urls/get-started

## 實際驗證及限制

1. 透過連接的 GitHub 讀取原始檔；本機工作副本的 `correlate.mjs`、`cluster-signals.mjs`、`EventCard.ts`、事件型別及渲染 helper 以 Git blob SHA 核對，確保不是另寫一套替代實作。
2. 在未修改引擎上執行固定 fixture，重現跨市同名路段成群、未知區域成群、跨月／跨 scope AI 同題升同案、缺時間被當成時間相近。
3. 新增 31 個回歸案例：`tests/location-news-relations.test.ts` 19 個、`tests/location-link.test.ts` 12 個。以 TypeScript 轉譯後使用 Node.js v22.16.0 的 `node:test` 執行相同案例與 `node:assert/strict` 斷言，31 通過、0 失敗。只有測試註冊入口由 Vitest 改為 Node，實際引擎與卡片/helper 沒有替身。這不是完整 Vitest 結果。
4. `node --check scripts/lib/correlate.mjs` 通過。
5. 針對 `src/utils/locationLink.ts` 及實際事件型別執行 strict TypeScript noEmit 檢查，通過；這不是全專案型別檢查。
6. 既有 `npm test` 與修改後 `npm run check` 均無法在此環境完成：`vitest: not found`（exit 127）。一般容器網路也無法解析 GitHub，未取得完整安裝環境。因此 PR 必須保持 draft，待完整 CI 與 preview 驗收。

## 合併前驗收

- [ ] 在完整 checkout 執行 `npm run check`，保留既有測試，不跳過失敗項。
- [ ] 用同一份真實候選資料比較修正前後關聯邊，抽查被移除及保留的配對；不可用合成測試推論正式資料準確率。
- [ ] 桌面／手機 preview 驗證：原文、關聯按鈕、座標連結、區域連結互不干擾；無地點事件仍可讀。
- [ ] 檢查鍵盤焦點、開新分頁、長地名換行與來源精度提示；目前只完成卡片 HTML 字串渲染斷言，沒有瀏覽器驗收。
- [ ] 確認 `same-entity` 下的新地名理由在關聯圖／清單中完整可讀；不冒充已確認案發點。

## 不在本次範圍

- #26 的原始發布者／轉載稿源歸一化尚未實作，本 PR 不關閉 #26。
- #27 的列表近三日篩選契約未更改，本 PR 僅限制關聯引擎的時間型配對。
- 沒有利用標題推測門牌、付費 geocoding、向外送新聞全文或建立新知識圖譜。
- 沒有宣稱 31 個案例代表正式站準確率，也沒有完整 runtime／CLEAN 判定。
- 沒有合併、修改 production 或部署。
