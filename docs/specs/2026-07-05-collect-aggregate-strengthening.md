# 蒐集與彙整能力強化計畫（collect → aggregate backbone）

- 日期：2026-07-05
- 狀態：規劃（待逐項執行）
- 來源：6 面向平行評估實際管線（蒐集廣度/可靠度、去重實體解析、關聯聚類、LLM 彙整、分類）收斂

## North Star
把儀表板從「靠新聞關鍵字猜、事件各自為政、故障無聲」升級為「**官方一手結構化訊號進料 → 故障可見且會升級的可靠管線 → 語意去重後的 canonical 可信情報網**」，全程維持 build-time 算好寫靜態 JSON、不引後端、LLM 花費只花在真的變動的內容上。

## 地基（Foundations，必須最先做，多數後續項依賴）
| # | 地基 | 誰依賴它 | effort |
|---|---|---|---|
| F1 | **跨輪共享狀態庫**（generalize police-hourly-history 的 file-based ledger + partitionByCache，落一份 gh-pages state/health.json） | Phase2 新鮮度看門狗、normalizeFailed 連續計數、來源枯竭偵測、Phase4 canonical entity 穩定 id、Phase5 群成形軌跡 | M |
| F2 | **共用 titleKey 模組 + 修 slice(0,40) 前綴碰撞**（news-bulk 與 nvidia 兩份重複、硬切 40 字假合併模板長標題） | Phase4 近似去重、corroboration 來源計數 | S |
| F3 | **事件級 riskBasis/classifiedBy 標記 + provenance 加 enrichment 品質區塊**（座標填充率/aiTopic 非空率/groundedRatio/risk 分布/reused-fresh 比） | Phase2 rollup、Phase4 分類器稽核、前端可解釋面板 | S |

## Phase 1 — 接線與確定性替換（止血；最低成本、最高 ROI、多半省 LLM）
| 項目 | 價值 | eff/risk |
|---|---|---|
| **threatActors/relations 接進 correlate** | 花 token 抽出卻 correlate/UI 全不讀＝白抽；接成 same-actor 邊+typed edge。**全案最高 ROI** | S/低 |
| canonicalizeLink 去 GN 轉址重複 | 同 story 經 GN 轉址與直連＝兩 id，灌水事件+快取穿透重送燒 prepaid；剝 wrapper+去 utm | S/低 |
| domestic 座標改 COUNTY_CENTER 查表取代 LLM 猜 | LLM 回的 lat/lng 可能落海/指錯縣市；查表更準且省輸出 token | S/低 |
| riskLevel 確定性地板/天花板 + bulk 補 critical 分支 | domestic 全信 LLM 逐批、riskFromTitle 無 critical 分支＝重大傷亡鎖在 high 下 | S/中 |
| 每日/群摘要輸入依 risk×recency 排序再 slice | briefEvents 直接 slice(0,20)＝critical 排 20 後就不進摘要 | S/低 |
| 實體抽取器修街道/機關泛名誤配 | 街道假實體+機關泛名把同機關新聞黏成團＝最便宜的 megablob 膠水削減 | S/低 |

## Phase 2 — 可觀測性與新鮮度看門狗（先讓故障看得見，再擴充來源）
| 項目 | 價值 | eff/risk |
|---|---|---|
| audit-source-freshness 消費 lastSuccessAt/stale | 一源可連數十輪失敗永遠餵 stale 舊資料而 CI 全綠；算 age 分級 warn→fail | S/低 |
| Hourly gate 補 police/twnews require + police minimum 轉 warn | 現只 require cwa+international，police/twnews 全掛照樣部署 | S/中 |
| normalizeFailed 連續失敗計數升級 | LLM 端點連掛一天整天靠快取似正常實則凍結；連續≥閾值升 fail | M/中 |
| 零產出來源 emit + 連續 K 輪枯竭偵測 | provenance 迴圈 count=0 被 continue 吞掉，與未設定無法區分 | M/低 |
| 汰換低貢獻來源迴圈 + 合併重疊 gq 查詢 | lowContributionFeeds 已算卻無汰換機制，死來源佔成本 | S/低 |
| RSS fetchOne 加有界重試 + 告警 + 失敗路徑保留窗修剪 | 單次 12s 無重試、瞬斷掉整條 feed | S/低 |

## Phase 3 — 一手結構化來源擴充（把稀疏類/國安從「猜新聞」升級為官方 API；全比照 fetch-cwa、自帶座標、可並行）
CDC 傳染病（消滅衛生稀疏）、FDA 食安邊境查驗/回收、NCDR/CWA CAP 災害示警、TWCERT/CC 台灣資安 RSS（S）、國防部共機擾台每日動態。各 M/低（MND 中）。

## Phase 4 — 去重、實體解析與分類治理（可信情報網的基礎）
| 項目 | 價值 | eff/risk |
|---|---|---|
| LLM 富化欄位確定性接地過濾（groundedRatio） | threatActors/relations 從不核對是否真在原文＝MiniMax 杜撰汙染關係圖；子字串比對命中才留 | M/中 |
| 近似去重 bigram-shingle 合併 + sources[] | exact-match 讓同事件不同改寫各成獨立事件灌水；Jaccard+同日同 region 收斂 | M/中 |
| corroboration 改吃合併後 sources[] | 現只從 same-incident 邊回推＝易漏易誤；改以 dedup 保留的跨媒體 sources[] 為一級 | M/中 |
| canonical entity registry（跨輪穩定 id）+ typed edges | 俄羅斯/俄國/Russia exact-match 各算不同實體；surface form 正規化+別名對照 | L/中 |
| 分類器一致性稽核（規則 vs LLM 混淆矩陣） | 兩套分類器切同流互不知情、無交叉驗證 | M/低 |
| 稀疏類內容分類 + 多標籤 + OOV telemetry | TOPIC_RE 從 hint-gated 改無條件內容分類（治安 feed 裡的食安永遠分成治安＝稀疏真因） | M/中 |

## Phase 5 — 聚類重構與情報網軌跡（風險最高、放最後、先跑 idle baseline 校準門檻）
same-entity union 收緊（megablob 頭號根因：對所有 same-entity 邊無條件 union）、aiTopic canonicalize 分桶（1023 topic 85% singleton）、群純度/連貫度指標+雜燴群攔截、社群偵測(Louvain/k-core)取代純 union-find、same-incident 時間直徑控制（防長 saga 無限延伸）、群成形速度軌跡（emerging/surging/cooling，使用者明確要的維度）。

## 整體取捨（note）
- **靜態 vs 後端**：44 項幾乎全 build-time 靜態可行；僅 canonical entity registry 與群軌跡靠 F1 跨輪狀態庫（沿用既有 gh-pages ledger 模式）、故障告警走 GITHUB_TOKEN 開 Issue（純通知不阻斷）。不破壞 Cloudflare Pages + Actions 架構。
- **LLM 成本是排序關鍵**：Phase1 幾乎每項零成本或省錢（連結正規化消滅快取穿透重送、座標查表移除 token、摘要排序），刻意前置省錢項。
- **先做什麼**：地基（F1/F2/F3）最先 → Phase1（已花錢/已存在卻沒接的線，最高 ROI）→ Phase2 可觀測性（先讓故障看得見再加源）→ Phase3 擴充 → Phase4 → Phase5（動搖 network 結構、最後做、idle baseline 校準 + audit-network-quality 前後守住品質）。
