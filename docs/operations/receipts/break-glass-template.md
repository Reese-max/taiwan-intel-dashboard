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
| **繞過規則** | required_status_checks (test, build-preview) / PR 核准數 / 其他 |

## 緊急處理過程

1. **發現時間**：
2. **啟動 break-glass 時間**：
3. **修復部署時間**：
4. **服務恢復確認時間**：

## 事後補驗清單（需在 24 小時內完成）

- [ ] 建立正式 PR：包含相同修復內容，走完整 CI 流程
- [ ] PR 通過 `test` 檢查（單元測試、型別檢查、operating-state 驗證）
- [ ] PR 通過 `build-preview` 檢查（生產建置、預覽部署驗證）
- [ ] 取得專案負責人對該版本明確核准
- [ ] 合併 PR 到 `main`
- [ ] 更新 `ops/approved-code.json` 為修復後的正確 SHA
- [ ] 確認下一輪資料更新成功部署該版本
- [ ] 在此收據補上驗證收據連結

## 驗證收據

| 檢查項目 | Workflow Run URL | 結論 |
|---|---|---|
| test | | |
| build-preview | | |
| 發布 PR 合併 | | |

## 簽署

- 緊急處理操作者：____________________ 日期：____________________
- 事後審查者：____________________ 日期：____________________