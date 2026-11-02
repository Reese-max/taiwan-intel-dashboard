# AI 摘要降級根本原因與環境變數／Secrets 調查報告

詳見完整報告：[docs/ai-summary-degraded-root-cause.md](../ai-summary-degraded-root-cause.md)

### 摘要結論
1. **根本原因分類**：
   - **endpoint/model change**：NVIDIA API 端點 `https://integrate.api.nvidia.com/v1` 的 `nvidia/nemotron-3-super-120b-a12b` 回傳 `HTTP 404: Function 'ac74040f...': Not found for account`。
   - **missing secret**：workflow `.github/workflows/pipeline-fetch.yml` 的 `抓取即時資料` 步驟嘗試讀取 `SUMMARY_API_KEY`、`SUMMARY_BASE_URL` 與 `SUMMARY_MODEL`，但儲存庫中並無此三項 Secrets。
   - **code bug**：舊版部署程式碼在降級時未寫入 `degradedReason`，且 404 錯誤未觸發熔斷機制。
2. **已完成修復**：
   - 擴充 `scripts/lib/llm-client.mjs` 熔斷機制支援 403/404。
   - 擴充 `scripts/lib/nvidia.mjs` 精確寫入 `degradedReason`（如 `missing env NVIDIA_API_KEY`、`HTTP 429 quota`、`HTTP 404/410`）。
   - 新增單元測試於 `tests/summary-pipeline-fallback.test.ts` 與 `tests/llm-fallback.test.ts`。
