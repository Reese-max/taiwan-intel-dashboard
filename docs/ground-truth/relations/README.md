# 關聯／地點 ground-truth benchmark（issue #43）

量測 correlation 與 location policy 修改的**真實品質**——不只靠 regression tests：
same-event precision/recall、false merge、missed relation、location-role/precision accuracy。

## 檔案

| 檔案 | 內容 |
|---|---|
| `pairs-v1-candidates.jsonl` | sampler 產生的待標註候選（`label` 留空） |
| `locations-v1-candidates.jsonl` | 40 個待人工核對的地點候選；系統判斷只列在 `suggested*` 欄位 |
| `pairs-v1.jsonl` | **人工標註後**的 pair 資料集（metrics 的依據） |
| `locations-v1.jsonl` | 地點標註（role/precision/region + evidence） |
| `events-v1.json` | 279 個候選端點／地點的審閱 metadata 與完整 cohort 的 SHA-256 manifest |
| `events-v1.cohort.json.gz` | 5,583 個新聞事件的完整 correlation 輸入 cohort，供重播所有橋接邊／群集 |

兩份事件檔必須一起固定 SHA；runner 驗證壓縮 cohort 的 SHA-256 和候選事件內容，
再從**完整 cohort** 重建網路，避免省略未標註的橋接事件。只保留 correlation／標註必要欄位，
不複製完整新聞全文；若任一新聞摘要超過 300 字，sampler 會拒絕不忠實的截斷重播。
manifest 也記錄抽樣時實際生效的 correlation 環境設定（cluster 門檻與同名實體 blocklist）；
重播設定不同時 runner 直接拒絕計分，避免把環境變化誤判為規則改善。
首版候選從 `pipeline-state` commit `1960451f621d344f4a35cf16bcf3ab5fcff99207` 的
`data/domestic.json`/`data/network.json` 產生；`events-v1.json` 另記兩份輸入的 SHA-256。
共 150 組 pair（75 已連線/同群、37 同區未連線、38 跨區同名地點）與 40 個獨立抽樣的地點候選，
審閱快照含兩類候選所引用的 279 個事件，重播 cohort 含全部 5,583 個新聞事件。
這些數字只描述**待標註候選**和重播輸入，不代表品質 baseline。

## 工作流程

```sh
# 1. 產候選（讀 public/data，需本機有資料快照）
node scripts/ground-truth-relations-sample.mjs --max=150 --seed=43 \
  --network=public/data/network.json \
  --out=docs/ground-truth/relations/pairs-v1-candidates.jsonl \
  --events-out=docs/ground-truth/relations/events-v1.json \
  --cohort-out=docs/ground-truth/relations/events-v1.cohort.json.gz \
  --locations-out=docs/ground-truth/relations/locations-v1-candidates.jsonl \
  --max-locations=40

# 2. 人工逐行填標註：把候選複製/改名進 pairs-v1.jsonl、locations-v1.jsonl，
#    核對來源後填 label/familyA/familyB/locationRole/locationPrecision/region/evidence/labeledAt/labeledBy

# 3. 跑 benchmark（對快照 deterministic）
node scripts/ground-truth-benchmark.mjs \
  --pairs=docs/ground-truth/relations/pairs-v1.jsonl \
  --locations=docs/ground-truth/relations/locations-v1.jsonl \
  --events=docs/ground-truth/relations/events-v1.json \
  --out=report.json

# 4. before/after：改規則後重跑並比對
node scripts/ground-truth-benchmark.mjs ... --baseline=report-before.json
```

## pair schema（`relation-pairs/1`）

```json
{"schema":"relation-pairs/1","a":"<eventId>","b":"<eventId>","familyA":"<a 的故事族群>","familyB":"<b 的故事族群>","label":"same_event","evidence":"<可核對引用>","labeledAt":"ISO","labeledBy":"human","notes":""}
```

- `label`：`same_event` / `different_event` / `follow_up` / `same_original_report` / `uncertain`
- `familyA`/`familyB`：**人工核對後**分別填入兩端事件的故事族群 ID；候選中的兩欄為空，`suggestedFamilyA/B` 是系統推測，絕不能直接作為切分依據。`same_event`、`same_original_report`、`follow_up` 需兩端同族群；同事件若在多筆標註得到不同族群，runner 會拒絕計分。`uncertain` 可留空，不必猜測。
- 負例若跨越不同 split，保留在全體指標但不進 tuning/holdout 任一側，另計 `crossSplitExcluded`；因此標註者須核對每個事件的族群，不能只給 pair 一個任意群組 ID。
- `uncertain` 保留——不計入分母，只進 `uncertain` 計數；不強迫標註
- `labeledBy`：僅接受 `human`／`agent-draft`；只有 `human` 進入 ground-truth metrics，草稿另行計數。不得把 AI 推測寫成 `human`。
- sampler 額外帶 `autoRelation`（系統當時的判斷）、`candidateSource`（`auto-edge`/`auto-cluster`/`same-region-unlinked`/`cross-region-local-entity`）、`ledgerDecision`（命中 #44 ledger 的 pair）。跨縣市同名道路等僅產生待審候選，絕不自動建邊。

## location schema（`location-labels/1`）

```json
{"schema":"location-labels/1","event":"<eventId>","locationRole":"incident","locationPrecision":"exact","region":"高雄市","evidence":"<引用>","labeledAt":"ISO","labeledBy":"human"}
```

- `locationRole`/`locationPrecision` 值域同 `scripts/lib/geo-policy.mjs`
- 標 `unknown` 表示人工無法判定——不計錯也不計對，進 `unknownRate`
- `locations-v1-candidates.jsonl` 從完整輸入事件獨立抽樣，標籤欄位留空；`suggested*` 與 `sourceIdentity` 只提供核對線索，不是人工 ground truth。審閱快照包含 pair 與 location 候選引用的聯集，指標則用完整重播 cohort 計算。人工標註的事件 ID 若不存在，runner 直接拒絕計分。

## 指標語意

| 指標 | 定義 |
|---|---|
| `sameEvent.precision` | 系統判同群的 pair 中，真 same_event/same_original_report 比例 |
| `sameEvent.recall` | 人工標 same_event/same_original_report 中被同群找回比例 |
| `falseMerge` | 標 `different_event`/`follow_up` 卻被併群的 pair 數與比例 |
| `missedRelation` | 相關標籤（same_event/follow_up/same_original_report）卻完全無邊的 pair |
| `follow_up` 命中 | 有邊但未同群才算對（同群計 false merge，無邊計 missed） |
| `splits` | 同 metrics 按 `tuning`/`holdout` 分算（兩端故事族群 hash 都相同側才納入） |
| `unknownRate` | 地點標註中 unknown 比例 |

第一版只建立 baseline，不設硬性 gate——門檻由實際 baseline 與錯誤成本決定。
目前 `pairs-v1.jsonl` 和 `locations-v1.jsonl` 是空檔，**尚無人工 baseline 或真實 precision/recall**。待人工標註、核對 story family、提交資料集 SHA 後才可產生並引用第一版數值。

## Hard negative 標註指引

候選盡量涵蓋（sampler 已混入未連線 pair）：同地不同事件、不同縣市同名道路、
同稿轉載、同題不同案、A-B/B-C 但 A-C 不相關、跨月後續、機關所在地 vs 案發地。

與 #41 audit 報告可互相引用，但 benchmark ≠ 50 Persona runtime 驗收。
#44 的人工更正可餵回當標註來源（sampler 打 `ledgerDecision`），但不得全沉到 holdout。
