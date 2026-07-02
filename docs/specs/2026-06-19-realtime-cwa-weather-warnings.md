# 即時情資補強 — CWA 天氣警特報（W-C0033-001）

> 狀態：已實作上線（fetch-live `status.cwaWarnings` 運作中）。

> 目標：為儀表板補一個「當天即時、警政第一線可據以判斷」的資料來源。
> 產出日期：2026-06-19。

## 1. 為何轉向（實查紀錄）

原規劃下一步是補刑案被害人輪廓（11961–11964，§ `2026-06-19-police-data-coverage-and-gaps.md` §6）。
照「先實查、不憑 metadata 猜」原則查證後發現此方向**先天不符即時性需求**：

| 切面 | dataset | twinkle-hub normalised 可用年度 |
|---|---|---|
| 年齡別 | 11964 | 僅 111 年（2022）|
| 教育程度別 | 11963 | 僅 111 年（2022）|
| 職業狀況別 | 11961 | 僅 111 年（2022）|
| 機關別 | 11962 | 91–106 年（最新 2017）|

且四者為同一份被害人數的交叉切面（總計相同），各 emit 一筆會使總數重複、年度又不一致。
結論：年度回顧統計無法提供「當天可判斷」的情資，**改補即時告警類來源**。

盤點現有 51 來源後確認：絕大多數為靜態設施／週期統計，真正具即時性者僅地震、
警察新聞發布、集會遊行、165 涉詐網站停解析等少數。即時補強最對味、可沿用既有架構者為
**CWA 告警類**（地震已用 CWA Open Data API 抓取）。

## 2. 實作（已完成並驗證）

來源：中央氣象署 Open Data `W-C0033-001`（各縣市目前之天氣警特報情形）。
沿用既有 `CWA_API_KEY` 與 `fetchCwa` 同款直打 REST API 模式。

- `scripts/lib/fetch-cwa.mjs`：新增純 mapper `mapCwaWarningEvents`（供測試，免網路）+
  `fetchCwaWarnings`（live）+ `riskByWarning`（現象→風險指標，誠實標註非官方分級）+
  `cwaTimeToIso`。每個有生效告警的縣市、每個現象 emit 一筆 `IntelEvent`
  （category `災防`、scope `domestic`、座標為縣市中心推估、id `cwa-warn-{geocode}-{現象}-{startKey}`）。
- `scripts/fetch-live.mjs`：`want("cwa")` 區塊加抓警特報（獨立 try/catch + `status.cwaWarnings`）；
  **carry-over 由 `category==="災防"` 改為依 `source.datasetId` 精準切分**（地震 `E-A0015-001`／
  警特報 `W-C0033-001`），避免兩者互吃；domestic 組裝與 provenance 各加一筆。
- `tests/cwa-warnings.test.ts`：6 個純 mapper 測試（略過無告警縣市、欄位完整性、同縣多重告警、
  風險分級、id 唯一、空輸入）。

風險分級（操作性指標，非氣象署官方）：超大豪雨/海嘯→critical；大豪雨/豪雨/颱風→high；
大雨/強風/低溫/高溫→medium；其餘（濃霧/海上強風…）→low。

前端零改動：與地震同 `災防`/`domestic` 形狀且帶 lat/lng，自動流入既有清單/地圖/時間軸。

## 3. 驗證

- `npm test` 36/36 綠（新增 6）· `tsc --noEmit` exit 0 · `npm run build` exit 0。
- 實打 `W-C0033-001`：HTTP 200，全 22 縣市，當下 2 縣市生效告警（連江縣、臺東縣 陸上強風特報）。
- `node scripts/fetch-live.mjs --sources=cwa`：天氣警特報 2 筆，地震 10 筆未被吃掉，
  警政 21,870／採購 15 筆 carry-over 完整保留，`provenance.json` 新增 W-C0033-001 來源（count 2、非 stale）。

## 4. 後續可選項（未做）

- NCDR 災害示警 CAP（淹水/土石流/坍方/停水停電）擴大災害涵蓋——另一組 API，需先驗證可及性。
- 公路/國道即時事件、停班停課公告——皆當天級，待實查驗證後評估納入。
- 颱風/海嘯警報：W-C0033-001 已涵蓋天氣特報；颱風海嘯另有專屬 dataset，事件驅動、平時為空。
