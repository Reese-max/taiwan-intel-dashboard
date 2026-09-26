# 關聯／地點 ground-truth benchmark（issue #43）

量測 correlation 與 location policy 修改的**真實品質**——不只靠 regression tests：
same-event precision/recall、false merge、missed relation、location-role/precision accuracy。

## 檔案

| 檔案 | 內容 |
|---|---|
| `pairs-v1-candidates.jsonl` | sampler 產生的待標註候選（`label` 留空） |
| `pairs-v1.jsonl` | **人工標註後**的 pair 資料集（metrics 的依據） |
| `locations-v1.jsonl` | 地點標註（role/precision/region + evidence） |
| `events-v1.json` | 被引用事件的 metadata 快照——固定此檔即可重播同一 benchmark |

所有檔案 committed → 固定 SHA 可重播。事件快照只含標註所需欄位，summary 截 300 字，
**不複製完整新聞全文**。

## 工作流程

```sh
# 1. 產候選（讀 public/data，需本機有資料快照）
node scripts/ground-truth-relations-sample.mjs --max=150 \
  --out=docs/ground-truth/relations/pairs-v1-candidates.jsonl \
  --events-out=docs/ground-truth/relations/events-v1.json

# 2. 人工逐行填標註：把候選複製/改名進 pairs-v1.jsonl，填 label/evidence/labeledAt/labeledBy

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
{"schema":"relation-pairs/1","a":"<eventId>","b":"<eventId>","family":"<故事族群key>","label":"same_event","evidence":"<可核對引用>","labeledAt":"ISO","labeledBy":"human","notes":""}
```

- `label`：`same_event` / `different_event` / `follow_up` / `same_original_report` / `uncertain`
- `family`：同一案件的轉載/後續共享同一 family → 切分時不會散到 tuning/holdout 兩側（防洩漏）
- `uncertain` 保留——不計入分母，只進 `uncertain` 計數；不強迫標註
- `labeledBy`：`human` 才算 ground truth；AI 整理候選可標 `agent-draft`（報表可區分，不得冒充人工）
- sampler 額外帶 `autoRelation`（系統當時的判斷）、`candidateSource`（`auto-edge`/`auto-cluster`/`same-region-unlinked`）、`ledgerDecision`（命中 #44 ledger 的 pair）

## location schema（`location-labels/1`）

```json
{"schema":"location-labels/1","event":"<eventId>","locationRole":"incident","locationPrecision":"exact","region":"高雄市","evidence":"<引用>","labeledAt":"ISO","labeledBy":"human"}
```

- `locationRole`/`locationPrecision` 值域同 `scripts/lib/geo-policy.mjs`
- 標 `unknown` 表示人工無法判定——不計錯也不計對，進 `unknownRate`

## 指標語意

| 指標 | 定義 |
|---|---|
| `sameEvent.precision` | 系統判同群的 pair 中，真 same_event/same_original_report 比例 |
| `sameEvent.recall` | 人工標 same_event/same_original_report 中被同群找回比例 |
| `falseMerge` | 標 `different_event`/`follow_up` 卻被併群的 pair 數與比例 |
| `missedRelation` | 相關標籤（same_event/follow_up/same_original_report）卻完全無邊的 pair |
| `follow_up` 命中 | 有邊但未同群才算對（同群計 false merge，無邊計 missed） |
| `splits` | 同 metrics 按 `tuning`/`holdout` 分算（family hash 決定） |
| `unknownRate` | 地點標註中 unknown 比例 |

第一版只建立 baseline，不設硬性 gate——門檻由實際 baseline 與錯誤成本決定。

## Hard negative 標註指引

候選盡量涵蓋（sampler 已混入未連線 pair）：同地不同事件、不同縣市同名道路、
同稿轉載、同題不同案、A-B/B-C 但 A-C 不相關、跨月後續、機關所在地 vs 案發地。

與 #41 audit 報告可互相引用，但 benchmark ≠ 50 Persona runtime 驗收。
#44 的人工更正可餵回當標註來源（sampler 打 `ledgerDecision`），但不得全沉到 holdout。
