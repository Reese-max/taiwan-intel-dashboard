# 資料快照抓取紀錄（可溯源 / 可重現）

產生時間：2026-06-15T09:50:00+08:00
產生方式：由具 twinkle-hub MCP + WebSearch/WebFetch 的代理一次性抓取，轉成統一 `IntelEvent` schema 寫入 `data/*.json`。

## 國內（data/domestic.json）

### 1. 政府採購決標公告（category：採購，12 筆）
- 來源：政府電子採購網（行政院公共工程委員會），twinkle-hub dataset `pcc-tender`
- 查詢：`announcement_type='決標公告' AND award_price != '' AND date <= '2026-06-15' ORDER BY date DESC`，取金額/縣市多元之代表筆
- 最新資料日期：2026-03-31（半月公開資料有延遲，屬正常）
- 溯源欄位：`source.recordRef` = 標案案號（job_number）；`source.url` = 採購網 OpenData 入口（原始 `detail_url` 為 null，故以入口 + 案號回查）
- 重抓：對 `pcc-tender` 重跑上述 query 即可

### 2. 顯著有感地震（category：災防，3 筆）
- 來源：交通部中央氣象署「顯著有感地震報告」（twinkle-hub dataset `6068`）
- 實際抓取：dataset 6068 的 normalised 版僅 1 列（CAP 包裝），故改以其原始來源 CWA 開放資料 API 取多筆清單：
  `https://opendata.cwa.gov.tw/api/v1/rest/datastore/E-A0015-001?Authorization=rdec-key-123-45678-011121314`
- 溯源欄位：`source.recordRef` = 地震編號；`source.url` = CWA 報告頁 `https://scweb.cwa.gov.tw/zh-tw/earthquake/details/<編號>`
- 座標：真實震央經緯度

## 國際（data/international.json，6 筆）
- 來源：WebSearch（2026-06）取得之公開新聞，每筆 `source.url` 為真實報導連結
- 類別與來源：
  - 地緣政治 ×2：WEF、CFR（query：major geopolitical conflict news June 2026）
  - 災害 ×1：NPR（query：major earthquake disaster June 2026）
  - 資安 ×2：Tech.co、Malwarebytes（query：major cyberattack data breach June 2026）
  - 金融 ×1：Al Jazeera（query：oil price stock market reaction Strait of Hormuz June 2026）
- 座標：事件相關地點/機構所在地真實座標

## 衍生欄位說明（非原始資料）
- **座標（採購）**：依機關所在縣市/區中心**推估**，非原始欄位；用於地圖定位。
- **riskLevel**：衍生關注度指標——
  - 採購：依決標金額（≥10 億 critical、≥1 億 high、≥1000 萬 medium、其餘 low）
  - 地震：依規模（≥6.0 critical、≥5.0 high、≥4.0 medium）
  - 國際：依事件嚴重度人工標註
- **誠實原則**：無原始連結者保留來源名與抓取時間，不以合成連結偽裝；交通/治安類於 data.gov.tw 多為「年度彙總統計」非事件級，本版未納入事件卡。

## 未來接 live 更新
- 採購：定期對 `pcc-tender` 重跑 query。
- 地震：改接 CWA API（有感地震即時）。
- 國際：接 RSS / 新聞 API，轉成統一 schema 即可，前端不需改。
