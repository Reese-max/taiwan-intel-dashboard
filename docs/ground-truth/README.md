抽樣：`node scripts/ground-truth-sample.mjs --per-cell=5 --seed=42 --date=YYYYMMDD` 會讀 `public/data/domestic.json` 並輸出 `docs/ground-truth/sample-YYYYMMDD.jsonl`。
填標註：逐行填 `human_category`（前端 11 類：治安 社會 反詐 災防 採購 協尋 交通 食安 衛生 環境 資安）與 `human_risk`（low/medium/high/critical），`notes` 可留備註。
計分：`node scripts/ground-truth-score.mjs --file=docs/ground-truth/sample-YYYYMMDD.jsonl` 會輸出 category/risk 一致率、嚴重低估率與混淆對 top 10。

關聯／地點 benchmark（#43）見 [relations/README.md](relations/README.md)：版本化 metadata、150 組 pair 與 40 筆地點候選、deterministic runner、before/after 與錯誤來源。人工標註尚未提供，狀態為 `needs_review`；候選與 `agent-draft` 不會計入人工 ground truth。
