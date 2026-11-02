# AI 摘要降級根本原因與環境變數／Secrets 調查報告

本報告針對線上環境（https://taiwan-intel-dashboard.pages.dev）之 `data/summary.json` 降級至「系統統計備援」（`degraded: { domestic: true, international: true }`，標示 model `nvidia/nemotron-3-super-120b-a12b`，generatedAt `2026-10-30T14:43Z` 且無 reason）進行完整根本原因調查。

---

## 1. 根本原因分類與日誌實證

根據 GitHub Actions 執行日誌（Run ID `41073770743`，Job `fetch / fetch` ID `124124478903`，時間 2026-10-30T14:41 至 14:43Z）與儲存庫程式碼對照，根本原因歸類如下：

### (1) 端點與模型變更／權限問題（endpoint/model change）
* **實際錯誤日誌**：
  在即時抓取過程中，所有國際新聞正規化、國內新聞正規化及情勢摘要請求皆向 `https://integrate.api.nvidia.com/v1/chat/completions` 發送，模型名稱為 `nvidia/nemotron-3-super-120b-a12b`，全數收到 NVIDIA API 回應：
  ```
  LLM HTTP 404: {"status":404,"title":"Not Found","detail":"Function 'ac74040f-9fc9-4c5e-ac74-279ba5161d69': Not found for account '<redacted-account-id>'"}
  ```
* **原因分析**：
  NVIDIA Build (NIM) 平台將該模型映射為函數 ID `ac74040f-9fc9-4c5e-ac74-279ba5161d69`。錯誤指出該函數對此 API Key 所屬帳號未開通（Not found for account），或該模型於 NVIDIA 託管端點已調整/下線。

### (2) 缺失的 Secrets（missing secret）
* **比對結果**：
  工作流程 `.github/workflows/pipeline-fetch.yml` 在 `抓取即時資料` 步驟中依賴並傳入以下變數：
  ```yaml
  SUMMARY_LLM: ${{ secrets.SUMMARY_LLM }}
  SUMMARY_API_KEY: ${{ secrets.SUMMARY_API_KEY }}
  SUMMARY_BASE_URL: ${{ secrets.SUMMARY_BASE_URL }}
  SUMMARY_MODEL: ${{ secrets.SUMMARY_MODEL }}
  ```
* **GitHub Secrets 清單（`gh secret list`）實況**：
  儲存庫目前僅有 `SUMMARY_LLM`，**缺少以下 Secrets**：
  1. `SUMMARY_API_KEY`（專屬摘要端點 API Key）
  2. `SUMMARY_BASE_URL`（專屬摘要端點 Base URL）
  3. `SUMMARY_MODEL`（專屬摘要端點模型名稱）

* **連鎖效應**：
  當 `SUMMARY_API_KEY` 為空但 `SUMMARY_LLM` 存在時，`scripts/lib/llm-client.mjs` 會啟用 flag 模式並回退至共用 NVIDIA 端點（`NVIDIA_BASE_URL`、`NVIDIA_API_KEY`、`NVIDIA_MODEL`）。因為 workflow 中 primary、fallback 與 summary 三組 profile 全部指向相同的 NVIDIA 端點與模型，一旦該 NVIDIA 函數回傳 404，整個備援鏈全滅，無任何其他可用端點可退回。

### (3) 程式碼缺陷與可觀察性不足（code bug）
1. **未寫入 degradedReason**：先前 `main` 分支上的程式碼在 degraded 發生時，未將具體的 `degradedReason` 或 `reason` 寫入 `summary.json`，導致產物為空的 fallback 狀態。
2. **熔斷器未攔截 HTTP 404**：`scripts/lib/llm-client.mjs` 原先僅對 401 及 410 啟用 `terminalFailures`。遇到 404 時仍逐批重試（42 個批次各嘗試 2 次），浪費大量時間與執行額度。
3. **未回應時 model 虛假標記**：當所有請求失敗時，`summary.model` 原先回退至環境變數配置的模型名稱，使產物輸出 `nvidia/nemotron-3-super-120b-a12b`，容易誤導維運人員以為該模型已產生結果。

---

## 2. 環境變數比對表

| 變數名稱 | 程式碼預期 (`llm-client.mjs` / `nvidia.mjs`) | Workflow 傳入 (`pipeline-fetch.yml`) | GitHub Secrets 狀態 (`gh secret list`) | 狀態評估 |
|---|---|---|---|---|
| `LLM_API_KEY` | 主要端點金鑰 | `${{ secrets.NVIDIA_API_KEY }}` | 存在 `LLM_API_KEY`，但 workflow 改傳 `NVIDIA_API_KEY` | 由 workflow 重定向 |
| `LLM_BASE_URL` | 主要端點 URL | `https://integrate.api.nvidia.com/v1` | 存在 `LLM_BASE_URL`，workflow 改寫硬編碼 | 由 workflow 固定 |
| `LLM_MODEL` | 主要端點模型 | `nvidia/nemotron-3-super-120b-a12b` | 存在 `LLM_MODEL`，workflow 改寫硬編碼 | 由 workflow 固定 |
| `NVIDIA_API_KEY` | NVIDIA 備援金鑰 | `${{ secrets.NVIDIA_API_KEY }}` | 存在 `NVIDIA_API_KEY` | 正常傳遞（但帳號無 404 模型權限） |
| `NVIDIA_BASE_URL` | NVIDIA 備援 URL | `https://integrate.api.nvidia.com/v1` | 存在 `NVIDIA_BASE_URL`，workflow 傳固定值 | 正常傳遞 |
| `NVIDIA_MODEL` | NVIDIA 備援模型 | `nvidia/nemotron-3-super-120b-a12b` | 存在 `NVIDIA_MODEL`，workflow 傳固定值 | 正常傳遞（該模型 404） |
| `SUMMARY_LLM` | 啟用摘要端點旗標 | `${{ secrets.SUMMARY_LLM }}` | 存在 `SUMMARY_LLM` | 正常傳遞 |
| `SUMMARY_API_KEY` | 專屬摘要端點金鑰 | `${{ secrets.SUMMARY_API_KEY }}` | **不存在** | **Missing Secret** |
| `SUMMARY_BASE_URL`| 專屬摘要端點 URL | `${{ secrets.SUMMARY_BASE_URL }}` | **不存在** | **Missing Secret** |
| `SUMMARY_MODEL`   | 專屬摘要端點模型 | `${{ secrets.SUMMARY_MODEL }}` | **不存在** | **Missing Secret** |

---

## 3. 需補齊之 Secret 名稱與消費步驟（供維運人員設定）

依使用者規範（不得擅自發明或假造正式 Secrets），若團隊欲使用獨立 AI 摘要供應商（如 OpenAI、MiniMax 等），請由管理員在 GitHub Repository Secrets 中設定以下金鑰：

1. **`SUMMARY_API_KEY`**
   - **消費工作流程**：`.github/workflows/pipeline-fetch.yml`
   - **消費步驟**：`fetch` job 的 `抓取即時資料` 步驟
   - **用途**：提供情勢摘要（`generate-summary.mjs` 及 `fetch-live.mjs` 中的 `summarize`）專屬 LLM API 金鑰。
2. **`SUMMARY_BASE_URL`**
   - **消費工作流程**：同上（`.github/workflows/pipeline-fetch.yml` 的 `抓取即時資料` 步驟）
   - **用途**：提供專屬摘要端點之 OpenAI 相容 Base URL。
3. **`SUMMARY_MODEL`**
   - **消費工作流程**：同上（`.github/workflows/pipeline-fetch.yml` 的 `抓取即時資料` 步驟）
   - **用途**：提供專屬摘要端點之模型名稱。

若欲維持 NVIDIA 備援，則須確認 `NVIDIA_API_KEY` 在 [build.nvidia.com](https://build.nvidia.com) 具備所選模型之調用權限，或更新 workflow 中的 `NVIDIA_MODEL` 為已開通且支援的公開模型。

---

## 4. 程式碼防護與改善措施

1. **熔斷保護擴展**（`scripts/lib/llm-client.mjs`）：
   - 將 HTTP 403 與 HTTP 404 納入 `terminalFailures`，端點不存在或帳號未開通時立即終止後續同端點無效批次，避免管線逾時。
   - 金鑰缺少時精準拋出 `missing env <NAME>`，絕不印出任何現有金鑰內容。
2. **降級原因精確化**（`scripts/lib/nvidia.mjs`）：
   - `formatActionableLlmError` 精準支援 `missing env NVIDIA_API_KEY`、`HTTP 429 quota` 及 `HTTP 404/410`。
   - `summary.json` 發生 degraded 時，必附帶 `degradedReason` 與 `reason` 欄位，供儀表板 UI 與資料稽核判讀。
