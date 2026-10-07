# Break-Glass 緊急通道收據模板

> 複製此檔案為 `docs/operations/receipts/break-glass-<YYYY-MM-DD>.md` 填寫

## 基本資訊

| 欄位 | 內容 |
|---|---|
| **日期時間 (UTC)** | 2026-XX-XXTHH:MM:SSZ |
| **操作者** | @github-handle |
| **事故描述** | 具體說明生產環境事故（如：正式站 500 錯誤、資料管線卡死超過 2 小時） |
| **影響範圍** | 正式站 / API / 資料更新排程 / 其他 |
| **Commit SHA** | 緊急修復的 40 字元 commit SHA |
| **繞過規則** | 實際繞過的 required_status_checks 名稱 / PR 核准數 / 其他（目標完整 gate 為 test + check；以當時 ruleset readback 為準） |

## 緊急處理過程

1. **發現時間**：
2. **啟動 break-glass 時間**：
3. **修復部署時間**：
4. **服務恢復確認時間**：

## 事後補驗清單（需在 24 小時內完成）

- [ ] 建立正式 PR：包含相同修復內容，走完整 CI 流程
- [ ] PR 通過 `test` 檢查（單元測試、型別檢查、operating-state 驗證）
- [ ] `build-preview` 完成建置並上傳已檢查 artifact（此步本身不代表部署或預覽驗證成功）
- [ ] PR 通過下游 `check` 檢查：部署該 artifact，且 `Verify Preview` 成功；記錄真實預覽 URL 與同一 commit SHA
- [ ] 取得專案負責人對該版本明確核准
- [ ] 合併 PR 到 `main`
- [ ] 更新 `ops/approved-code.json` 為修復後的正確 SHA
- [ ] 確認下一輪資料更新成功部署該版本
- [ ] 在此收據補上驗證收據連結

## 驗證收據

| 檢查項目 | Workflow Run URL | 結論 |
|---|---|---|
| test | | |
| build-preview（已檢查 artifact 建置／上傳） | | |
| check（部署 artifact 並通過 Verify Preview） | | |
| 真實預覽 URL／驗證 commit SHA | | |
| 發布 PR 合併 | | |

## 簽署

- 緊急處理操作者：____________________ 日期：____________________
- 事後審查者：____________________ 日期：____________________
