# 程式碼發布與自動資料更新

正式網站每 30 分鐘更新資料。網站程式碼版本由 `ops/approved-code.json` 的完整 commit SHA 固定；`main` 上的一般程式碼 PR 合併後，不會在下一次資料更新時自動發布到正式站。

## 路徑與檢查

| 路徑 | 寫入目標 | 條件 |
|---|---|---|
| 程式碼開發 | `main` | PR 的 `test` 與 `check` 通過；`check` 包含真實 Cloudflare 預覽部署 |
| 程式碼發布 | `ops/approved-code.json` 中的 SHA | 核准指定 commit 與預覽後，以獨立 PR 更新 SHA；合併前需取得專案負責人的明確發布核准 |
| 資料更新 | `pipeline-state` 與 Cloudflare Pages | 排程抓取、來源稽核、摘要檢查、以核准程式碼建置和測試、保存狀態、部署、線上 smoke；不需每輪人工核准 |

`update-and-deploy.yml` 先用 `main` 上的資料管線抓取與稽核候選資料，再 checkout 核准 SHA，以**同一份候選資料**執行 `npm run check` 並建置網站。只有資料稽核與核准版本建置都通過，才更新 `pipeline-state` 並部署正式站。`pipeline-state` 是資料快照分支，不是程式碼發布來源。`production` 分支目前保留作為歷史分支；其 push 不再觸發正式站部署。

## 發布步驟

1. 在 `main` 以 PR 完成程式碼變更，確認 `test`、`check`、預覽網站及所需資料檢查。
2. 以獨立 PR 將 `ops/approved-code.json` 的 `sha` 改為已驗證的 40 字元 commit SHA，附上候選版本、預覽與檢查連結。
3. 請專案負責人對**該版本**明確核准正式發布；未取得核准，不合併發布 PR。
4. 合併後，下一輪成功的資料更新會以新 SHA 建置與部署；檢查 Cloudflare 部署版本及線上 smoke。若需立刻發布，經核准後手動觸發 `更新資料並部署`。

GitHub ruleset 目前對 `main` 要求 `test` 與 `check`，對 `production` 要求 `check`，但規則的 required approving review count 為 0。上面的人工核准是營運與 `AGENTS.md` 的發布要求；單靠現有 ruleset **不能**強制人員核准。設定更嚴格的 GitHub 規則前，不可將 PR 通過檢查解讀為已核准發布。

## 事故處理

資料來源失敗時保留已稽核的上一版網站，依 `docs/operations/pause-and-restore.md` 記錄事件並修復。程式碼熱修也走 PR、檢查、預覽及負責人核准；不要直接推送 `main` 或 `production`。摘要 AI 端點失效時，系統會顯示明確標記的統計備援，不得將其宣稱為 AI 摘要恢復。
