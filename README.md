# 台灣情報儀表板（Taiwan Intel Dashboard）

聚合台灣國內外多源公開資料，以 LLM 正規化、風險評級、關聯分析，呈現為互動式情報視覺化網站。

- 狀態：**已暫停**（canonical 回應 HTTP 503；自動更新 workflow 已停用）
- 網址：<https://taiwan-intel-dashboard.pages.dev>
- 復原程序：[`docs/operations/pause-and-restore.md`](docs/operations/pause-and-restore.md)
- 技術棧：Vite + Vanilla TypeScript + Leaflet（唯一 runtime 依賴）｜資料層 Node.js ESM 腳本｜LLM 走 OpenAI 相容端點（現用 MiniMax-M2）｜部署 Cloudflare Pages｜CI GitHub Actions

## 資料管線（`scripts/fetch-live.mjs` 主控，`--sources=` 選擇）

| 來源 | 內容 | 說明 |
|---|---|---|
| `rss` | 國際新聞 | 443 feeds → LLM 正規化＋風險評級 → 滾動窗口累積（5 天/250 筆）|
| `gdelt` | GDELT 全球新聞索引 | GDELT DOC 近 24 小時補充訊號；失敗只告警，不覆蓋 RSS 主線|
| `twnews` | 台灣社會新聞 | 警政關鍵字預篩（食安/衛生/環境/資安來源走各自主題關鍵字）→ LLM 精修＋輕量收錄，保留窗 5 天 |
| `police` | 警政/治安 | 直連警政署犯罪資料統計週報；含 hourly 歷史、來源樹 |
| `missing` | 失蹤人口 | 直連警政署公開協尋名單 |
| `cwa` | 氣象（地震/警特報）| 需 `CWA_API_KEY` |
| `mofa` | 外交部旅遊警示 | 官方 RSS；狀態型快照，不受 5 天新聞窗淘汰 |
| `ncdr` | NCDR 災防示警 | 官方 Atom + CAP 1.2 |
| `mnd` | 國防部臺海周邊海空域動態 | 官方每日動態 |
| `cdc` | 疾管署類流感急診趨勢 | 官方週資料；每日完整刷新 |
| `tfda` | 食藥署邊境查驗不符合食品 | 官方開放資料；近 30 天 |
| `cga` | 海巡署海巡新聞 | 海域執法、救援、走私與偷渡事件 |
| `twcert` | TWCERT/CC 漏洞公告 | 官方 TVN RSS |
| `taipower` | 台電系統供需 | 每 10 分鐘更新 |
| `wra` | 水利署水庫水情 | 收錄蓄水率低於或等於 70% 的水庫 |
| `wraRiver` | 水利署即時河川水位 | 測站警戒值彙整至縣市 |

失敗容錯：單源失敗沿用上一版快照（carry-over），不以空資料覆蓋。

完整性界線：主畫面是「可驗證、可排序的新鮮事件層」，不是把所有政府資料集灌成事件。每輪另產生 `public/data/domain-coverage.json`，將領域分成「已整合、參考層、僅查詢、缺口」。移除第三方 MCP 後，採購、司法、空品、停車、經濟等原 MCP 來源不再刷新，待改成官方直連後再恢復。

## CI 排程（`.github/workflows/update-and-deploy.yml`）

> 目前 workflow 為手動停用狀態。完成資料膨脹修正的受控上線驗證前，不要重新啟用。

- 每 30 分（:05/:35）：cwa+police+missing+twnews+rss+gdelt+mofa+ncdr+mnd+cga+twcert+taipower+wra+wraRiver 增量
- 每日 18:30 UTC（台北 02:30）：上述來源加上 cdc、tfda 的 exclusive 重建
- 手動 `workflow_dispatch`：`mode` 選來源組合；`renorm_intl=true` 忽略國際快取全量重評（緊急用；平時靠 `INTL_RECALIBRATE_DAYS` 3 天生命週期自然換血）
- Cloudflare 發佈後會再讀取 canonical `provenance.json`／`domain-coverage.json`；refresh 模式另強制確認金融 `11598` 與勞動 `123349` 已落地，避免部署成功但資料仍是舊快照。

## 本地開發

```bash
npm install
cp .env.example .env   # 填 LLM_API_KEY 等
npm run dev            # 前端 dev server
npm test               # vitest 全套
npm run build          # tsc + build-network + build-static → dist/
npm run refresh:news   # 抓台灣新聞（吃 LLM 成本）
node --env-file=.env scripts/fetch-live.mjs --sources=rss,gdelt   # 抓國際 RSS＋GDELT 補充
```

## 稽核（CI 皆有掛）

```bash
npm run audit:intl-risk        # 國際風險分布病態偵測（high 洗版/low 被洗光）
npm run audit:data-size        # 資料檔尺寸（Cloudflare Pages 單檔 25MiB 上限預警）
npm run audit:network-quality  # 情報網品質
npm run audit:source-freshness # 結構化來源成功時間與更新頻率健康閘門
npm run audit:coverage         # scope/category 每日涵蓋矩陣一致性
npm run report:news-sources    # 新聞來源漏斗貢獻報表
```

## 重要環境變數（完整見 `.env.example`）

| 變數 | 用途 |
|---|---|
| `LLM_API_KEY/BASE_URL/MODEL` | 主 LLM（正規化＋摘要）|
| `LLM_FALLBACK_*` | primary 失敗時備援端點（可選）|
| `SUMMARY_*` | 摘要獨立端點（可選）|
| `INTL_RECALIBRATE_DAYS` | 國際快取評級生命週期（預設 3 天，0 停用）|
| `GDELT_QUERY/TIMESPAN/MAX_RECORDS/TIMEOUT_MS` | GDELT DOC 補充查詢、時間窗、筆數上限與逾時（可選）|
| `NEWS_RETENTION_DAYS` | 台灣新聞保留窗（預設 5 天）|
| `CWA_API_KEY` | 中央氣象署 API key |

## 文件索引

- `docs/operations/` — 線上暫停、驗證與復原程序
- `docs/specs/` — 設計/規格（含 2026-07-03 強化與可持續性計畫）
- `docs/plans/` — 實作計畫
- `docs/reports/` — 診斷報告（含新聞來源漏斗診斷）
