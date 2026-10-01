# 程式碼發布與自動資料更新

本文件定義 `main`、`production` 與 `pipeline-state` 的 mutation boundary，以及未通過 Quality Gate 時不得進入正式發布路徑的規則。正式網站每 30 分鐘更新資料；網站程式碼版本由 `ops/approved-code.json` 的完整 commit SHA 固定。

## Mutation boundary

| 路徑 | 寫入目標 | 進入條件 |
|---|---|---|
| 程式碼開發 | `main` | Pull request；`main` ruleset 要求 `test` 與 `check`，禁止刪除與 non-fast-forward |
| 正式程式碼版本核准 | `ops/approved-code.json` → Cloudflare Pages | 獨立 pull request；只能指定已驗證的 commit SHA，並取得負責人核准 |
| 保護的歷史／promotion 分支 | `production` | Pull request；`production` ruleset 要求 `check`；push 不觸發正式部署 |
| 例行資料更新 | `pipeline-state`／Cloudflare Pages | `update-and-deploy.yml` 排程的 fetch → audit → approved build → save-state → deploy → smoke；不需逐輪人工批准 |

- Agent 或一般維護者可以建立 branch、commit、pull request，但不可透過直接 push 或跳過 required checks 進入正常程式碼發布路徑。
- `pipeline-state` 是資料快照分支，不是程式碼發布來源；例行資料更新不需要人工 merge `main` 或 `production`。
- `production` 的 push 不會觸發正式站部署。正式站部署只接受 `update-and-deploy.yml` 建出的、以 approved SHA checkout 的 artifact。

## Quality Gate

### Pull request required checks

`deploy.yml` 的 `check` job 依賴 `build-preview`；`build-preview` 使用還原的同一份 `pipeline-state` 資料，依序執行：

1. `npm run check`（完整 Vitest、TypeScript check、network build 與 production build）。
2. `python3 -m unittest discover -s tests -p test_crime_weekly_parser.py`（Python 回歸測試）。
3. 沿用 pipeline 的必要資料稽核：network contract、source freshness、coverage、source health、summary、source provenance、network quality 與 data size（24 MiB 上限）。資料過期或稽核失敗時阻擋 preview，不抓即時資料補過檢查。
4. `npm run ops:validate` 與 `npm run ops:verify-docs`（operating-state 契約及文件一致性）。
5. `node scripts/approved-code.mjs`（approved production code manifest 格式）。

上述檢查全部成功後，`check` 才下載 artifact、部署 Cloudflare Pages preview 並執行 canonical data smoke check。因此，`production` ruleset 雖只列 required context `check`，測試、建置、必要資料稽核、operating-state 或 manifest 任一失敗都會使該 context 失敗，不能進入 production。`pr-check.yml` 仍在 `main` 與 `production` pull request 執行 `test`，提供較早的回饋。

本機 clean replay 可用 `CI=true npm run check` 驗證測試與建置；缺資料時建立的 fixture 不代表資料稽核或部署驗收通過。一般建置與 GitHub Actions 會拒絕殘留的 `build-replay-fixture` 事件，必須先還原已稽核資料。

`check` 的 Cloudflare preview 需要 repository secrets；fork PR 拿不到 secrets，`check` 無法轉綠。外部貢獻須先以 repository branch 開 PR 才會產生完整 required checks。

### Scheduled data release

`update-and-deploy.yml` 的 job dependency 形成 fail-closed 邊界：

`operating-state` → `fetch` → `audit` → `build-approved` → `save-state` → `deploy`

`audit` 或 operating-state validation 失敗時，`save-state` 與 `deploy` 都不會執行。`build-approved` 會以同一份候選資料 checkout `ops/approved-code.json` 的 SHA，執行 `npm run check`；資料稽核與核准版本建置通過後，依序更新 `pipeline-state`、部署正式站，再執行線上 smoke。smoke 失敗不會自動回復已寫入的資料狀態或已部署版本，必須依事故程序處理。

`operating-state`、`save-state` 與 `deploy` job 均帶 `if: github.ref_name == 'main'`：從其他 ref 發起的 `workflow_dispatch` 不會觸碰 secrets、不寫 `pipeline-state`、不部署正式站——整條 pipeline 依 `needs` 連鎖跳過。資料 mutation 只接受 `main` 上的排程、push 或手動觸發。

## 正常發布步驟

1. 在 `main` 以 pull request 完成程式碼變更，確認 `test`、`check` 與 preview 通過。
2. 以獨立 pull request 將 `ops/approved-code.json` 的 `sha` 改為已驗證的 40 字元 commit SHA，附上候選版本、preview 與檢查連結。
3. 由專案負責人對該版本明確核准正式發布；未取得核准，不合併發布 PR。
4. 合併後由下一輪成功資料更新建置並部署；必要時才在核准後手動觸發 `更新資料並部署`。

GitHub ruleset 的設定屬於 repository control-plane，不以 repository 檔案假裝取代平台設定。已套用的規則為：`main` required `test` + `check`；`production` required `check`；兩者均禁止刪除與 non-fast-forward。required approving review count 目前為 0，因此負責人核准仍是營運發布政策，不可把 CI 綠燈誤解為發布核准。

## Break-glass（僅限事故修復）

正常情況不得 bypass ruleset。僅 repository Admin 可在正式事故中使用 break-glass，且必須留下可追溯 audit trail：

1. 操作前在 incident issue 或受控事件紀錄寫下操作者、原因、時間（UTC）、目標 ref、commit SHA 與預期影響；不得記錄任何 secret 值。
2. Admin 只處理必要的事故修復 commit，並保留 GitHub ruleset bypass 的操作連結。GitHub audit log 是平台側佐證。
3. 24 小時內建立後補 PR 或 `docs/operations/receipts/break-glass-YYYYMMDD-<sha>.md` 收據，列出操作者、原因、時間、commit SHA、incident/PR/run URL、繞過的 required checks 與結果。
4. 事後必須對該 exact commit 補跑完整 Quality Gate：`npm test`、`npm run build`、`npm run check`、`npm run ops:validate`、`npm run ops:verify-docs`，以及同一份候選資料的 pipeline audit（source freshness、coverage、source health、summary、provenance、network quality、data size）與 deploy smoke；收據只在全部成功時標記 pass。

非事故的直推不屬於 break-glass，應視為流程違規並停止後續發布、保留證據、回復後走正常 PR。資料來源失敗時則保留已稽核的上一版網站，依 [`pause-and-restore.md`](pause-and-restore.md) 處理。

## 不做的事

- 不修改 Secrets、不新增付費服務。
- 不把 branch protection/ruleset 當成資料更新排程的替代品。
- 不以通過一個 preview 或單次測試，宣稱已完成正式發布核准。
