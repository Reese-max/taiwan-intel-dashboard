// 國際情報 RSS 抓取（zero-dep，支援 RSS <item> 與 Atom <entry>）。
// 只負責「抓原文」；中文摘要/分類/風險/座標由 nvidia.mjs 正規化。

import { INTERNATIONAL_FEEDS } from "./international-feeds.mjs";

// 向後相容：既有呼叫未指定 feeds 時，預設使用國際新聞池。
export const FEEDS = INTERNATIONAL_FEEDS;

// Google News RSS（標準 RSS、Google 基礎設施穩定，且聚合全台媒體——含個別被擋的 ETtoday/三立/TVBS/聯合）。
// 用關鍵字鎖定主題；when:Nd 限定近 N 天確保新鮮。查詢詞勿過多（隱含 AND，太多會回 0）。
const gnews = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;

// 台灣警政相關每日新聞來源（目標：盡可能收集所有）。已稽核 2026-06-20（scripts/_audit-candidates.mjs 實測 item 數）。
// 主力＝Google News RSS（聚合全台媒體、含個別被擋的 ETtoday/三立/TVBS/聯合），OR 串同義詞、when:5d 限近 5 日。
// 重複新聞由 nvidia.normalizeDomesticNews 依標題去重。剔除：命案/兒少/應召等查詢回 0、ETtoday-feedburner、
// 警政署/交通部 RSS（回 0）、Focus Taiwan（404）、聯合報 UDN（被擋）。新增來源前先用 _audit-candidates.mjs 稽核。
const gq = (q) => gnews(q + " when:5d");
export const TW_NEWS_FEEDS = [
  // ── 直連媒體 RSS（穩定）──
  { label: "中央社 社會", url: "https://feeds.feedburner.com/rsscna/social", hint: "治安" },
  { label: "中央社 即時", url: "https://feeds.feedburner.com/cnaFirstNews", hint: "治安" },
  { label: "自由時報 社會", url: "https://news.ltn.com.tw/rss/society.xml", hint: "治安" },
  { label: "自由時報 地方", url: "https://news.ltn.com.tw/rss/local.xml", hint: "治安" },
  { label: "公視新聞", url: "https://news.pts.org.tw/xml/newsfeed.xml", hint: "治安" },
  // ── 詐騙／經濟犯罪 ──
  { label: "GN 詐騙逮捕", url: gq("詐騙 OR 詐欺 OR 車手 破獲 OR 逮捕"), hint: "反詐" },
  { label: "GN 假投資假交友", url: gq("假投資 OR 假交友 OR 解除分期 詐騙"), hint: "反詐" },
  { label: "GN 165打詐", url: gq("165 反詐騙 OR 打詐 OR 詐騙集團"), hint: "反詐" },
  { label: "GN 跨境詐騙人販", url: gq("柬埔寨 OR 緬甸 OR KK園區 詐騙 OR 人口販運"), hint: "反詐" },
  { label: "GN 人頭帳戶虛幣", url: gq("人頭帳戶 OR 虛擬貨幣 OR 加密貨幣 詐騙"), hint: "反詐" },
  { label: "GN 洗錢", url: gq("洗錢 偵破 OR 起訴 OR 查扣"), hint: "反詐" },
  { label: "GN 掏空內線", url: gq("掏空 OR 背信 OR 內線交易 起訴"), hint: "治安" },
  { label: "GN 個資駭客", url: gq("個資外洩 OR 駭客 OR 勒索病毒"), hint: "資安" },
  // ── 毒品 ──
  { label: "GN 毒品查獲", url: gq("毒品 OR 緝毒 OR 販毒 查獲 OR 起訴"), hint: "治安" },
  { label: "GN 毒品種類", url: gq("安非他命 OR 海洛因 OR 大麻 OR 愷他命 緝獲"), hint: "治安" },
  { label: "GN 新興毒品", url: gq("毒咖啡包 OR 喪屍煙彈 OR 依托咪酯 OR 笑氣"), hint: "治安" },
  // ── 竊盜／暴力／槍械 ──
  { label: "GN 竊盜搶奪", url: gq("竊盜 OR 失竊 OR 搶奪 OR 強盜 破案 OR 落網"), hint: "治安" },
  { label: "GN 傷害鬥毆", url: gq("持刀 OR 砍人 OR 鬥毆 OR 傷害"), hint: "治安" },
  { label: "GN 隨機攻擊", url: gq("隨機殺人 OR 無差別 攻擊"), hint: "治安" },
  { label: "GN 槍械", url: gq("槍擊 OR 槍枝 OR 改造手槍 查獲 OR 嫌犯"), hint: "治安" },
  { label: "GN 刀械爆裂物", url: gq("刀械 OR 爆裂物 OR 子彈 查緝"), hint: "治安" },
  // ── 性犯罪／婦幼／家暴 ──
  { label: "GN 性侵性騷", url: gq("性侵 OR 性騷擾 OR 性剝削 起訴 OR 移送"), hint: "治安" },
  { label: "GN 偷拍性影像", url: gq("偷拍 OR 私密影像 OR 數位性暴力"), hint: "治安" },
  { label: "GN 家暴兒虐", url: gq("家暴 OR 家庭暴力 OR 兒虐 OR 虐童"), hint: "治安" },
  { label: "GN 跟蹤騷擾", url: gq("跟蹤騷擾 OR 跟騷 OR 恐怖情人"), hint: "治安" },
  // ── 交通 ──
  { label: "GN 酒駕毒駕", url: gq("酒駕 OR 毒駕 取締 OR 死傷"), hint: "交通" },
  { label: "GN 車禍肇逃", url: gq("車禍 OR 肇事逃逸 死亡 OR 國道"), hint: "交通" },
  // ── 失蹤／人口販運 ──
  { label: "GN 失蹤協尋", url: gq("失蹤 OR 協尋 OR 走失 警方"), hint: "治安" },
  { label: "GN 人口販運", url: gq("人口販運 OR 強迫勞動 查獲 OR 起訴"), hint: "治安" },
  // ── 賭博／組織犯罪 ──
  { label: "GN 賭博博弈", url: gq("賭場 OR 線上博弈 OR 簽賭 查獲"), hint: "治安" },
  { label: "GN 幫派掃黑", url: gq("幫派 OR 黑道 OR 組織犯罪 掃黑 OR 火拼"), hint: "治安" },
  // ── 警察機關／檢調 ──
  { label: "GN 警政人事績效", url: gq("警政署 OR 警察局 政策 OR 人事 OR 績效"), hint: "治安" },
  { label: "GN 員警風紀殉職", url: gq("員警 殉職 OR 風紀 OR 貪瀆"), hint: "治安" },
  { label: "GN 刑事局偵破", url: gq("刑事局 偵破 OR 掃蕩 OR 專案"), hint: "治安" },
  { label: "GN 檢調起訴", url: gq("地檢署 OR 檢調 起訴 OR 搜索 OR 約談"), hint: "治安" },
  { label: "GN 收押通緝", url: gq("收押 OR 羈押 OR 通緝 OR 落網"), hint: "治安" },
  { label: "GN 貪污收賄", url: gq("貪污 OR 收賄 OR 圖利 起訴"), hint: "治安" },
  { label: "GN 臨檢攔查", url: gq("臨檢 OR 攔查 OR 路檢 查獲"), hint: "治安" },
  // ── 走私／海巡／移民 ──
  { label: "GN 海巡走私", url: gq("海巡署 查獲 走私 OR 毒品 OR 偷渡"), hint: "治安" },
  { label: "GN 移民署偷渡", url: gq("移民署 非法移工 OR 逾期居留 OR 偷渡"), hint: "治安" },
  // ── 消防／災害 ──
  { label: "GN 火警氣爆", url: gq("火警 OR 火災 OR 氣爆 搶救 OR 死傷"), hint: "災防" },
  { label: "GN 山難海難", url: gq("山難 OR 溺水 OR 海上 搜救 OR 救援"), hint: "災防" },
  { label: "GN 消防員傷亡", url: gq("消防員 殉職 OR 受傷"), hint: "災防" },
  // ── 國安 ──
  { label: "GN 共諜反滲透", url: gq("共諜 OR 間諜 OR 反滲透 起訴 OR 偵辦"), hint: "治安" },
  { label: "GN 認知作戰統戰", url: gq("認知作戰 OR 統戰 OR 滲透 中共"), hint: "治安" },

  // ══ 第二輪擴充（2026-06-20 稽核，往「更全」推）══
  // ── 主要媒體（新增直連）──
  { label: "Newtalk 社會", url: "https://newtalk.tw/rss/category/14", hint: "治安" },
  { label: "鏡週刊", url: "https://www.mirrormedia.mg/rss/rss.xml", hint: "治安" },
  { label: "Yahoo奇摩 社會", url: "https://tw.news.yahoo.com/rss/society", hint: "治安" },
  { label: "台視 社會", url: "https://www.ttv.com.tw/rss/RSSHandler.ashx?d=news&t=C", hint: "治安" },
  { label: "中央社 地方", url: "https://feeds.feedburner.com/rsscna/local", hint: "治安" },
  // ── 英文台媒 ──
  { label: "Focus Taiwan (EN)", url: "https://feeds.feedburner.com/rsscna/engnews", hint: "治安" },
  { label: "Taipei Times (EN)", url: "https://www.taipeitimes.com/xml/index.rss", hint: "治安" },
  // ── 政府機關一手 feed ──
  { label: "海巡署 海巡新聞", url: "https://www.cga.gov.tw/GipOpen/wSite/rss?ctNode=650&mp=999", hint: "治安" },
  { label: "移民署 新聞", url: "https://news.immigration.gov.tw/Rss/Content/9?lang=TW", hint: "治安" },
  { label: "法務部 新聞發布", url: "https://www.moj.gov.tw/2204/2795/2796/rss", hint: "治安" },
  { label: "衛福部 焦點新聞", url: "https://www.mohw.gov.tw/rss-16-1.html", hint: "治安" },
  { label: "公路局 最新消息", url: "https://www.thb.gov.tw/OpenData.aspx?SN=14F103987102091C", hint: "交通" },
  { label: "新北市警局 最新", url: "https://www.police.ntpc.gov.tw/rss-3344-1.html", hint: "治安" },
  // ── 重大刑案 ──
  { label: "GN 命案兇殺", url: gq("命案 OR 兇殺 OR 凶殺"), hint: "治安" },
  { label: "GN 殺人分屍", url: gq("殺人 OR 分屍 OR 棄屍"), hint: "治安" },
  { label: "GN 陳屍遺體", url: gq("陳屍 OR 浮屍 OR 遺體 尋獲"), hint: "治安" },
  { label: "GN 警匪槍戰", url: gq("警匪 槍戰 OR 追逐 OR 拒檢"), hint: "治安" },
  { label: "GN 情殺仇殺", url: gq("情殺 OR 仇殺 OR 滅門"), hint: "治安" },
  { label: "GN 擄人勒贖", url: gq("擄人 OR 勒贖 OR 撕票"), hint: "治安" },
  { label: "GN 縱火死傷", url: gq("縱火 死傷 OR 燒死"), hint: "災防" },
  // ── 食安/動物/環境/校園/工安 ──
  { label: "GN 食安黑心", url: gq("黑心食品 OR 食安 OR 病死豬 OR 餿水油"), hint: "治安" },
  { label: "GN 校園安全", url: gq("校園 安全 OR 霸凌 OR 割喉 OR 侵入"), hint: "治安" },
  { label: "GN 虐待動物", url: gq("虐待動物 OR 虐狗 OR 虐貓 OR 動保"), hint: "治安" },
  { label: "GN 廢棄物污染", url: gq("非法 廢棄物 OR 爐渣 OR 偷倒 污染"), hint: "災防" },
  { label: "GN 工安職災", url: gq("工安 OR 職災 OR 工地 死亡 OR 意外"), hint: "災防" },
  // ── 兒少/長照 ──
  { label: "GN 兒虐托嬰", url: gq("兒虐 OR 虐童 OR 托嬰 OR 保母 虐待"), hint: "治安" },
  { label: "GN 長照虐待", url: gq("長照 虐待 OR 照服員 OR 安養 虐待"), hint: "治安" },
  // ── 新型/經濟犯罪 ──
  { label: "GN AI深偽詐騙", url: gq("AI OR 深偽 OR Deepfake 詐騙"), hint: "反詐" },
  { label: "GN 詐領補助", url: gq("詐領 補助 OR 補助款 OR 防疫 詐領"), hint: "反詐" },
  { label: "GN 拒捕拒檢", url: gq("拒捕 OR 拒檢 衝撞 OR 逃逸 警方"), hint: "治安" },

  // ══ 第三輪擴充（2026-06-20 邊際覆蓋量測：補上未涵蓋題材，18 條 ≈ +214 不重複）══
  { label: "GN 妨害自由恐嚇", url: gq("妨害自由 OR 恐嚇 OR 強制"), hint: "治安" },
  { label: "GN 妨害秘密跟監", url: gq("妨害秘密 OR 跟監 OR 偷錄"), hint: "治安" },
  { label: "GN 襲警妨害公務", url: gq("襲警 OR 妨害公務 OR 攻擊員警"), hint: "治安" },
  { label: "GN 詐騙水房機房", url: gq("詐騙 水房 OR 機房 OR 洗錢"), hint: "反詐" },
  { label: "GN 偽造文書偽鈔", url: gq("偽鈔 OR 偽造文書 OR 變造證件"), hint: "治安" },
  { label: "GN 校園毒品", url: gq("校園 毒品 OR 學生 吸毒"), hint: "治安" },
  { label: "GN 假檢警監管帳戶", url: gq("假檢警 OR 監管帳戶 詐騙"), hint: "反詐" },
  { label: "GN 走私動物", url: gq("走私 保育類 OR 象牙 OR 動物"), hint: "治安" },
  { label: "GN 失智走失", url: gq("失智 走失 OR 老人 協尋"), hint: "治安" },
  { label: "GN 職棒簽賭打假球", url: gq("職棒 簽賭 OR 打假球 OR 運動賭博"), hint: "治安" },
  { label: "GN 環境污染偷排", url: gq("環境 污染 OR 廢水 OR 偷排"), hint: "災防" },
  { label: "GN 海關緝私", url: gq("海關 緝私 OR 機場 查獲"), hint: "治安" },
  { label: "GN 車手取款面交", url: gq("詐欺 提領 OR 面交 OR 取款 車手"), hint: "反詐" },
  { label: "GN 密醫違法醫美", url: gq("密醫 OR 違法醫美 OR 號販"), hint: "治安" },
  { label: "GN 金屬竊盜", url: gq("電纜 OR 水溝蓋 OR 人孔蓋 竊"), hint: "治安" },
  { label: "GN 公共場所性騷", url: gq("偷拍 捷運 OR 公共場所 性騷"), hint: "治安" },
  { label: "GN 網軍假訊息", url: gq("網軍 OR 假訊息 OR 假帳號 起訴"), hint: "治安" },
  { label: "GN 八大臨檢", url: gq("酒店 OR 8大行業 臨檢 OR 查緝"), hint: "治安" },

  // ══ 第四輪擴充（2026-06：經 _audit-candidates.mjs 實測 ≥3 則、去重後保留）══
  // 直連媒體＋官方來源（可溯源）
  { label: "newtalk 社會", url: "https://newtalk.tw/rss/category/2", hint: "治安" },
  { label: "警政署官網", url: gq("site:npa.gov.tw"), hint: "治安" },
  { label: "海巡署官網", url: gq("site:cga.gov.tw"), hint: "治安" },
  // 新主題角度（既有未涵蓋）
  { label: "GN 假網拍一頁式", url: gq("假網拍 OR 一頁式 OR 假購物 詐騙"), hint: "反詐" },
  { label: "GN 投資飆股群組", url: gq("飆股 OR 投資群組 OR 老師帶單 OR 存股社團 詐騙"), hint: "反詐" },
  { label: "GN 銀髮長者詐騙", url: gq("長者 OR 銀髮 OR 老翁 OR 老婦 詐騙"), hint: "反詐" },
  { label: "GN 假冒客服公務員", url: gq("假冒 客服 OR 假冒 公務員 詐騙"), hint: "反詐" },
  { label: "GN 一氧化碳中毒", url: gq("一氧化碳 中毒 死亡 OR 送醫"), hint: "災防" },
  { label: "GN 溺水戲水", url: gq("溺水 OR 戲水 OR 落水 搜救 OR 死亡"), hint: "災防" },
  { label: "GN 登山山域事故", url: gq("登山 OR 山域 迷途 OR 受困 OR 搜救"), hint: "災防" },

  // ══ 第五輪擴充（2026-06-23 _audit-candidates 實測 when:5d ≥3；聚焦第一手官方平台，提升官方來源占比）══
  // 直連媒體 RSS 經測全數 403/404（中時/三立/風傳媒/ETtoday/TVBS…），故新平台一律走 GN site: 路徑。
  { label: "消防署官網", url: gq("site:nfa.gov.tw"), hint: "災防" },
  { label: "臺北市警局官網", url: gq("site:police.gov.taipei"), hint: "治安" },
  { label: "臺中市警局官網", url: gq("site:police.taichung.gov.tw"), hint: "治安" },
  { label: "刑事警察局官網", url: gq("site:cib.npa.gov.tw"), hint: "治安" },
  { label: "調查局官網", url: gq("site:mjib.gov.tw"), hint: "治安" },
  { label: "央廣 RTI 治安", url: gq("site:rti.org.tw 警 OR 詐 OR 毒 OR 案"), hint: "治安" },
  { label: "Taiwan News EN 治安", url: gq("site:taiwannews.com.tw 警 OR 詐 OR 毒 OR 案 OR 逮 OR 起訴"), hint: "治安" },

  // ══ 第六輪擴充（2026-06-23 第二輪官方平台稽核 ≥3；臺南改用正確域名 tnpd.gov.tw）══
  { label: "臺南市警局官網", url: gq("site:tnpd.gov.tw"), hint: "治安" },
  { label: "彰化縣警局官網", url: gq("site:chpb.gov.tw"), hint: "治安" },
  { label: "高檢署官網", url: gq("site:tph.moj.gov.tw"), hint: "治安" },
  { label: "新北市消防局官網", url: gq("site:fire.ntpc.gov.tw"), hint: "災防" },

  // ══ 第七輪擴充（2026-06-27 _audit-candidates 實測 ≥13；新機關第一手官方平台 + 未涵蓋題材）══
  // ── 新增第一手官方機關（提升官方來源占比；直連政府 RSS 仍全數 404，故走 GN site:）──
  { label: "司法院官網", url: gq("site:judicial.gov.tw"), hint: "治安" },
  { label: "環境部官網", url: gq("site:moenv.gov.tw 污染 OR 稽查 OR 裁罰"), hint: "災防" },
  { label: "疾管署官網", url: gq("site:cdc.gov.tw 疫情 OR 防疫 OR 群聚"), hint: "災防" },
  { label: "農業部官網", url: gq("site:moa.gov.tw 走私 OR 防疫 OR 查獲"), hint: "治安" },
  { label: "食藥署官網", url: gq("site:fda.gov.tw 查獲 OR 違規 OR 回收"), hint: "治安" },
  { label: "內政部官網", url: gq("site:moi.gov.tw 治安 OR 警 OR 災"), hint: "治安" },
  // ── 未涵蓋題材角度 ──
  { label: "GN 土石流坍方", url: gq("土石流 OR 坍方 OR 邊坡 災情 OR 預警"), hint: "災防" },
  { label: "GN 虛擬資產交易所", url: gq("虛擬資產 OR 交易所 監管 OR 詐騙"), hint: "反詐" },
  { label: "GN 假冒銀行檢警", url: gq("假冒 銀行 OR 假冒 金管會 OR 假冒 檢警 詐騙"), hint: "反詐" },
  { label: "GN 詐騙簡訊釣魚", url: gq("詐騙 簡訊 OR 釣魚 連結 OR 假簡訊"), hint: "反詐" },
  { label: "GN 校園毒品咖啡包", url: gq("毒品 咖啡包 OR 上癮 OR 青少年 吸毒"), hint: "治安" },
  { label: "GN 租屋詐騙", url: gq("租屋 詐騙 OR 假房東 OR 二房東"), hint: "反詐" },

  // ══ 第八輪最大覆蓋（2026-06-27 _audit-candidates 實測 ≥3；接受更多 Google News 聚合來源）══
  // ── 可直連 RSS（避免全靠聚合，來源可溯）──
  { label: "中央廣播電臺 RSS", url: "https://www.rti.org.tw/rss", hint: "治安" },
  { label: "TechNews 科技新報 RSS", url: "https://technews.tw/feed/", hint: "資安" },
  { label: "iThome Security RSS", url: "https://www.ithome.com.tw/rss/security", hint: "資安" },
  { label: "iThome News RSS", url: "https://www.ithome.com.tw/rss/news", hint: "資安" },
  { label: "報導者 RSS", url: "https://www.twreporter.org/a/rss2.xml", hint: "治安" },
  { label: "INSIDE RSS", url: "https://www.inside.com.tw/feed/rss", hint: "資安" },
  // ── 主流／專題媒體 site-scoped Google News（直連 RSS 多為 403/404/410，故用聚合補覆蓋）──
  { label: "GN UDN 綜合治安", url: gq("site:udn.com/news 警 OR 詐 OR 毒 OR 案 OR 起訴"), hint: "治安" },
  { label: "GN ETtoday 綜合治安", url: gq("site:ettoday.net/news 警 OR 詐 OR 毒 OR 案 OR 起訴"), hint: "治安" },
  { label: "GN TVBS 綜合治安", url: gq("site:tvbs.com.tw/news 警 OR 詐 OR 毒 OR 案 OR 起訴"), hint: "治安" },
  { label: "GN 三立綜合治安", url: gq("site:setn.com 警 OR 詐 OR 毒 OR 案 OR 起訴"), hint: "治安" },
  { label: "GN CTWANT 綜合治安", url: gq("site:ctwant.com 警 OR 詐 OR 毒 OR 案 OR 起訴"), hint: "治安" },
  { label: "GN 風傳媒綜合治安", url: gq("site:storm.mg 警 OR 詐 OR 毒 OR 案 OR 起訴"), hint: "治安" },
  { label: "GN 上報綜合治安", url: gq("site:upmedia.mg 警 OR 詐 OR 毒 OR 案 OR 起訴"), hint: "治安" },
  { label: "GN 今周刊詐騙資安", url: gq("site:businesstoday.com.tw 詐騙 OR 洗錢 OR 個資 OR 資安"), hint: "反詐" },
  { label: "GN iThome 資安", url: gq("site:ithome.com.tw 資安 OR 個資 OR 駭客 OR 勒索"), hint: "資安" },
  { label: "GN TechNews 資安", url: gq("site:technews.tw 資安 OR 詐騙 OR 個資 OR 駭客"), hint: "資安" },
  { label: "GN 經濟日報詐騙金融", url: gq("site:money.udn.com 詐騙 OR 洗錢 OR 金管會 OR 虛擬資產"), hint: "反詐" },
  { label: "GN 數位時代資安", url: gq("site:bnext.com.tw 詐騙 OR 資安 OR 個資 OR 駭客"), hint: "資安" },
  // ── 補地方災防高回量來源 ──
  { label: "彰化縣消防局官網", url: gq("site:chfd.gov.tw 災害 OR 火警 OR 消防 OR 救護"), hint: "災防" },
  { label: "高雄市交通局災防", url: gq("site:tbkc.gov.tw 災害 OR 火警 OR 消防 OR 救護"), hint: "災防" },
];

function decode(s) {
  if (!s) return "";
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    // 實體解碼後可能現形的標籤（RSS 常見 &lt;p style=…&gt;）：再剝一次。
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pick(block, tags) {
  for (const tag of tags) {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
    if (m) return decode(m[1]);
  }
  return "";
}

function pickLink(block) {
  // RSS: <link>url</link> ; Atom: <link href="url"/>
  const rss = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
  if (rss && rss[1].trim().startsWith("http")) return decode(rss[1]);
  const atom = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
  return atom ? atom[1] : "";
}

function isGoogleNewsUrl(url = "") {
  try {
    return new URL(url).hostname === "news.google.com";
  } catch {
    return false;
  }
}

function feedQueryLabel(label = "") {
  return String(label || "").startsWith("GN ") ? label : undefined;
}

export function deriveNewsProvenance(item, { fetchedAt, model } = {}) {
  const viaGoogle = isGoogleNewsUrl(item.sourceUrl) || isGoogleNewsUrl(item.link);
  const queryLabel = feedQueryLabel(item.source);
  const publisherName = item.publisherName || (viaGoogle ? undefined : item.source);
  const normalization = model ? ` → LLM(${model}) 正規化` : "";

  return {
    name: publisherName || (viaGoogle ? "Google News 聚合" : item.source),
    type: "news-rss",
    datasetId: "tw-news",
    recordRef: item.link,
    url: item.link,
    fetchedAt,
    publisherName,
    publisherUrl: item.publisherUrl,
    aggregatorName: viaGoogle ? "Google News" : undefined,
    aggregatorUrl: viaGoogle ? item.sourceUrl : undefined,
    ingestMethod: viaGoogle ? "google-news-rss" : "direct-rss",
    sourceConfidence: viaGoogle ? "aggregated" : "verified",
    query: queryLabel
      ? `${queryLabel}｜RSS ${item.sourceUrl || ""}${normalization}`
      : `RSS ${item.sourceUrl || ""}${normalization}`,
  };
}

function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) || [];
  for (const b of blocks) {
    const sourceMatch = b.match(/<source(?:\s+url="([^"]+)")?[^>]*>([\s\S]*?)<\/source>/i);
    items.push({
      title: pick(b, ["title"]),
      link: pickLink(b),
      description: pick(b, ["description", "summary", "content"]),
      pubDate: pick(b, ["pubDate", "updated", "published"]),
      publisherName: sourceMatch ? decode(sourceMatch[2]) : undefined,
      publisherUrl: sourceMatch?.[1],
    });
  }
  return items;
}

async function fetchOne(feed, perFeed, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(feed.url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (taiwan-intel-dashboard pipeline)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = parseFeed(xml)
      .filter((i) => i.title && i.link)
      .slice(0, perFeed)
      .map((i) => ({ ...i, source: feed.label, sourceUrl: feed.url, hint: feed.hint }));
    return { ok: true, label: feed.label, items };
  } catch (e) {
    return { ok: false, label: feed.label, error: e.message, items: [] };
  } finally {
    clearTimeout(timer);
  }
}

// 回傳 { items: [...], feedStatus: [{label, ok, count, error}] }
export async function fetchRssItems({ perFeed = 5, timeoutMs = 12000, feeds = FEEDS, concurrency = 5 } = {}) {
  // 限制並行抓取數：避免一次對 Google News 開數十條連線被限流（實測 >~6 並發易出現 0）。
  const results = new Array(feeds.length);
  let next = 0;
  const worker = async () => {
    while (next < feeds.length) {
      const idx = next++;
      results[idx] = await fetchOne(feeds[idx], perFeed, timeoutMs);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, feeds.length) }, worker));
  const items = results.flatMap((r) => r.items);
  const feedStatus = results.map((r) => ({ label: r.label, ok: r.ok, count: r.items.length, error: r.error }));
  return { items, feedStatus };
}
