# 人工更正 ledger（correlation overrides）

`correlation-overrides.jsonl` 是維護者對情報網關聯結果的**明示更正帳本**（issue #44）。
管線順序：`source data → normalize → automatic candidate relations → correction ledger → final network`，
每次 `build-network.mjs` / `fetch-live.mjs` 重建時重播，讓人工更正不被自動關聯覆蓋。

## 格式

每行一筆 JSON（JSONL），所有欄位必填（除註明外）：

```json
{"v":1,"decision":"not_same_event","ids":["twnews-abc","twnews-def"],"fingerprints":{"twnews-abc":"sha256:...","twnews-def":"sha256:..."},"reason":"兩案不同分局主辦","evidence":"https://... 或 issue/PR 連結","reviewedAt":"2026-09-17T00:00:00Z"}
```

| 欄位 | 說明 |
|---|---|
| `v` | schema 版本，目前固定 `1` |
| `decision` | `not_same_event` / `same_event` / `location_correction` / `follow_up` |
| `ids` | 穩定 `event.id`（不用標題）。pair 決策恰 2 個；`location_correction` 恰 1 個；`follow_up` 為 `[後續報導, 原始事件]` |
| `fingerprints` | 每個 id 對應 `curationFingerprint(event)`（title+summary+recordRef 的 sha256）；`location_correction` 必須用 `curationFingerprint(event, {withLocation:true})`（連 region/座標/精度/角色一起綁，否則上游把地點修對後舊更正會把正確值蓋回）。指紋不符 → 該筆轉 `needs_review`，不靜默套用 |
| `reason` | 人可讀理由 |
| `evidence` | 可追溯引用（連結／issue／PR），**勿存整篇新聞原文或個資** |
| `reviewedAt` | 人工審核時間（ISO-8601） |

`location_correction` 另帶 `location` 物件：`{"region"?, "lat"?, "lng"?, "locationPrecision"?, "locationRole"?}`，
只覆寫有給的欄位，且不改寫原始事件資料（patch 副本進 correlation）。
注意：`lat`/`lng` 必須成對；要讓更正後的座標進入距離分群，需同時給
`locationPrecision:"exact"/"address"` 與 `locationRole:"incident"/"arrest"`
（見 `scripts/lib/geo-policy.mjs` 的 `canClusterByDistance`）。

## 語意

- `not_same_event`：抑制該 pair 的自動邊，且在 union-find 階段阻擋兩者經第三事件被黏回同一 cluster。
- `same_event`：強制合併（注入高權重 `same-incident` 邊，`why` 標註「人工更正」）。若該合併會間接把 `not_same_event` 的 pair 黏回，合併被擋、邊移除、記錄轉 `needs_review`（`blocked-by-not_same_event`）。
- `follow_up`：斷言兩個不同事件——同時抑制自動合併，並輸出方向性關係到 `network.overrides.followUps.{domestic,international}`（`from`=後續報導、`to`=原始事件）。
- 衝突（同 pair 不同 decision、同 pair `follow_up` 方向互斥、同 id 不同 location payload）→ 記入 `overrides.report.conflicts`，**全部不套用**（fail closed）。
- 跳過（id 不存在 `event-not-found`、指紋不符 `evidence-changed`、跨 scope `cross-scope`）→ 記入 `overrides.report.skipped`，status `needs_review`；同 decision 的重複記錄採用第一筆新鮮的，其餘記 `superseded`。
- 稽核輸出見 `network.json` 頂層 `overrides`：`followUps` + `report.applied/skipped/conflicts/errors`；兩條 pipeline 路徑的 console 會印摘要，有 needs_review/conflict/error 時 `console.warn`。

## 產生 fingerprint

```sh
node -e 'import("./scripts/lib/curation.mjs").then(m=>{const e=/* 從 public/data/domestic.json 取事件 */;console.log(m.curationFingerprint(e))})'
```

或對單筆事件：`curationFingerprint(event)` 回傳 `sha256:...`；`location_correction` 用 `curationFingerprint(event, {withLocation:true})`。

ledger 路徑預設 `curation/correlation-overrides.jsonl`，可用環境變數 `CURATION_LEDGER_PATH` 覆寫（測試隔離用）。

## 規則

- 身份只用 `event.id` + fingerprint，**禁止用標題當永久 key**（標題會改）。
- 不存 secrets、個資、整篇新聞原文。
- 所有變更走正常 PR review；帳本本身就是 Git 歷史。
- `#43` ground-truth benchmark 可把 curated pair 當回歸證據，但不得全部變成 automatic holdout。
