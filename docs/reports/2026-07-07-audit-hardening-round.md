# 2026-07-06/07 審計強化輪——資料品質、可靠度與測試網

本輪以「規格→Codex TDD→對抗式審查→全量比對驗證」循環推進，共 T8-08~T8-20 與 T9-01~T9-11。
驗證紀律：每個規則變更跑 147 feed / ~6300 筆實抓資料的舊 vs 新逐筆比對＋逐筆眼看；硬線＝真實事件零誤殺、非致死零誤升、台灣相關零誤刪。

## 一、揪出並修復的潛伏真 bug（生產環境正在發生、無任何訊號）

| # | 缺陷 | 影響 | 修復 |
|---|---|---|---|
| 1 | TWCERT 幽靈帳目：provenance 在保留窗剔除前記帳 | 帳上 20 筆、線上 0 筆 | T8-08 公告類長保留窗＋帳目誠實化（754b4b8） |
| 2 | 死亡同義詞黑洞：不治/罹難/N死 不在風險詞表 | 135 筆真命案顯示低風險 | T8-11（95d881a） |
| 3 | 資安風險詞綁 hint | 104 筆資安事件被低估 | T8-12（82f88a7） |
| 4 | 民國→西元誤植（民國155→2066） | 假「最新」置頂＋破壞保留窗 | T8-14 遠未來時間戳夾制（a86f8f9） |
| 5 | 災防主題不在 TOPIC_RE | GN 土石流坍方 35 筆/輪全滅 | T8-16 聯集漏斗（baa56ee+adf4b2d） |
| 6 | ci-fetch-mode 顯式清單漏 mofa/ncdr | 兩個新資料源從未上線（provenance 雙 skipped） | 2c5a81f |
| 7 | CI timeout 30 分 vs LLM 劣化後 40 分 run | 7/6 全天 run 被砍、資料停更、快取死亡螺旋 | timeout 55（7050b92）＋正規化時間預算（d8c4149） |
| 8 | **靜默全敗家族**：twnews/missing/police/international/judicial 全源失敗仍 ok:true | carry-over 死路、provenance 說謊、故障無訊號 | T9-08/T9-10/9355a19，全 9 源統一「全滅 throw→ok:false→carry-over」 |
| 9 | **judicial riskLevel 契約外值（warning/info）** | 契約強制後司法判決源全數被靜默剔除、從未進視圖 | 40aa315（warning→high/info→low）＋51bf2e3（category 司法判決一律標 temporal judicial） |

## 二、對抗式審查攔下的規格級錯誤（未流入 production）

- T8-13 廣版外國過濾：眼看 262 筆移除發現 5-6 筆台灣誤殺（八田與一通緝案/中聯油脂/緬甸詐騙園區…）→ 收窄為「標題同時含外國地名＋天災/戰爭/大量傷亡」。
- T8-16 災防漏斗純取代制：316 筆比對發現誤殺 14 筆真實事件（車禍/大火/消防救援）→ 改聯集（預警詞 ∪ 警政詞）。
- T9-08 豁免收窄的附帶損傷：「中國試射飛彈 日本關切」被當純外國剔除 → TAIWAN_MARKER 補共軍/中國軍事詞（73af0d3），並額外救回一筆更早的同類誤殺。
- T9-19（協尋規則）首版誤分失聯移工查緝/命案失聯/詐術失聯 → 負向排除。

## 三、新能力

- 央廣 RSS 備援機制（f74b49f）：CloudFront WAF 擋 CI IP（7/5 起 403）→ 自動走 GN 聚合、溯源誠實標 aggregated。已實戰復活（100 筆/輪）。
- NCDR 災防示警 CAP 源（7c192cb）：淹水/火災/道路/鐵路/海污白名單、severity→風險、Cancel/過期雙擋。
- 事件時效語義（b019837+51bf2e3）：司法結果/歷史資料徽章，不動風險與視圖。
- 每日 rollup 趨勢基線（0e6fe7b）：跨輪累積、逐格 max、90 天窗——「今天比平常危險嗎」的地基。
- GN 系統性健康指標（ef395cb）＋停更告警兩件套（20a4ca2：前端 6h 橫幅＋CI 失敗/取消 Telegram 通知）。
- bulk 分類補協尋（74e8bff）；食安補動物疫病事件詞（83d1c86）；R4 補漏網地名/成災語境（ec4fe8f）。

## 四、fetch-live 整合測試網（T9-06~T9-11）

生產碼僅 2 行侵入（DATA_DIR env 覆寫＋run export）。15 案例、全 9 源 happy/fail-soft/carry-over、
全域 fetch stub 氣密（含 MCP JSON-RPC 仿真）、~60-90s 跑完。T3-11c 拆分自此有安全網（切片 1：carry-over helper，f66a92b）。
兩天內由測試網揪出上表 #8 #9 共 6 個潛伏 bug——投資已回本。

## 五、已知未決（需使用者決定）

- GitHub Secrets：TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID（CI 告警）、LLM_FALLBACK_*（LLM 端點劣化的本源解）。
- R3 LLM prompt 校準（非確定性、無法用比對閘驗證）。
- CDC 疫情（需事件門檻定義）、MND 共軍維度（roadmap topPick）。
- 趨勢前端（等 rollup 累積 ≥2 天）；ground truth 標註（工具已備，見 scripts/ground-truth-*）。
- 國際 LLM 正規化劣化（7/6 起 129 批 ~25 分鐘）之根因在 NVIDIA 免費端點，時間預算只是止血。

## 六、經驗法則（後續維護者適用）

1. 規則變更必跑全量舊 vs 新比對＋逐筆眼看——本輪每一次比對都真的抓到東西。
2. 「取代式」漏斗必敗，用聯集；豁免必須留災難語境出口。
3. 新資料源要同時改 fetch-live 預設值「與」ci-fetch-mode 顯式清單（缺陷 #6 的教訓）。
4. 來源失敗語義統一：全滅 throw、部分失敗續跑——不可吞錯回 ok。
5. 契約新增枚舉值前先 grep 全部生產者（缺陷 #9 的教訓）。
