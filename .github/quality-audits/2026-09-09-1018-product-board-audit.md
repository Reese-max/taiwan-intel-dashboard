# Taiwan Intel Dashboard — Product Board Audit

Audit date: 2026-09-09  
Default-branch evidence SHA: `9730ab9c36bee879dbec64d2ee72d244ff22c081`  
Latest inspected pipeline run: [34293170321](https://github.com/Reese-max/taiwan-intel-dashboard/actions/runs/34293170321)  
Method: repository/code/CI inspection, public competitor research, 50 synthetic-persona simulation, executive-board review, and red-team challenge.

> All persona results and preference shares below are synthetic simulations, not human research, market share, production telemetry, or a claim that a browser/assistive-technology session was performed. Runtime statements are limited to GitHub Actions and repository artifacts actually inspected.

## Executive Summary

`taiwan-intel-dashboard` is a mature, public, Taiwan-focused multi-source intelligence dashboard with unusually strong provenance, source-health, risk-distribution, data-size, network-quality, and deployment gates. Its defensible position is not “another global event map”; it is a transparent Taiwan public-data synthesis layer that combines official alerts, police/public datasets, news signals, geography, timelines, relation graphs, and explicit source health.

The current product is nevertheless **not CLEAN**. Three distinct findings pass the Quality Gate:

1. **P1 operating-state contradiction:** README and the earlier persona audit say the product is paused, returns 503, and has its schedule disabled, while the default workflow schedules fetch/audit/deploy and the latest scheduled deployment and post-deploy smoke succeeded. Mapped to [#17](https://github.com/Reese-max/taiwan-intel-dashboard/issues/17).
2. **P1 summary integrity failure:** a production candidate with thousands of evidence rows publishes domestic and international AI briefs as `（暫無資料）`, records `summary.ok=true`, and passes deploy. Mapped to [#18](https://github.com/Reese-max/taiwan-intel-dashboard/issues/18).
3. **P3 licensing decision gap:** the public repository has source-level license metadata but no repository-level code/data/generated-content reuse contract. Mapped to Research [#19](https://github.com/Reese-max/taiwan-intel-dashboard/issues/19).

Decision: **INVEST, conditional on SIMPLIFY/FIX first.** Do not add more feeds, collaboration, native apps, or another LLM before operating state and summary truth are reliable.

## A. Project Discovery

### Product identity

| Dimension | Assessment | Evidence level |
|---|---|---|
| Product type | Public multi-source intelligence and situational-awareness dashboard | CONFIRMED — README, UI components, pipelines |
| Target users | Taiwan public-sector/duty staff, analysts, OSINT/research users, and informed public | LIKELY — product copy and workflows; no human research |
| Core task | Convert many public sources into a fresh, filterable, traceable action-oriented view | CONFIRMED |
| Core value | Taiwan-specific source breadth plus provenance, source health, map/timeline/network views | CONFIRMED |
| Maturity | Functionally advanced, heavily tested, actively deployed; operational contract is inconsistent | CONFIRMED |
| Distribution | Public GitHub repository and Cloudflare Pages deployment | CONFIRMED |
| License | No repository-level license detected | CONFIRMED |
| Biggest weakness | Trust metadata can contradict production reality and the high-salience AI brief | CONFIRMED |
| Browser/AT usability | Not independently tested this round | UNKNOWN / NEEDS_RUNTIME_VERIFICATION |

### Repository and architecture evidence

- Vite + Vanilla TypeScript + Leaflet; Node ESM data pipeline; OpenAI-compatible LLM endpoint; Cloudflare Pages.
- Source adapters cover CWA, police, missing persons, Taiwan/news RSS, GDELT, MOFA, NCDR, MND, CDC, TFDA, CGA, TWCERT, Taipower, WRA, and river levels.
- Data pipeline separates source plan, adapters, aggregation, provenance, and build outputs.
- UI includes filters, map, timeline, relation graph, triage inbox, source health, AI brief, KPI strip, top clusters, and police-health panels.
- Test inventory covers event contracts, source freshness, source health, provenance, network quality, risk distribution, map/mobile layouts, filters, correlation, carry-over, and restore drills.
- Latest inspected scheduled run passed fetch, save-state, audit, Cloudflare deployment, and deployed smoke.
- Open PR [#3](https://github.com/Reese-max/taiwan-intel-dashboard/pull/3) was created 2026-08-23, has no lock/heartbeat, is stale, and remains untouched. Its Twinkle-removal scope is unrelated to this report.
- No matching `autodev-ng` open goal, no `github-17/18/19` branch, and no competing live lock was found before writing.

### Evidence classification

**CONFIRMED — code/CI**

- README pause declaration.
- Active schedules and deploy path.
- Successful scheduled deployment on 2026-09-09.
- `pipeline-state` provenance generated at 2026-09-09 00:01 UTC with 769 source rows, summed row count 9,035, 4,010 international normalized events, 413/465 contributing feeds, and `summary.ok=true`.
- `summary.json` says no domestic or international data while its five-day counts are non-zero.
- Repository metadata reports no license.

**LIKELY — static/product inference**

- Time-pressured users will rely heavily on the first AI brief.
- Conflicting state claims will increase operator error and support cost.
- Taiwan-specific provenance can be a moat relative to global tools.

**UNKNOWN / Runtime pending**

- Exact current canonical UI response independent of the recorded post-deploy smoke.
- Screen-reader, 200% zoom, slow-network, offline, and mobile behavior after fixes.
- Whether users prefer deterministic fallback wording.
- Owner’s desired licensing and contribution model.

## B. Competitive Intelligence

Sources checked 2026-09-09: [NCDR public alerts](https://alerts.ncdr.nat.gov.tw/web/platform/history), [NCDR disaster intelligence](https://eocdss.ncdr.nat.gov.tw/), [CWA app](https://www.cwa.gov.tw/V8/E/S/eservice/app/app_w.html), [GDELT](https://gdeltproject.org/), [Liveuamap](https://liveuamap.com/about), [ACLED Explorer](https://acleddata.com/platform/explorer), [Feedly Market Intelligence](https://feedly.com/market-intelligence), and [Feedly pricing](https://feedly.com/market-intelligence/pricing).

| Capability | This product | NCDR | CWA | Liveuamap | GDELT | ACLED | Feedly MI |
|---|---|---|---|---|---|---|---|
| Target user | Taiwan analysts/duty/public | Taiwan disaster responders/public | Taiwan weather/public | Global breaking-event consumers | Researchers/data builders | Conflict researchers/analysts | Enterprise MI teams |
| Value proposition | Taiwan multi-domain evidence synthesis | Official multi-agency warnings | Authoritative weather/quake | Fast global map/news | Massive global event/news corpus | Curated conflict-event analysis | AI-curated team intelligence |
| Killer feature | Taiwan official-source provenance + health | Official alerts/decision support | Push alerts and forecasts | Live geolocated event map | 300+ event categories, 15-min updates | Curated conflict taxonomy/explorer | AI feeds, synthesis, collaboration |
| Onboarding | Public URL; dense | Public/LINE ecosystem | App/site | Web/app | Data/API learning curve | Account/data tools | Trial/demo, enterprise |
| UX | Map/list/network/source panel | Alert/decision oriented | Consumer mobile | Mobile-first map/feed | Data/API | Explorer/exports | Team workspace |
| Automation/AI | LLM normalization/summary | Rules/official feeds | Forecast/alerts | Editorial/aggregation | Automated global monitoring | Curated analysis/data | AI filters/actions/Ask AI |
| Integrations/API | Static artifacts, public data files | Public alert data | Official APIs/app | App/notifications | Strong datasets/APIs | Export/API | API on advanced plan |
| Mobile | Responsive web, unverified this run | LINE/mobile access | Native official app | Native apps | Not primary | Web | Web/team |
| Performance | Data trimming/first-paint map | Narrower scope | Narrower scope | Productized global map | API/data scale | Curated dataset | SaaS |
| Reliability | Strong gates; current trust defects | Official channel | Official channel | Closed service | Published cadence | Managed platform | Managed commercial |
| Security/privacy | Public read-only product; provenance strong | Government service | Government service | Geolocation notifications | Public datasets | Account/terms | Enterprise controls |
| Pricing | Free deployment; operator costs | Free public service | Free | Free + subscription | Free/open data access | Account/terms-dependent | US$1,600/mo standard; US$2,400/mo advanced billed annually |
| Open/closed | Public source, no license | Government service/data | Government service | Closed | Open data platform | Controlled terms/data access | Closed SaaS |
| Community | No visible issue community baseline | Public service | Large public reach | App users | Research ecosystem | Research/policy ecosystem | Enterprise customers |
| Documentation | Deep technical/runbooks, currently stale status | Public-service docs | Official docs | Consumer docs | Strong data docs | Data/API docs | Product/help docs |
| Distribution | GitHub + Pages | Web + LINE | Web + apps | Web + apps | Web/data/API | Web/export/API | SaaS |
| Common strength | Traceability and Taiwan breadth | Official trust | Timely authoritative alerts | Immediacy/visual scanning | Scale/history | Curated event quality | Collaboration and synthesis |
| Common weakness/tradeoff | Dense UI; owner-operated reliability | Disaster-only | Weather-only | Source/algorithm opacity | Requires analysis skill | Narrower conflict domain | High cost/closed ecosystem |

### Gap decisions

**MUST MATCH**

- Truthful operational state and timestamp.
- Truthful degraded summary; never confuse narrative failure with no evidence.
- Stable provenance/source health and links to originals.
- Mobile-readable first decision layer.

**SHOULD BE BETTER**

- Taiwan official-source specificity and transparent carry-over/freshness.
- Candidate/run receipts tying summary, source state, and deploy status.
- Deterministic decision fallback when AI is unavailable.

**DIFFERENTIATOR**

- Taiwan public-safety cross-domain view with explicit “official / media / aggregated / stale / derived” semantics.
- Verifiable action brief that shows what is known, inferred, missing, and degraded.
- Reusable shared provenance/health contracts across the portfolio’s intelligence projects.

**DO NOT COPY**

- Feedly’s enterprise collaboration, SSO, newsletters, and pricing model.
- Liveuamap’s global conflict breadth.
- CWA/NCDR’s notification role without an evidence-backed user need.
- ACLED/GDELT’s full research database/API scope.
- More feeds or more LLM providers as a substitute for trustworthy failure states.

## C. Virtual Executive Board

| Role | Independent question | Opportunity | Priority |
|---|---|---|---|
| CEO | Can users trust what state the product is in and what the brief says? | Make truth/failure semantics the brand | #17, #18, then #19 |
| CPO | Which single job should the first screen complete? | “Three evidence-backed things requiring attention now” | Simplify first decision layer |
| CTO | What control-plane state drives production? | Versioned operating-state + candidate receipts | #17 |
| Staff/Principal Engineer | Which invariants cross files/jobs? | State/doc/workflow and data/summary consistency checks | #17/#18 |
| UX Lead | What does the user see when AI fails? | Explicit degraded deterministic brief | #18 |
| UX Researcher | Who actually needs broad vs role-specific views? | Run small role-based usability tests after trust fixes | NEXT |
| Growth Lead | Why return instead of using NCDR/CWA/Feedly? | Taiwan-wide explainable cross-domain synthesis | Differentiate, not feature-count |
| CFO/Business Analyst | Are schedules/retries/providers cost-bounded? | Tie operating state and retries to cost receipts | #17/#18 |
| Security/Privacy Lead | Are data/rights/egress boundaries explicit? | Rights matrix; no automatic provider fan-out | #19 |
| QA Lead | Can empty/truncated output and state drift be reproduced? | Deterministic fixtures and policy matrix | #17/#18 |
| SRE Lead | Does green mean usable? | Semantic SLOs, degraded states, transition receipts | #17/#18 |
| Accessibility Specialist | Is status conveyed as correct text? | Screen-reader-readable degradation and zoom testing | #18 + runtime |
| Customer Support Lead | Can support answer “is it live?” in one sentence? | Canonical state with timestamp and evidence link | #17 |

### Cross-review and disagreements

Consensus: the next release work should reduce ambiguity, not add capabilities.

Minority opinions retained:

- “Just update README.” Rejected as insufficient because drift can recur without a machine check.
- “Block all deployment when AI summary fails.” Partially accepted only for modes that require narrative; default public mode may publish fresh evidence with a truthful deterministic fallback.
- “Add push notifications and user accounts to match NCDR/Feedly.” Deferred; this changes product/privacy/ops scope and lacks human demand evidence.
- “Add MIT immediately.” Rejected; the correct license and mixed-content rights require an owner decision.

CEO resource constraint — only three things:

1. Implement and verify the authoritative operating-state contract (#17).
2. Implement and verify summary integrity/degraded fallback (#18).
3. Decide and publish code/data/content rights boundaries (#19).

What not to do: add feeds, accounts, chat, native app, dashboards, collaboration, or another model provider before these three are closed with evidence.

## D. 50 Synthetic Personas

Set B = regression baseline (30/50, 60%). Set E = rotating exploration (20/50, 40%).

| # | Set | Background | Goal / Expectation | Task / Journey | Friction | Success/Failure / Comment | Severity / Suggestion |
|---|---|---|---|---|---|---|---|
| 01 | B | 19｜警專生｜中熟｜Android｜4G | Goal: 30 秒掌握今日治安風險；Expectation: 首屏摘要與事件一致 | Task/Journey: 開首頁→讀 AI 摘要→展開國內事件 | Friction: 摘要稱暫無資料但事件/趨勢非零 | Failure；「我會以為今天沒有事件」 | P1 |
| 02 | B | 23｜警校資管生｜高熟｜Windows｜校網 | Goal: 查證來源；Expectation: 可追 provenance | Task/Journey: 搜事件→看來源→開原文 | Friction: 狀態文件說暫停，資料卻持續更新 | Partial；「不知道哪個狀態可信」 | P1 |
| 03 | B | 26｜派出所員警｜中熟｜iPhone｜5G | Goal: 交班前掃描；Expectation: 重點可信 | Task/Journey: 開首頁→讀摘要→看高風險 | Friction: 空摘要掩蓋大量證據 | Failure；「不能拿來口頭報告」 | P1 |
| 04 | B | 31｜分局勤指中心｜高熟｜雙螢幕｜專網 | Goal: 判斷需升級事項；Expectation: 可知新鮮度 | Task/Journey: 看 top brief→來源健康→原始連結 | Friction: paused/active 契約矛盾 | Failure；「無法判斷是否正式恢復」 | P1 |
| 05 | B | 42｜刑事分析員｜高熟｜桌機｜穩定 | Goal: 聚合跨來源事件；Expectation: 摘要可回到資料 | Task/Journey: 篩反詐→看關聯→查來源 | Friction: 摘要品質無 receipt | Partial；「模型名不等於摘要成功」 | P1 |
| 06 | B | 38｜消防勤務員｜中熟｜平板｜4G | Goal: 看災情與通行；Expectation: 官方警示優先 | Task/Journey: 篩災防→看地圖→開 NCDR | Friction: 跨領域噪音較高 | Success；「來源面板有用」 | P3 |
| 07 | B | 35｜交通中心人員｜高熟｜桌機｜穩定 | Goal: 找道路事件；Expectation: 地圖快速 | Task/Journey: 切交通→縮放→開事件 | Friction: 無個人化告警 | Success；「先別做推播，先修信任」 | P3 |
| 08 | B | 48｜公務主管｜低熟｜iPad｜Wi‑Fi | Goal: 一分鐘簡報；Expectation: 只看一句 | Task/Journey: 開站→讀 AI 摘要→做決策 | Friction: 暫無資料造成錯誤結論 | Failure；「一句話最危險」 | P1 |
| 09 | B | 54｜地方議員助理｜中熟｜Mac｜穩定 | Goal: 查公共議題；Expectation: 時間與來源清楚 | Task/Journey: 搜縣市→讀事件→匯入簡報 | Friction: 權利/重用界線不明 | Partial；「可以截圖或引用嗎？」 | P3 |
| 10 | B | 29｜記者｜高熟｜筆電｜行動熱點 | Goal: 找線索再查證；Expectation: 新聞不可冒充官方 | Task/Journey: 事件→來源 badge→原文 | Friction: 混合來源授權/轉載邊界未定 | Partial；「來源有標，但輸出權利不明」 | P3 |
| 11 | B | 33｜OSINT 研究員｜高熟｜Linux｜光纖 | Goal: 交叉佐證；Expectation: API/JSON 可重播 | Task/Journey: 讀 provenance→network→原文 | Friction: 無公開資料契約/API 保證 | Success；「JSON 很有價值但不是正式 API」 | P3 |
| 12 | B | 45｜資安分析師｜高熟｜桌機｜穩定 | Goal: 掃 TWCERT 情報；Expectation: 可追來源 | Task/Journey: 篩資安→風險排序→查原文 | Friction: LLM 摘要 degraded 未顯示 | Partial；「可能漏掉最重要訊號」 | P1 |
| 13 | B | 58｜退休警察｜低熟｜Android｜4G | Goal: 看地方治安；Expectation: 字句直白 | Task/Journey: 開站→選縣市→看卡片 | Friction: 資訊密度高 | Partial；「暫無資料最容易誤會」 | P1 |
| 14 | B | 67｜社區巡守隊｜低熟｜舊手機｜3G | Goal: 查看附近風險；Expectation: 快速載入 | Task/Journey: 開首頁→等地圖→看事件 | Friction: 大量資料且摘要無用 | Failure；「我不會再等第二層」 | P2 |
| 15 | B | 22｜視障學生｜中熟｜iPhone VoiceOver｜5G | Goal: 讀今日重點；Expectation: 狀態可朗讀 | Task/Journey: 標題導覽→AI 摘要→事件 | Friction: 誤導文字在閱讀順序前段 | Failure；「顏色救不了錯誤文字」 | P1 |
| 16 | B | 39｜低視力公務員｜中熟｜200% Zoom｜穩定 | Goal: 看來源健康；Expectation: 放大仍清楚 | Task/Journey: 放大→來源面板→details | Friction: 本輪未做真實 zoom 驗證 | Unknown；「需要 runtime」 | P3 |
| 17 | B | 28｜色覺差異使用者｜中熟｜桌機｜穩定 | Goal: 判斷風險/狀態；Expectation: 不只靠色彩 | Task/Journey: 看 badges→讀狀態文案 | Friction: summary degraded 無狀態字串 | Failure；「看不到失敗類型」 | P1 |
| 18 | B | 41｜注意力困難使用者｜中熟｜筆電｜穩定 | Goal: 聚焦前三件事；Expectation: 少噪音 | Task/Journey: 開站→看摘要→看 top clusters | Friction: 9,000+ 訊號與空摘要造成負荷 | Failure；「首屏沒有可用優先次序」 | P1 |
| 19 | B | 36｜聽障使用者｜高熟｜桌機｜穩定 | Goal: 文字情報；Expectation: 不依聲音 | Task/Journey: 搜尋→時間軸→來源 | Friction: 無直接聽覺阻礙證據 | Success；「文字為主適合我」 | P4 |
| 20 | B | 24｜偏鄉志工｜低熟｜Android｜不穩 3G | Goal: 看災防警示；Expectation: 官方資料先出 | Task/Journey: 開站→等待→看災防 | Friction: 慢網路可能只看到錯誤摘要 | Failure；「先載輕量數字與警示」 | P2 |
| 21 | B | 51｜地方政府 IT｜高熟｜Windows｜受限網路 | Goal: 判斷服務可維運；Expectation: runbook 真實 | Task/Journey: README→workflow→Actions | Friction: 文件與執行狀態互斥 | Failure；「不敢照 runbook 操作」 | P1 |
| 22 | B | 46｜SRE｜高熟｜Linux｜穩定 | Goal: 辨識 pipeline degradation；Expectation: 綠燈有語義 | Task/Journey: Actions→artifact→provenance | Friction: summary.ok 假陽性 | Failure；「綠燈只代表函式沒 throw」 | P1 |
| 23 | B | 44｜資料工程師｜高熟｜桌機｜穩定 | Goal: 檢查 freshness/carry-over；Expectation: 時戳可追 | Task/Journey: pipeline-state→provenance→audit | Friction: summary 與 candidate 不一致 | Failure；「同一 candidate 應交叉驗證」 | P1 |
| 24 | B | 32｜前端工程師｜高熟｜Mac｜穩定 | Goal: 降級 UI 正確；Expectation: 明確狀態 | Task/Journey: 模擬空回應→render summary | Friction: placeholder 被當正常內容 | Failure；「UI 沒有 degraded state」 | P1 |
| 25 | B | 37｜QA 工程師｜高熟｜Windows｜穩定 | Goal: 建立回歸矩陣；Expectation: 可控 fixture | Task/Journey: mock empty/truncated→audit→deploy policy | Friction: 現有測試未覆蓋語義空值 | Failure；「缺失是可重現的」 | P1 |
| 26 | B | 49｜CFO/成本管理｜中熟｜筆電｜穩定 | Goal: 避免無價值 LLM 成本；Expectation: 重試有界 | Task/Journey: 看 run cadence→summary status→費用 | Friction: 暫停聲明與持續執行矛盾 | Failure；「預算模型不可信」 | P1 |
| 27 | B | 27｜開源貢獻者｜高熟｜Linux｜穩定 | Goal: 修 bug；Expectation: 知道授權與貢獻條件 | Task/Journey: fork→找 LICENSE→讀 README | Friction: 無 repository license | Failure；「公開不代表可重用」 | P3 |
| 28 | B | 34｜政府資料研究員｜高熟｜桌機｜穩定 | Goal: 重用衍生資料；Expectation: 來源條款清楚 | Task/Journey: provenance→下載 JSON→引用 | Friction: source license 與 artifact rights 未連結 | Partial；「不能判斷 mixed artifact」 | P3 |
| 29 | B | 61｜大學老師｜中熟｜筆電｜校網 | Goal: 課堂展示；Expectation: 可合法截圖引用 | Task/Journey: 地圖→截圖→教材 | Friction: code/data/content 權利混在一起 | Partial；「需要簡單說明」 | P3 |
| 30 | B | 20｜初次實習生｜低熟｜Chromebook｜Wi‑Fi | Goal: 了解產品；Expectation: README 是真實入口 | Task/Journey: README→網址→功能 | Friction: README 宣稱 503 與實際 deploy evidence 不一致 | Failure；「第一步就失去信任」 | P1 |
| 31 | E | 30｜災防值班員｜高熟｜三螢幕｜專網 | Goal: 跨域預警；Expectation: NCDR/CWA 優先且可推播 | Task/Journey: 監看→地圖→來源→通報 | Friction: 本產品無個人化推播/值班整合 | Partial；「NCDR 更適合即時警報」 | P2 |
| 32 | E | 40｜國安研究員｜高熟｜桌機｜穩定 | Goal: 台灣關聯國際風險；Expectation: 跨來源脈絡 | Task/Journey: 國際→關聯圖→原文 | Friction: GDELT 失敗且摘要空 | Partial；「仍有 RSS，但降級必須可見」 | P1 |
| 33 | E | 25｜新聞編輯｜高熟｜手機｜5G | Goal: 找即時地圖線索；Expectation: 圖像快 | Task/Journey: 地圖→事件→來源 | Friction: Liveuamap 行動體驗更直覺 | Switch；「用 Liveuamap 找線索，再回本產品看台灣來源」 | P2 |
| 34 | E | 52｜企業風險主管｜中熟｜筆電｜VPN | Goal: executive brief；Expectation: 協作與報表 | Task/Journey: 收集→摘要→分享 | Friction: Feedly 有團隊流程，本產品偏單人公開看板 | Switch；「若是公司用會選 Feedly」 | P3 |
| 35 | E | 43｜學術研究者｜高熟｜R/Python｜穩定 | Goal: 長期事件分析；Expectation: schema/API | Task/Journey: 查資料→下載→重現 | Friction: ACLED/GDELT 的資料契約更成熟 | Switch；「研究用選 GDELT/ACLED」 | P2 |
| 36 | E | 47｜地方首長幕僚｜低熟｜iPad｜5G | Goal: 今日三件事；Expectation: 無需解讀技術狀態 | Task/Journey: 開站→摘要→轉述 | Friction: 空摘要直接破壞任務 | Failure；「我不會下拉看 769 個來源」 | P1 |
| 37 | E | 56｜法遵人員｜高熟｜桌機｜穩定 | Goal: 確認資料使用權；Expectation: 可稽核 | Task/Journey: 找 LICENSE→來源條款→export policy | Friction: 權利矩陣缺失 | Failure；「不能批准對外重用」 | P3 |
| 38 | E | 63｜民間社團負責人｜低熟｜Android｜4G | Goal: 關注社區安全；Expectation: 地區訂閱 | Task/Journey: 搜城市→收藏→等待更新 | Friction: 無帳號/訂閱 | Switch；「災害用 NCDR LINE」 | P3 |
| 39 | E | 18｜高中生｜低熟｜手機｜校網 | Goal: 做公民資料專題；Expectation: 可理解來源 | Task/Journey: 看地圖→看來源→引用 | Friction: 授權與 AI 衍生指標複雜 | Partial；「來源說明很好，但重用不清」 | P3 |
| 40 | E | 70｜長者｜低熟｜平板｜4G | Goal: 看天氣/災害；Expectation: 大字與推播 | Task/Journey: 首頁→搜尋警示 | Friction: 專業情報面板過密 | Switch；「選中央氣象署或 NCDR」 | P2 |
| 41 | E | 33｜夜班員警｜中熟｜手機深色模式｜5G | Goal: 交班前讀重點；Expectation: 夜間清楚 | Task/Journey: 開首頁→摘要→高風險 | Friction: 空摘要，無法節省時間 | Failure；「最需要摘要時沒有摘要」 | P1 |
| 42 | E | 29｜資料新聞工程師｜高熟｜Mac｜穩定 | Goal: 驗證 9,035 count 意義；Expectation: unique/row 定義 | Task/Journey: provenance→schema→計算 | Friction: source count 可能非 unique events | Partial；「不要把總和稱唯一事件」 | P2 |
| 43 | E | 41｜ML 工程師｜高熟｜GPU 主機｜穩定 | Goal: 診斷空 LLM 回應；Expectation: trace 可觀測 | Task/Journey: run receipt→provider response class→fallback | Friction: ok 只看是否 throw | Failure；「需要 output-validity 狀態」 | P1 |
| 44 | E | 38｜隱私倡議者｜高熟｜Firefox｜穩定 | Goal: 知道資料/追蹤；Expectation: 最少蒐集 | Task/Journey: README→網路請求→來源 | Friction: 本輪未做流量攔截；不可聲稱無追蹤 | Unknown；「需要 runtime network audit」 | P3 |
| 45 | E | 36｜離線/斷線應變人員｜中熟｜筆電｜斷續網路 | Goal: 保留最近證據；Expectation: stale 清楚 | Task/Journey: 載入快照→斷線→重開 | Friction: 無離線保證，摘要與來源可能不同步 | Unknown；「需真實斷網測試」 | P3 |
| 46 | E | 50｜支援人員｜中熟｜桌機｜穩定 | Goal: 回答『網站是否恢復』；Expectation: 一個答案 | Task/Journey: README→Actions→status | Friction: 三處答案不同 | Failure；「無法給使用者一致回覆」 | P1 |
| 47 | E | 45｜產品經理｜高熟｜筆電｜穩定 | Goal: 定義產品邊界；Expectation: 不與專門工具硬碰硬 | Task/Journey: 比較 NCDR/GDELT/Feedly→排 roadmap | Friction: 容易 feature bloat | Success；「護城河是台灣來源 provenance＋行動分流」 | P2 |
| 48 | E | 27｜行動端 Power User｜高熟｜Android｜5G | Goal: 快速 filter/share；Expectation: 深連結穩定 | Task/Journey: filter→開事件→分享 URL | Friction: 本輪未做手機 runtime | Unknown；「e2e 有檔案但不能假裝跑過」 | P3 |
| 49 | E | 57｜稽核員｜高熟｜桌機｜隔離網路 | Goal: 重播發布決策；Expectation: evidence bundle | Task/Journey: commit→artifact→run→status transition | Friction: 缺 operating-state 與 summary-quality receipt | Failure；「無法證明為何這版可公開」 | P1 |
| 50 | E | 32｜新維護者｜中熟｜Windows｜家庭網路 | Goal: 安全接手；Expectation: 文件可執行 | Task/Journey: README→pause runbook→workflow | Friction: 操作指引已過期 | Failure；「怕誤停或重啟正式服務」 | P1 |
| 51 | E | 46｜社群開發者｜高熟｜Linux｜穩定 | Goal: 提交 adapter；Expectation: license/CONTRIBUTING | Task/Journey: fork→新增來源→PR | Friction: 法律與貢獻契約不明 | Failure；「先不貢獻」 | P3 |
| 52 | E | 21｜低資料量方案使用者｜中熟｜手機｜限量 4G | Goal: 少流量看重點；Expectation: 輕量首屏 | Task/Journey: 開站→只讀摘要 | Friction: 摘要既空又失去首屏價值 | Failure；「流量花了但沒有重點」 | P1 |
| 53 | E | 60｜CEO/Portfolio owner｜高熟｜筆電｜穩定 | Goal: 決定投資；Expectation: 三件事優先 | Task/Journey: audit→issues→roadmap | Friction: 產品恢復但信任 contract 未恢復 | Partial；「先修狀態、摘要、權利，再擴功能」 | P1 |

Coverage summary:

- Ages 18–70.
- Students, police, command staff, firefighters, public servants, analysts, researchers, journalists, executives, engineers, QA/SRE, support, civic-tech, educators, legal/compliance, and public users.
- Low/medium/high digital skill; first-time, regular, professional, and power users.
- Android/iOS/tablet/desktop/Linux/Windows/Mac/Chromebook; 3G/4G/5G/Wi-Fi/special networks/offline edge cases.
- Accessibility: screen reader, low vision/200% zoom, color-vision difference, attention constraints, hearing difference.
- No real browser, assistive-technology, or human-subject result is claimed.

## E. Competitor Switching Test

Synthetic choice for the primary scenario “obtain a trustworthy current Taiwan-relevant situation view”:

| Choice | Personas | Synthetic preference share | Main reason |
|---|---:|---:|---|
| taiwan-intel-dashboard | 14 | 28% | Taiwan breadth, provenance, cross-domain views |
| NCDR/CWA | 12 | 24% | Official alerts, narrower but clearer operational trust |
| Feedly MI | 9 | 18% | Enterprise team workflow and synthesis |
| Liveuamap | 7 | 14% | Fast mobile map/news experience |
| GDELT | 5 | 10% | Dataset/API scale and research flexibility |
| ACLED | 3 | 6% | Curated conflict-event analysis |

This is not market share. Switching reasons against the product: ambiguous current operating state, unusable AI brief under degradation, dense first screen, no push/collaboration, unclear reuse rights. Switching reasons toward it: Taiwan-specific official sources, transparent provenance, source health, and action-oriented maps/networks.

## F. Red Team

Challenges and responses:

1. **Persona bias:** the sample overweights public safety and technical users. Valid; this follows the repository’s content but should not be treated as general-population research.
2. **Competitor selection:** Feedly and ACLED are not direct Taiwan dashboard competitors. Valid; they are workflow/data alternatives, included to expose tradeoffs rather than justify copying.
3. **Overengineering #17:** a four-state contract may be more than needed. Response: minimum can be one versioned file plus CI assertion; no status SaaS.
4. **Overengineering #18:** deterministic fallback can become another summarizer. Response: keep it counts/top-risk/source warnings only.
5. **Legal overreach #19:** missing license is not automatically a defect. Response: Research issue offers open-source or explicit no-license paths and does not make a legal conclusion.
6. **Confirmation bias:** successful deploy smoke does not prove the full UI is healthy. Correct; report limits the claim to recorded GitHub steps.
7. **Count inflation:** provenance source counts may overlap and are not unique events. Correct; issues explicitly avoid calling 9,035 unique events.
8. **Feature bloat:** native app, notifications, chat, collaboration, API platform, more feeds, and more models are rejected now.
9. **Growth bias:** no analytics or account system is recommended; trustworthy utility precedes acquisition.
10. **Could we delete instead?** Yes: delete stale pause prose/duplicate switches after the state contract; replace empty AI prose with a small deterministic summary; do not preserve ambiguous placeholders.

## G. Findings, Quality Gate, and Priority

| ID | Type | Priority | Impact | Strategic value | Gap | Risk reduction | Confidence | Effort | Quality Gate | Mapping |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| F1 | RELIABILITY / DOCUMENTATION | P1 | 5/5 | 5/5 | 4/5 | 5/5 | 0.99 | M | Pass: direct code+CI evidence, distinct, actionable, testable | NEW [#17](https://github.com/Reese-max/taiwan-intel-dashboard/issues/17) |
| F2 | RELIABILITY / UX / BUG | P1 | 5/5 | 5/5 | 5/5 | 5/5 | 0.99 | M | Pass: deployed artifact mismatch, distinct root cause, deterministic AC | NEW [#18](https://github.com/Reese-max/taiwan-intel-dashboard/issues/18) |
| F3 | RESEARCH_REQUIRED / DOCUMENTATION | P3 | 2/5 | 3/5 | 3/5 | 3/5 | 0.98 missing contract / low decision confidence | S–M | Pass as research: evidence clear, outcome needs owner/legal choice | NEW Research [#19](https://github.com/Reese-max/taiwan-intel-dashboard/issues/19) |

Stable fingerprints are recorded in each issue. No matching open/closed issue, roadmap item, audit issue, or PR was found. Symptoms with the same root cause were merged into the three root issues.

## H. GitHub Issue Closure

### New Issues Created

- [taiwan-intel-dashboard #17](https://github.com/Reese-max/taiwan-intel-dashboard/issues/17) — `[P1][RELIABILITY] Make the declared pause/restore state match the production schedule`
- [taiwan-intel-dashboard #18](https://github.com/Reese-max/taiwan-intel-dashboard/issues/18) — `[P1][RELIABILITY][UX] Never publish an empty AI brief as “no data” when evidence exists`
- [taiwan-intel-dashboard #19](https://github.com/Reese-max/taiwan-intel-dashboard/issues/19) — `[Research][P3][DOCUMENTATION] Decide code, data, and generated-content licensing boundaries`

### Updated / reopened / research / blocked

- Updated existing issues: 0
- Reopened issues: 0
- Research issues: 1 (#19)
- Duplicate avoided: 8 symptom candidates merged by root cause
- Issue write blocked: 0
- SKIPPED_LOCKED: 0 for #17/#18/#19
- Locks were added and re-read; no earlier active marker, matching branch, PR, or autodev goal existed.

## I. Regression

- Previous round status: `INTENTIONALLY PAUSED / STATIC REVIEW PASS — NOT CLEAN`.
- Current evidence: scheduled fetch/audit/deploy is active and passing; therefore the old operational state is superseded, but no verified state-transition receipt exists.
- No prior issue met full Acceptance Criteria because these are new fingerprints.
- Verified Fixed: 0.
- #17 status: STILL REPRODUCIBLE / RUNTIME EVIDENCE CONFIRMED via Actions; needs implementation and state-matrix runtime verification.
- #18 status: STILL REPRODUCIBLE / ARTIFACT + CI CONFIRMED; needs controlled provider-failure and rendered-UI verification.
- #19 status: RESEARCH_REQUIRED; cannot be fixed without owner/compliance decision.

## J. Roadmap

**NOW — simplify/fix**

1. #17 authoritative operating state and transition receipt.
2. #18 summary integrity, deterministic degraded fallback, and semantic gate.

**NEXT — decide/improve**

1. #19 licensing/rights decision and artifact policy.
2. Run human usability tests with duty officer, analyst, public user, low-vision/screen-reader user, and slow-network user.
3. Define one first-screen outcome: three evidence-backed items requiring attention now.

**LATER — only after evidence**

- Role presets without accounts.
- Optional alert handoff/deep links to official NCDR/CWA channels.
- Stable read-only data contract for researchers.
- Shared provenance/health components with `taichung-police-intel`.

**DON’T**

- Full CMS, enterprise collaboration, social feed, user accounts, native app, marketplace.
- New LLM provider solely to mask empty output.
- Unbounded feed expansion.
- Universal “real-time” or “open source” claims without evidence/license.
- Merge `taiwan-intel-dashboard` and `taichung-police-intel` user experiences; share infrastructure, keep missions distinct.

Ordering applied: REMOVE stale contradictions → SIMPLIFY status/summary → FIX gates → IMPROVE usability → ADD only validated capabilities.

## K. Decision Memo

- **What this product should become:** the trustworthy Taiwan public-data situational-awareness layer, not a generic global news dashboard.
- **Who it should serve:** public-sector/duty staff and analysts first; informed public second; researchers through documented artifacts.
- **Why users choose it:** Taiwan source breadth, provenance, health, cross-domain map/timeline/network, and transparent derived-risk labels.
- **Why users choose competitors:** official alerts (NCDR/CWA), mobile immediacy (Liveuamap), data depth/API (GDELT/ACLED), enterprise workflow (Feedly).
- **Biggest competitive gaps:** truthful live/degraded state, reliable first-screen summary, explicit rights contract, validated mobile/accessibility experience.
- **Potential moat:** reusable Taiwan source adapters + provenance + freshness/carry-over + evidence-backed action semantics.
- **Top priorities:** #17, #18, #19.
- **What not to build:** accounts, chat, collaboration, native apps, more feeds/models before trust closure.
- **Features worth removing:** stale manual pause assertions and misleading `暫無資料` placeholder behavior.
- **Biggest risks:** false absence, operational drift, mixed-source rights ambiguity, model/provider cost/degradation, information overload.
- **Next experiments:** controlled empty/truncated LLM runs; paused/restoring/active workflow matrix; five-person human usability test; source-rights inventory.
- **Decision:** **INVEST**, conditional on **SIMPLIFY/FIX**. The product has real differentiation and strong engineering foundations, but trust defects block stronger adoption claims.

## L. Portfolio CEO Review

Provisional portfolio review based on current repository evidence and prior audit baseline; other repositories were not re-run deeply in this round.

- `taiwan-intel-dashboard`: national/cross-domain public intelligence; **INVEST conditionally**.
- `taichung-police-intel`: municipal operational briefing; keep separate UX, share source/provenance/status/summary contracts.
- `cf-ai-router`: candidate shared AI gateway after its Responses/cost-safety research; do not couple this product before compatibility is proven.
- `chatgpt-dual-pipeline`: reuse fail-closed publication eligibility concepts for state/summary artifact gates.
- `autodev-ng`: reuse issue locks and evidence receipts, not product UI.
- `police-exam-archive/practice`: unrelated user mission; maintain fusion work, no merge with intelligence products.
- `UkePack`, `avatar-vfo`, `tick-stock-panel`: separate products; common CI/receipt patterns only.

Shared infrastructure opportunity:

`Source adapters → provenance/rights → freshness/carry-over → candidate hash → semantic gates → operating-state/deploy receipt → role-specific UI`

Do not create a universal frontend or merge all products. Extract only stable contracts after #17/#18 demonstrate them.

### Provisional portfolio ranking

1. taiwan-intel-dashboard — strongest public-data intelligence foundation; P1 trust blockers.
2. taichung-police-intel — strong operational fit; active work/locks must be respected.
3. police-exam-archive + police-exam-practice — clear education mission; simplify into one canonical product.
4. cf-ai-router — high infrastructure leverage; strategic research pending.
5. UkePack — differentiated teacher workflow; validation pending.
6. tick-stock-panel — focused value; coverage truth issue pending.
7. avatar-vfo — promising but deployment/runtime verification pending.

## M. Mandatory Verification

- Total Findings: **3**
- New Issues Created: **3** (#17, #18, #19)
- Updated Existing Issues: **0**
- Reopened Issues: **0**
- Research Issues: **1** (#19)
- Duplicate Avoided: **8**
- Issue Write Blocked: **0**
- SKIPPED_LOCKED: **0** for mapped findings
- Verified Fixed: **0**
- Priority distribution: **P0 0 / P1 2 / P2 0 / P3 1 / STRATEGIC 0**
- Highest Priority: **#17 and #18**
- Finding mapping completeness: **3/3 = 100%**

Rejected findings and explicit reasons:

1. Reopen the old paused audit as an issue — rejected; it is immutable historical evidence, not an issue.
2. Treat successful deploy smoke as full browser/accessibility proof — rejected; evidence does not support it.
3. P0 for the empty brief — rejected; no confirmed safety incident or data disclosure.
4. Separate issues for every affected persona — rejected; same root causes belong in #17/#18/#19.
5. Add push notifications/accounts — rejected; feature bloat and privacy/ops cost.
6. Add another LLM fallback provider — rejected; could increase cost/egress without fixing truth semantics.
7. Build a native app/PWA/offline engine — rejected; no runtime/user evidence.
8. Copy Feedly collaboration/analytics — rejected; wrong target and cost structure.
9. Claim 9,035 unique events — rejected; provenance total may contain overlapping rows.
10. Apply MIT automatically — rejected; owner intent and mixed-source rights are unknown.
11. Merge with `taichung-police-intel` — rejected; distinct national vs municipal jobs.
12. Touch stale open PR #3 — rejected; unrelated scope and safety rule.

All Quality-Gate findings map to NEW or RESEARCH tracking objects. No unmapped passing finding remains.
