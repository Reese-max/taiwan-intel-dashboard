# Release Gate — mutation boundary 與 break-glass（issue #42）

本檔定義三種變更路徑各自的邊界：什麼能直接寫、必須經什麼閘門、事故時怎麼繞。

## Mutation boundary

| 路徑 | 寫入目標 | 閘門 | 誰可以做 |
|---|---|---|---|
| **程式碼變更 → main** | `main` 分支 | PR + required checks `test`、`check` | 任何人/agent 開 PR；不可直推 |
| **發布 → production** | `production` 分支 → Cloudflare 正式站 | PR + required check `check`（test+tsc+build+network contract）→ `deploy-production` | 同上的 promotion PR |
| **例行資料更新** | `pipeline-state` 分支 + Cloudflare Pages | `update-and-deploy.yml` 排程：fetch→save-state→audit→deploy→smoke | 全自動，不需人工批准 |

- `pipeline-state` 是資料快照分支，不是程式碼分支——資料更新**不經 main/production**，因此 branch protection 不影響無人值守更新。
- `gh-pages` 由 `save-state`（peaceiris/actions-gh-pages）寫入，同樣不受 main/production ruleset 影響。

## Required checks 對應

| Check context | Workflow / job | 涵蓋 |
|---|---|---|
| `test` | `PR 檢查` / `test` | `npm test`（Vitest 全套）+ `tsc --noEmit` + `ops:validate`（operating-state 契約） |
| `check` | `Deploy` / `check` | 還原 `pipeline-state` 資料後 `npm run check`＝test + tsc + `build-network`（network contract 驗收）+ `build-static`（production build） |

`main` ruleset 要求 `test` + `check`；`production` ruleset 要求 `check`
（`test` 於 pr-check.yml 納入 production 觸發後亦會在 prod PR 上跑，作為快速回饋）。
更深的資料稽核（freshness/coverage/source-health/provenance/network-quality/data-size）
由排程管線的 `audit` job 在部署前執行——audit 失敗即不部署。

## Break-glass 流程（僅限事故修復）

Repo Admin 是 ruleset 的唯一 bypass actor。繞過閘門只在 production 事故且正常 PR 流程來不及時使用：

1. 操作前：在 issue 或 commit message 記下**操作者、原因、時間**。
2. Admin 直接 push hotfix 到 `main`（或 production）。
3. **事後必補**：24h 內補一個正常 PR 或收據檔 `docs/operations/receipts/break-glass-YYYYMMDD-<sha>.md`，內容含：
   - 操作者 / 原因 / 時間 / 繞過的 commit SHA
   - 補跑完整 Quality Gate 的結果（`npm run check` + audit 輸出連結）
4. GitHub audit log 的 ruleset bypass 事件即為系統側佐證。

非事故的直推不屬於 break-glass——視為流程違規，應 revert 並走正常 PR。

## 不做的事

- 不改 Secrets、不加付費服務。
- 不把 branch protection 當資料更新排程的替代品——資料路徑維持排程自動。
- Ruleset 管理本身不走檔案（GitHub API 套用），此文件是唯一單一真相的邊界說明。
