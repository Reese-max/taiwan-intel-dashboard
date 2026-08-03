# 2026-08-03 關聯事件時序演變與地理聚集訊號

為關聯事件（情報群 cluster）補上「時序演變」與「地理聚集」兩組可驗證訊號，
由 `scripts/lib/cluster-signals.mjs` 在 build-time 計算、寫入 `network.json` 的每個 cluster，
前端只讀不重算。缺失時間／座標的資料採**可追溯降級**，不編造、不誤併。

## 新增產出（每個 cluster 多五個欄位）

| 欄位 | 型別 | 內容 |
|---|---|---|
| `temporalSeries` | `[{ ts, reports, sources }]` | 按時間排序的逐日（UTC）來源／報導數序列；`ts` 為日桶起點 |
| `firstSeenTs` / `lastSeenTs` | ISO 字串 | 群內**有效時間**成員的首／末觀測時間（原始格式，可回溯）；**全員時間缺失時省略欄位，不輸出空字串** |
| `geoClusters` | `[{ id, size, centroidLat, centroidLng, members }]` | 地理座標群集；`members` 帶每個成員的 `{id, lat, lng}` 座標佐證 |
| `degraded` | `{ missingTimestamp, missingCoordinates }` | 降級紀錄：被排除的成員數量與 id 清單 |

既有欄位（`latestTs`、`temporalSpanDays`）保持不變，新欄位為相加性，舊產物仍相容。

## 計算方法

- **時序序列**：取成員中 `Date.parse` 可解析的 `timestamp`，以 UTC 日切桶，累加報導數
  （`reports`）與不重複來源數（`sources`），按 `ts` 升冪輸出。
- **首末觀測**：有效時間成員依時間排序後取首尾原始 `timestamp`。
- **地理群集**：取成員中有限且非 `(0,0)` 的 `lat/lng`，以 Haversine 距離做**星狀（seed-based）聚集**
  （閾值預設 15km，可經 `CLUSTER_GEO_DISTANCE_KM` 調整）。種子點吸收距其 ≤ 閾值的點；
  刻意不用單連鎖，避免一條長鏈（例如沿路／沿線事件）被誤併成一團。單點也回傳（size 1），
  作為「地理上孤立」的可追溯佐證。質心取成員座標平均（5 位小數）。輸出先依座標排序再聚集，
  與輸入順序無關、可重現。

## 可追溯降級（不做錯誤合併）

| 資料缺損 | 處理 | 追蹤欄位 |
|---|---|---|
| 時間缺失或無效（含 `undefined`／非日期字串） | 不進 `temporalSeries` 與首末觀測 | `degraded.missingTimestamp = { count, ids }` |
| 座標缺失、非有限值或 `(0,0)` 佔位 | 不進 `geoClusters`、不估算座標 | `degraded.missingCoordinates = { count, ids }` |

**拒收根因對策**：當 cluster 全員時間缺失時，`firstSeenTs`／`lastSeenTs` 以省略欄位（undefined，
JSON 序列化後不存在）處理，並由 `degraded.missingTimestamp` 記下全部成員 id——絕不輸出空字串。
契約驗證（`scripts/lib/network-contract.mjs`）同步保證：欄位存在時必須是非空字串，空字串會被拒收。

## 驗證

- `tests/cluster-signals.test.ts`：序列排序與來源去重、首末觀測、全員時間缺失時省略欄位、
  降級計數與 id、(0,0) 佔位排除、星狀聚集防鏈接（west/mid/east 不誤併）。
- `tests/correlate.test.ts`：`correlateEvents` 產出的 cluster 帶新欄位，且缺失成員正確降級、
  全員時間缺失時 `firstSeenTs`/`lastSeenTs` 欄位不存在。
- `tests/network-contract.test.ts`：新欄位加入選用結構驗證；空字串 `firstSeenTs`/`lastSeenTs`
  被拒收（拒收根因回歸），省略欄位的降級產物通過。
- `npx vitest run` 全量綠；`npx tsc --noEmit` 通過。
