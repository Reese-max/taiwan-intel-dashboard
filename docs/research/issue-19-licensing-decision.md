# Issue #19 — 程式碼、資料與生成內容之授權與權利邊界研究決策紀錄

本文件為 `Reese-max/taiwan-intel-dashboard#19`（P3，RESEARCH / DOCUMENTATION）之研究決策交付成果。
本文件**不直接建立 `LICENSE` 授權文字**，亦不代替專案擁有者（owner）完成法律決定；所有權利選項目前狀態均為**待決定／待審（Pending Owner Review）**。GitHub 儲存庫的公開可見性不代表授予第三方廣泛的再利用許可。

---

## 1. 現狀盤點（截至 2026-09-17）

| 層次 | 現狀事實 | 查證依據 |
|---|---|---|
| Repo Metadata | `license: null`，公開儲存庫 | GitHub API `license` 欄位 |
| 專案根目錄 | 無 `LICENSE` 或 `COPYING` 檔案 | 預設分支檔案清單 |
| 上游來源標註 | 政府來源 adapter 具備 `license` 欄位（政府資料開放授權條款-第1版、政府網站資料開放宣告） | `scripts/fetch-live.mjs`、`scripts/lib/fetch-official.mjs` |
| 前端 UI 呈現 | `SourcePanel` 依各來源呈現 `source.license` 標章與說明 | `src/components/SourcePanel.ts` |
| 下游輸出（#25） | GovIntel Discovery Feed 輸出具備 `authority` 與 `rights` 欄位 | `scripts/govintel-discovery.mjs`、`schemas/govintel-discovery.v1.schema.json` |
| README 宣稱 | 記錄資料來源可追溯性；無總體再利用許可宣告 | `README.md` |

上游 adapter 的 `license` 欄位記錄的是**該資料集之上游條款**，並不代表本專案本身之原始程式碼、關聯圖、AI 摘要或聚合產物之再利用授權。

---

## 2. 核心權利分層與邊界規則

本專案混合多種權利屬性不同之資料，必須分層定義與處理：

### 2.1 專案原創原始碼（Original Source Code）
- **範圍**：本專案自行撰寫之前端（TypeScript/CSS）、資料管線（Node.js ESM 腳本）、CI 設定與工具鏈。
- **現狀**：All Rights Reserved（保留所有權利，待 owner 正式選定授權）。
- **建議選項（待審）**：**MIT** 授權——寬鬆、符合儀表板生態系常態、不與政府開放資料相衝突。備選為 Apache-2.0 或保持專利與私有權利宣告。

### 2.2 上游政府開放資料（Government Open Data）
- **條款遵循**：主要依「政府資料開放授權條款-第1版」或各機關「政府網站資料開放宣告」。
- **邊界限制**：
  - 允許合理範圍利用、改作與再散布，但**強制要求標註來源機關與授權名稱**。
  - **不可由本專案進行轉授權（No Relicensing）**：下游使用者使用政府開放資料時，仍直接受上游政府條款拘束。
  - 本專案持續於 `SourcePanel`、`provenance.json` 中保留並標示上游授權。

### 2.3 新聞、RSS 摘要與 LLM 生成文字（News & AI Briefs）
- **新聞標題與公開連結**：保留原文出處、原發布媒體名稱與超連結。
- **引用限制**：僅保留必要之短摘要與分類標籤，**嚴格禁止抓取與重新散布全文（Full-text）**。
- **AI 生成摘要（LLM Briefs）**：
  - 由新聞與政府事件轉換而來之轉化性（transformative）短文。
  - 事實本體不受著作權保護，AI 摘要視為系統分析文字；若上游新聞權利狀態未知，**不得默認為允許重新散布全文**。

### 2.4 下游發現饋送與匯出產物（#25 Discovery Feed & JSON Artifacts）
- **規範**：
  - 遵循「必要 metadata 與原文連結開放，摘要有限度引用，全文禁止轉發」原則。
  - 當來源權利為未知（UNKNOWN）或商業限制時，`rights` 欄位標記為 `REVIEW_REQUIRED`，**絕對不可假定為可任意商用或重新散布（Rights Unknown is NEVER Permission）**。
  - Feed 項目之 `authority` 區分 `official` 與 `media`，避免將媒體報導冒充官方宣稱。

### 2.5 外部貢獻（External Contributions）
- **規範**：待決定。建議於 `CONTRIBUTING.md` 明定 GitHub 標準之「inbound=outbound」原則（若程式碼採 MIT，貢獻者提交之 PR 亦以 MIT 釋出），目前專案暫不強制簽署 CLA。

---

## 3. 待決策選項建議包（Decision-Ready Package）

| 產物 | 建議方案 | 狀態 |
|---|---|---|
| `LICENSE` | MIT 授權（僅涵蓋本專案原創原始碼） | **待 Owner 簽署／核准** |
| `LICENSE-DATA` / `NOTICE` | 聲明政府資料受原條款拘束；彙整各來源機關標註清單 | **待審** |
| README 授權宣告章節 | 明確聲明：公開 repo 不代表可任意再利用；新聞僅做引述與連結；政府資料歸屬原機關 | **待審** |
| 下游輸出邊界 | Discovery Feed / JSON export 遵循最小引用與不可冒充原則 | **實作已上線（#25）** |

---

## 4. 驗收結論

1. 本紀錄已確立五層權利邊界及 #25 Discovery Feed 權利規則。
2. 明確宣告現狀為「待決定／待審」，無人代替 owner 擅自賦予授權。
3. 確定「權利未知不可視為允許重新散布」之安全邊界原則。
