抽樣：`node scripts/ground-truth-sample.mjs --per-cell=5 --seed=42 --date=YYYYMMDD` 會讀 `public/data/domestic.json` 並輸出 `docs/ground-truth/sample-YYYYMMDD.jsonl`。
填標註：逐行填 `human_category`（前端 11 類：治安 社會 反詐 災防 採購 協尋 交通 食安 衛生 環境 資安）與 `human_risk`（low/medium/high/critical），`notes` 可留備註。
計分：`node scripts/ground-truth-score.mjs --file=docs/ground-truth/sample-YYYYMMDD.jsonl` 會輸出 category/risk 一致率、嚴重低估率與混淆對 top 10。

關聯／地點品質 benchmark（issue #43）見 `relations/README.md`。它以固定事件 metadata snapshot 重播既有 `correlateEvents` 政策，候選包含已連線與未連線 pair，另附 40 筆地點標註候選；`pairs-v1.jsonl` 與 `locations-v1.jsonl` 只接受人工填寫的 ground truth，`agent-draft` 不會計入指標。
