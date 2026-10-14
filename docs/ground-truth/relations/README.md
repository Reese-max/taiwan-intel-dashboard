# 關聯／地點 benchmark（#43）

狀態：**`needs_review`，尚未建立人工 baseline**。已入庫 150 組真實新聞 pair 候選、40 筆地點草稿與 276 筆 metadata；`pairs-v1.jsonl`、`locations-v1.jsonl` 目前為空。AI 草稿與空白標註不會被當成人工 ground truth，不設 95% gate，也不宣告 CLEAN。

## 資料與版本

| 檔案 | 用途 |
|---|---|
| `events-v1.json` | `ground-truth-events/1`，固定事件 id、來源 URL／identity、標題、短摘要與既有正規化 prediction |
| `pairs-v1-candidates.jsonl` | 150 組待人工填寫的 pair，75 組既有邊／群集與 75 組未連線候選 |
| `locations-v1-candidates.jsonl` | 40 筆 `agent-draft`，帶來源 evidence；未覆核前不計分 |
| `pairs-v1.jsonl` | `relation-pairs/1`，人工標註集；目前 0 筆 |
| `locations-v1.jsonl` | `location-labels/1`，人工地點標註集；目前 0 筆 |
| `*-v1.schema.json` | 標註的 JSON Schema；runner 另驗證重複鍵、事件引用與切分洩漏 |

資料重用自本 repo 的歷史 commit `81ad6bb21094ad683344f6cb2b549251ac4ae5d5`，不是新抓取的線上快照。新聞日期範圍為 2026-09-10 至 2026-09-16，短摘要最多 200 字，沒有完整新聞全文。這版 snapshot 沒有 `aiTopic` 或 `locationRole`；不能推定缺少角色就是案發地，也不能聲稱它完整重現當時線上輸入。新 sampler 保留 `correlateEvents` 所讀的欄位（含 `aiTopic`），摘要最多 300 字，評估的是這份固定 metadata。

候選已按共同事件、來源 URL 與既有 family 合併，修正歷史候選中跨 family 的事件。`family` 由人工確認同案件／故事族群；不同 URL 的同案轉載仍須人工合併，程式不能替代此審查。保守合併可能減少獨立族群數；不得為湊兩個 split 把同一故事拆開。

## 重播與操作

```bash
# 本機有已核對來源快照時，產生新一版候選與 metadata（不覆寫 v1）
node scripts/ground-truth-relations-sample.mjs --max=150 --seed=43 --date=20261014 \
  --out=docs/ground-truth/relations/pairs-v2-candidates.jsonl \
  --events-out=docs/ground-truth/relations/events-v2.json

# 人工標註後跑 baseline；現有空白集會明確輸出 needs_review／n/a
node scripts/ground-truth-benchmark.mjs \
  --pairs=docs/ground-truth/relations/pairs-v1.jsonl \
  --locations=docs/ground-truth/relations/locations-v1.jsonl \
  --events=docs/ground-truth/relations/events-v1.json \
  --out=tmp/benchmark-before.json

# 改 policy 後，同一組來源／標註重跑，輸出指標與錯誤樣本的改善／退化
node scripts/ground-truth-benchmark.mjs \
  --pairs=docs/ground-truth/relations/pairs-v1.jsonl \
  --locations=docs/ground-truth/relations/locations-v1.jsonl \
  --events=docs/ground-truth/relations/events-v1.json \
  --baseline=tmp/benchmark-before.json --out=tmp/benchmark-after.json

npm test -- tests/ground-truth-relations.test.ts tests/ground-truth-benchmark.test.ts tests/ground-truth-benchmark-evidence.test.ts
npm run check
```

固定候選、標註、metadata 與程式 commit SHA（例如在 driver 的 detached worktree 重播）可重現相同 JSON。報告不含執行時間；`inputHashes` 對 CRLF/LF 正規化後雜湊，`policy` 包含規則版本、相依模組雜湊與五個關聯／地理政策環境設定。不要把其他環境變數或 credentials 放進報告。改 dataset/schema 時另開 `v2`，不要改寫已引用的 baseline。

`--predictions=<json>` 可提供與來源快照具有相同事件集合、完全相同非地點欄位的正規化快照，只允許地點欄位變動。runner 重跑既有 `correlateEvents`，地點準確率則比較提供的正規化 prediction；它**不會自行呼叫 LLM 或重新推論地點**。報告記錄 `predictionsHash`；產生 prediction 的上游程式／模型版本與設定，須由報告持有人另行記錄。修改地點政策後要先取得新 prediction，再以同一來源和人工標註比較；只修改 `geo-policy.mjs` 不會自動產生新的角色標註。

錯誤標註、重複鍵、缺少事件或 split 洩漏使報告 `status=invalid`、CLI exit 1。`--baseline` 拒絕不同來源／標註的 input hashes 或 invalid 報告，避免把不同樣本的分數當成改善。空白／非人工資料仍可產出 `needs_review` 報告，exit 0 表示 runner 正常，並不表示 baseline 已成立。

## 標註與切分

```json
{"schema":"relation-pairs/1","a":"<eventId>","b":"<eventId>","family":"<故事族群>","label":"same_event","evidence":"<來源 URL 與可核對的簡短理由>","labeledAt":"2026-10-14T00:00:00Z","labeledBy":"human"}
```

pair label 保留 `same_event | different_event | follow_up | same_original_report | uncertain`。資訊不足就用 `uncertain`，不得強迫變正／負例。`a/b` 指向 snapshot 的來源 URL 與 identity；evidence、時間與 schema 缺少時拒收。

```json
{"schema":"location-labels/1","event":"<eventId>","family":"<故事族群>","locationRole":"agency","locationPrecision":"city","region":"臺北市","evidence":"<來源 URL 與機關所在地／案發地判斷依據>","labeledAt":"2026-10-14T00:00:00Z","labeledBy":"human"}
```

角色／精度值域重用 `geo-policy.mjs`。人工逐筆核對來源後，才可將候選移入標註集並填 `labeledBy=human`；AI 協助整理須保留 `agent-draft`。地點草稿的時間是草稿來源時間，不是人工覆核時間，提升時須重填。

同 family 固定 hash 到 `tuning/holdout`。可選 `benchmark:"tuning"|"holdout"` 使用已核准的指定 split；同 family、事件或完全相同來源 URL 不得跨 split，pair 與 location 也一起檢查。人工必須補足不同 URL 的同稿／同案隔離，runner 不會猜它們是同一故事。

sampler 使用現有 `loadCurationLedger`／`ledgerBenchmarkEvidence`，只引用明確標 `benchmark=tuning|holdout` 的 ledger pair（`ledgerId/ledgerDecision/benchmark`），不自動填 label，也不把 ledger 答案套入 benchmark prediction。人工更正不是免費的 holdout。

## 指標與樣本

| 輸出 | 定義 |
|---|---|
| `sameEvent.precision/recall` | `same_event/same_original_report` 為正例，系統同群為同案預測；直接邊未成群仍是同案 FN |
| `falseMerge.count/total/rate` | `different_event/follow_up` 卻被併群；保留 pair 與 evidence |
| `missedRelation.count/total/rate` | 正例／follow_up 無同群或 `same-incident/follow-up` 邊；單純同題／同實體線索不算找回 |
| `sameEventFalseNegativeSources` | 所有同案 FN 的來源，包括有直接邊但未成群的 FN |
| `location.role/precision/region` | 各維度 correct/total/accuracy 與錯誤事件／evidence |
| `uncertainRate` | 人工 pair 中 uncertain 比例；不進正負例分母 |
| `unknownRate` | 人工地點 row 的角色／精度中，人工或 prediction 有 unknown／缺值的比例 |
| `splits` | relation 與 location 都分 tuning／holdout 計算 |
| `diff/errorChanges` | 各指標改善／退化與錯誤樣本 introduced／resolved |

unknown／缺值不計成功或錯誤，只排除該維度並報覆蓋量；region 為未知也不進 region 準確率分母。沒有可計分資料時 rate/accuracy 為 `null`，不能解讀成 0% 或 100%。unknown／uncertain 覆蓋量變化不會被標成品質退化。

## 驗收對照與尚缺工作

| #43 驗收 | 機制／狀態 |
|---|---|
| dataset/schema/versioning，可固定 SHA 重播 | 已入庫 metadata、150/40 候選、v1 schemas；**人工標註集仍為空** |
| tuning/holdout 故事族群隔離 | family、事件、同 URL 跨 split 拒收；已修復候選洩漏；不同 URL 同故事仍待人工確認 |
| deterministic runner | 同輸入／policy 報告相同，metadata/label/policy 指紋，CLI 重播測試 |
| before/after 指出改善與退化 | 指標方向、FP/FN／地點樣本來源及 introduced/resolved；合成測試已驗證 |
| FP/FN 樣本來源，包含未連線候選 | 75 組未連線候選；runner 同案 FN／false merge／missed relation 都附 evidence |
| role/precision 可核對，unknown/uncertain 排除 | source URL、evidence 必填，非人工不計分；**40 筆草稿尚待人工覆核** |
| #41 audit 互相引用 | 本文件連結下列 audit；benchmark 不是 50 Persona runtime 驗收，不自動回寫 audit |

sampler 包含近期同地未連線、不同縣市同名地點、同題／同稿、同群無直接邊，以及跨月具名實體候選通道。這些通道與 A-B/B-C→A-C false merge 都有合成回歸測試，**合成測試不能算真實人工 benchmark**。

首版真實候選只跨一週，沒有跨月 pair。人工審閱時仍須補齊並確認 hard negatives：同地不同事件、跨縣市同名道路、同稿轉載、同題不同案、A-B/B-C 但 A-C 不相關、跨月後續，以及機關所在地 vs 案發地。確認前不宣稱上述 strata 已完整涵蓋，也無法交付可解讀的人工 precision/recall baseline。

相關：[Issue #41](https://github.com/Reese-max/taiwan-intel-dashboard/issues/41)、[50-Persona Round 4](../../audits/50-persona-round-4-2026-09-17.md)、[curation ledger](../../curation/README.md)。audit 可引用這份 benchmark 的資料／報告 SHA；兩者的驗收證據分開保存。

本輪另外修正 `tests/curation-rebuild.test.ts` 的 `--import` 路徑為 file URL；修改前全套已重現 Windows `ERR_UNSUPPORTED_ESM_URL_SCHEME`，不變更正式 runtime。

本輪驗證：修改前 998 通過／1 失敗；修改後 Git Bash `npm run check` exit 0，1025 個測試通過、0 失敗，typecheck 與 build 通過。26 個 benchmark 測試含先 red 後 green 的案例；真實候選 CLI 連跑兩次 JSON 完全相同，150 個空白 pair／40 個草稿均未計入人工分數。專案目前未配置 lint、coverage ratchet、CRAP 或 mutation 指令，本輪未新增這些工具。未 push、PR、部署或執行 #41 runtime 驗收。
