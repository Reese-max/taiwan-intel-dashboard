# 營運狀態契約（operating-state）

`ops/operating-state.json` 是產品運作狀態的**單一真源**：README 狀態行與
CI 閘門都由它判定，取代各文件各自宣稱的做法。

## 狀態

| state | 意義 | 排程 mutation | dry-run 驗證 |
|---|---|---|---|
| `PAUSED` | 決策暫停 | 擋（留 receipt） | 擋 |
| `RESTORING` | 復原驗證中 | 擋 | **允許**（唯一受控路徑） |
| `ACTIVE` | 正常運作 | 允許 | 允許 |
| `DEGRADED` | 運作但未完成受控復原驗證 | 允許（標示） | 允許 |

## 轉移規則

- 任何狀態 → `PAUSED`：隨時可直接改契約檔（PR 審核）。
- → `RESTORING`：開始走 `pause-and-restore.md` 的受控復原流程。
- `RESTORING` → `ACTIVE`：復原檢查清單通過後，把通過證據存成
  `docs/operations/receipts/restore-<UTC 日期>.md`，內容須含
  `actions/runs/<run-id>` 連結，並把路徑寫進契約檔 `evidence.restoreReceipt`。
- → `DEGRADED`：系統在跑但未完成受控復原（例如排程被提前重新啟用）。

## 驗證

```bash
node scripts/operating-state.mjs validate       # 契約合法？
node scripts/operating-state.mjs guard-schedule --purpose mutation   # 模擬排程閘門
node scripts/operating-state.mjs verify-docs    # README 狀態行一致？
```

`guard-schedule` 被擋時 exit 78 並輸出 `OPERATING_STATE_RECEIPT` JSON；
CI（`pr-check.yml`）會在每次 PR 檢查 validate + verify-docs。

## 不進契約的內容

收據只記 run URL 與判定結果；secrets、Cloudflare 憑證、事件細節
一律不寫入契約檔或收據。歷史 audit 報告保留原樣，被更新的收據取代時
在 `evidence.supersedes` 註明。
