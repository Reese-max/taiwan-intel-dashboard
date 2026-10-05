# 程式碼發布與自動資料更新

正式網站每 30 分鐘更新資料。網站程式碼版本由 `ops/approved-code.json` 的完整 commit SHA 固定；`main` 上的一般程式碼 PR 合併後，不會在下一次資料更新時自動發布到正式站。

## 路徑與檢查

| 路徑 | 寫入目標 | 條件 |
|---|---|---|
| 程式碼開發 | `main` | PR 的 `test` 與 `check` 通過；`build-preview` 建置並上傳已檢查 artifact，後續 `check` 部署並驗證真實 Cloudflare 預覽 |
| 程式碼發布 | `ops/approved-code.json` 中的 SHA | 核准指定 commit 與預覽後，以獨立 PR 更新 SHA；合併前需取得專案負責人的明確發布核准 |
| 資料更新 | `pipeline-state` 與 Cloudflare Pages | 排程抓取、來源稽核、摘要檢查、以核准程式碼建置和測試、保存狀態、部署、線上 smoke；不需每輪人工核准 |

`update-and-deploy.yml` 先用 `main` 上的資料管線抓取與稽核候選資料，再 checkout 核准 SHA，以**同一份候選資料**執行 `npm run check` 並建置網站。只有資料稽核與核准版本建置都通過，才更新 `pipeline-state` 並部署正式站。`pipeline-state` 是資料快照分支，不是程式碼發布來源。`production` 分支目前保留作為歷史分支；其 push 不再觸發正式站部署。

## 發布步驟

1. 在 `main` 以 PR 完成程式碼變更，確認 `test`、`check`、預覽網站及所需資料檢查。
2. 以獨立 PR 將 `ops/approved-code.json` 的 `sha` 改為已驗證的 40 字元 commit SHA，附上候選版本、預覽與檢查連結。
3. 請專案負責人對**該版本**明確核准正式發布；未取得核准，不合併發布 PR。
4. 合併後，下一輪成功的資料更新會以新 SHA 建置與部署；檢查 Cloudflare 部署版本及線上 smoke。若需立刻發布，經核准後手動觸發 `更新資料並部署`。

## 分支保護規則

以下為驗證器要求的目標保護政策。2026-10-05 匿名 GitHub ruleset readback（main `23773493`、production `23773502`）確認兩者 active、1 位核准與下列 review flags／禁止規則，但 required checks 仍為 `test` + `build-preview`，且 strict current-base policy 為 false。**`check` 與 strict policy 尚未套用；不能宣稱目前已強制部署預覽驗收。** 本 PR 不自動修改 GitHub 管理設定，`validate-ruleset.mjs` 在缺少目標政策時應回傳失敗。

目標政策要求：

- **Required Status Checks**（必須通過，strict current-base policy 為 true）：
  - `test` — 單元測試、TypeScript 型別檢查、Operating-state 契約驗證
  - `check` — 要求 `build-preview` 成功，部署該已檢查 artifact 並通過 `Verify Preview`
- **Pull Request 要求**：
  - 至少 1 位核准審查
  - 程式碼擁有者審查
  - 過期審查在推送時失效
  - 最後推送需重新核准
  - 審查執行緒必須解決
  - 允許的合併方式：merge、squash、rebase
- **禁止**：強制推送、刪除分支

`production` 分支同樣受相同規則保護，確保任何正式環境程式碼變更都經過完整品質閘門。

> **注意**：Ruleset 的 required approving review count 為 1，但人工發布核准（步驟 3）仍為營運規定。單靠 ruleset 通過不代表已獲發布授權；需專案負責人對特定版本明確核准。

## Mutation Boundary 總表

| 邊界 | 允許操作 | 禁止操作 | 執行者 |
|---|---|---|---|
| **main (程式碼)** | PR + 通過 test + check | 直接 push、跳過 required checks、force push | 開發者 / Agent |
| **ops/approved-code.json (發布核准)** | PR 更新 SHA + 負責人核准 | 直接 push、未核准合併 | 專案負責人 |
| **pipeline-state (資料快照)** | `update-and-deploy.yml` 自動更新 | 手動 push、任何程式碼變更 | 排程 / workflow_dispatch |
| **production (歷史分支)** | 受 ruleset 保護，同 main | 直接部署觸發 | 無（保留分支） |
| **排程資料更新** | `update-and-deploy.yml` 完整管線 | 繞過 audit 或 build-approved | 排程 |

## Break-Glass 緊急通道

僅限 **生產環境事故修復**（如：正式站嚴重錯誤、資料管線卡死導致服務中斷），必須滿足：

1. **授權**：由 Repository Admin（或具備 `bypass_mode: pull_request` 的角色）執行
2. **記錄**：在 PR 或 Issue 中留下：
   - 操作者
   - 原因（具體事故描述）
   - 時間（UTC ISO 8601）
   - Commit SHA（緊急修復的 commit）
   - 繞過的具體規則（如：required status checks、PR 核准數）
3. **事後補驗**：事故解除後 **24 小時內** 必須：
   - 建立正式 PR 走完整 `test` + `check` 檢查
   - 取得專案負責人核准
   - 更新 `ops/approved-code.json` 為修復後的正確 SHA
   - 在原始記錄中補上驗證收據（workflow run URL、結論）
4. **審計追蹤**：所有 break-glass 操作記錄於 `docs/operations/receipts/break-glass-<UTC日期>.md`

> ⚠️ **嚴禁** 將 break-glass 用於：功能趕工、繞過 code review、非生產環境問題、資料更新排程問題。

## 事故處理

資料來源失敗時保留已稽核的上一版網站，依 `docs/operations/pause-and-restore.md` 記錄事件並修復。程式碼熱修也走 PR、檢查、預覽及負責人核准；不要直接推送 `main` 或 `production`。摘要 AI 端點失效時，系統會顯示明確標記的統計備援，不得將其宣稱為 AI 摘要恢復。