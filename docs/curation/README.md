# 人工更正 Ledger（correlation-overrides.jsonl）

`correlation-overrides.jsonl` 是情報網的人工更正帳本：維護者對「錯誤關聯、地點角色、
後續關係」做過明確確認後，寫成一行 JSON 記錄進本檔；之後每次 pipeline rebuild
（`npm run build` 的 `build-network.mjs`，以及 `fetch-live.mjs` 的 live 更新）都會重新
套用，已確認的錯誤不再復發。

Pipeline 位置：

```
source data → normalize → 自動候選關聯 → correlation ledger → 最終 network
```

## 記錄格式（JSONL：每行一筆 JSON；`#` 開頭為註解）

| 欄位 | 說明 |
| --- | --- |
| `schemaVersion` | 目前為 `1` |
| `id` | 人工記錄 id（如 `cur-2026-09-30-notsame-001`），審計與前端 tooltip 引用 |
| `decision` | `not_same_event`／`same_event`／`location_correction`／`follow_up` |
| `subjects` | 穩定 **event id**（`twnews-*`／`intl-*`）。pair 決策需 2 個、`location_correction` 需 1 個。**不接受自由文字標題** |
| `expect` | `{ "<eventId>": "<sha256>" }`——記錄審核當下看到的來源版本指紋；上游內容（標題／地區／時間／來源）一改動，該筆自動轉 `needs_review`，不會默默套用到不同內容 |
| `reason` | 判斷理由（審計用，會出現在邊的 why 說明） |
| `evidence` | 可追溯證據的參照（連結／出處）；**勿存完整文章原文、個資或 secrets** |
| `reviewedAt` | ISO8601 人工審核時間 |
| `rulesVersion` | 與 `scripts/lib/manifest.mjs` 的 `RULES_VERSION` 對齊；規則改版後舊記錄自動轉 `needs_review` |
| `benchmark` | 選填 `none`（預設）／`tuning`／`holdout`。#43 benchmark 只會引用明確標記的記錄，curated pair 不會全部自動變 holdout |
| `patch` | 僅 `location_correction` 需要：`{ region?, locationRole?, locationPrecision?, lat?, lng? }`（lat/lng 需成對）。只改衍生層呈現與地理群集，不改原始資料 |

`follow_up` 的 `subjects` 順序即方向：`[較早報導, 後續報導]`，產生 `follow-up` 有向邊
（綠色虛線，可於關聯線分析控制開關），不併入情報群。

## 決策效果

- `not_same_event`：移除該 pair 的自動邊，且 union 階段加入 cannot-link——即使兩事件
  各自與第三者有邊，也不會透過中繼被併入同群。
- `same_event`：高權重 `same-incident` 邊（`origin:"manual"`，附 `curationId`），優先於
  任何自動候選；兩事件進同一群集。
- `location_correction`：`patch` 套用到該事件的衍生副本與 network 節點（附
  `curated` 標記），地理群集資格／degraded 桶依更正後的角色重新計算。原始
  `domestic.json`/`international.json` 事件內容不被改寫。
- `follow_up`：新增 `follow-up` 邊（`origin:"manual"`、`from`/`to` 有向），不併群。

## 狀態與安全（fail closed）

每筆記錄解析後落於 `applied`／`needs_review`／`conflict`／`invalid` 之一，審計結果寫在
`network.json` 的 `<scope>.curation`（`decisions` 逐筆、計數、被移除的自動邊、被否決的
union）。規則：

- subject 不存在（事件已下架或 id 錯誤）→ `needs_review`，不套用。
- `expect` 指紋不符（同連結換標題、內容改版）→ `needs_review`，不套用。
- `rulesVersion` 不符 → `needs_review`，不套用。
- 同一 pair 的矛盾決策（例：`same_event` × `not_same_event`、反向 `follow_up`）或同主體
  不同 `patch` → 全部標 `conflict`，**雙方都不套用**，自動產物原樣輸出；不採
  last-write-wins。
- 欄位缺失／非法 → `invalid`，不套用（`npm run audit:curation` exit 1）。

`needs_review`／`conflict`／`invalid` 都需要人工回到本檔修正後重送 PR。

## 操作流程

1. 先跑一次 `fetch-live`（或 CI restore-state）產生 `public/data/domestic.json` 等快照。
2. 找到要更正的事件 id（網頁卡片、`public/data/*.json`、或 `cluster`/`edges` 的 `a`/`b`）。
3. `node scripts/curation-ledger.mjs fingerprint <id> [<id>...]` 產生 `expect` 指紋。
4. 在本檔新增一行記錄（格式如上），送 PR 走一般 code/data review。
5. `node scripts/curation-ledger.mjs check`（或 `npm run audit:curation`）驗證解析結果。

## 邊界（不做的事）

不做公開匿名編輯、不做帳號／權限系統、不做多人審批平台、不建大型 curation 資料庫。
Ledger 是隨程式碼版本化的文字檔，變更一律走 PR 與 git history。
