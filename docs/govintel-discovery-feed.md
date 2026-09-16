# GovIntel Discovery Feed（issue #25）

Taiwan Intel Dashboard 是 **Radar / Discovery** 層；GovIntel 是 **Verification / Workflow** 層。
兩者不互相爬 UI——Dashboard 產出一個穩定、可版本化、唯讀、有界的 discovery feed，
GovIntel 只消費這個 feed，不下載完整 `domestic.json`。

## 產出

```
npm run feed:govintel        # → public/data/govintel-discovery.json
```

輸入：`public/data/domestic.json`＋ `ops/operating-state.json`（#17 契約）。
Schema：`schemas/govintel-discovery.v1.schema.json`（`schema_version: 1`）。

## Envelope

```json
{
  "schema_version": 1,
  "generated_at": "ISO8601",
  "operating_state": "ACTIVE|DEGRADED|RESTORING|PAUSED",
  "stale": true,
  "operating_state_source": "contract|contract-missing-or-invalid",
  "source_snapshot_hash": "sha256:...",
  "window": {"since_hours": 72},
  "truncated": false,
  "item_count": 200,
  "excluded_counts": {"out_of_window":0,"category_filtered":0,"no_source_identity":0,"duplicate_source":0},
  "items": []
}
```

## Consumer 規則（GovIntel 必讀）

1. **fail closed on state**：`operating_state !== "ACTIVE"` 或 `stale === true` 時，
   不得把 feed 當 current/live；契約缺失時 producer 也會輸出 `PAUSED`。
2. **authority 邊界**：`authority=media` 永遠只是 `DISCOVERY_UNVERIFIED`，須另找官方來源才能升 confirmed；
   `authority=official` 也只是「取得路徑」，Dashboard 不算第二個獨立官方佐證。
   判定沿用 repo 既有定義（`audit-coverage.mjs`）：`source.authority==="official"` 或
   `source.type ∈ {gov-open-data, cwa}` → official；其餘一律 media。
   聚合新聞（google-news-rss）的 `source_url` 是聚合頁，非原始報導連結。
3. **同源去重**：以 `original_source_identity` 去重——direct 官方取得與 Dashboard 取得的
   同一筆 CWA/NCDR/警政紀錄會有相同 identity，只計一個來源。
   聚合新聞（如 Google News RSS）的 identity 是 `media:<publisher>:<title-hash>`。
4. **LLM 欄位**：`summary / risk_level / entities / topic` 是 discovery metadata，
   不可直接變成 verified fact 或公務優先級。
5. **truncated=true**：表示達到 item/byte 上限，consumer 不得假設已見全部事件。
6. **rights_status**：`OPEN_DATA` 可引用；`REVIEW_REQUIRED`（媒體與無授權標示的來源）
   不得全文轉散布，走 link-only。

## 選擇政策

- 只輸出最近 `DISCOVERY_WINDOW_HOURS`（預設 72h）內、`scope=domestic` 的項目。
  窗口判定以 `timestamp`（event_time）為主；事件時間缺失時退回 `source.fetchedAt`（observed_at），
  兩者皆無法解析的項目排除（`excluded_counts.out_of_window`）——無法界定窗口的資料不出現在 bounded feed。
- 事件時間未知但觀察時間在窗內的項目仍收錄，`event_time=null`（依 issue 規格「未知保持 null」）。
- `operating_state` 依 #17 `ops/operating-state.json`；契約缺失/無效/自稱 ACTIVE 但缺
  `evidence.restoreReceipt` → fail closed 為 `PAUSED` + `stale:true`。
- 注意：`協尋`（失蹤人口）不在預設白名單——其 `source.url` 是當事人照片連結，
  要用 `DISCOVERY_CATEGORIES` 打開前需先過隱私評估。
- 預設類別白名單：`治安, 反詐, 災防, 交通, 資安`（可用 `DISCOVERY_CATEGORIES` 覆寫）。
- 缺 source URL 且缺 record identity 的項目 fail closed：不進 feed，計入 `excluded_counts.no_source_identity`。
- 排序 deterministic：`event_time` 新→舊（null 排最後），同刻以 `discovery_id` 字典序；
  同一輸入快照重跑得到相同 item IDs/order（`generated_at` 除外）。
- 上限：`DISCOVERY_MAX_ITEMS`（預設 200）＋ `DISCOVERY_MAX_BYTES`（預設 256KB）；
  超過一律截斷並標 `truncated`，不默默養大檔。

## discovery_id

`gd-<sha256(datasetId|recordRef|title) 前 16 hex>`——穩定、可重播、不用陣列 index。

## 不變更既有 pipeline

此 feed 是獨立產出物；`fetch-live.mjs`、UI、`domestic.json` 行為不變。
排程整合是 ops 決策：建議在 refresh loop 之後加 `npm run feed:govintel`，
但須等 #17 operating-state 契約合併後，feed 才能反映真實 ACTIVE 狀態。
