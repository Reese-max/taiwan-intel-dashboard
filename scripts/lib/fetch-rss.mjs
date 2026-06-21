// 國際情報 RSS 抓取（zero-dep，支援 RSS <item> 與 Atom <entry>）。
// 只負責「抓原文」；中文摘要/分類/風險/座標由 nvidia.mjs 正規化。

// 來源清單（category 僅為提示，最終分類由 LLM 重新判定；source.name 用 label）
export const FEEDS = [
  { label: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", hint: "地緣政治" },
  { label: "NPR World", url: "https://feeds.npr.org/1004/rss.xml", hint: "災害" },
  { label: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", hint: "地緣政治" },
  { label: "The Hacker News", url: "https://feeds.feedburner.com/TheHackersNews", hint: "資安" },
  { label: "CNBC Finance", url: "https://www.cnbc.com/id/10000664/device/rss/rss.html", hint: "金融" },
];

// Google News RSS（標準 RSS、Google 基礎設施穩定，且聚合全台媒體——含個別被擋的 ETtoday/三立/TVBS/聯合）。
// 用關鍵字鎖定主題；when:Nd 限定近 N 天確保新鮮。查詢詞勿過多（隱含 AND，太多會回 0）。
const gnews = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;

// 台灣警政相關每日新聞來源（目標：盡可能收集所有）。已稽核 2026-06-20（scripts/_audit-candidates.mjs 實測 item 數）。
// 主力＝Google News RSS（聚合全台媒體、含個別被擋的 ETtoday/三立/TVBS/聯合），OR 串同義詞、when:2d 限近 2 日。
// 重複新聞由 nvidia.normalizeDomesticNews 依標題去重。剔除：命案/兒少/應召等查詢回 0、ETtoday-feedburner、
// 警政署/交通部 RSS（回 0）、Focus Taiwan（404）、聯合報 UDN（被擋）。新增來源前先用 _audit-candidates.mjs 稽核。
const gq = (q) => gnews(q + " when:2d");
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

function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) || [];
  for (const b of blocks) {
    items.push({
      title: pick(b, ["title"]),
      link: pickLink(b),
      description: pick(b, ["description", "summary", "content"]),
      pubDate: pick(b, ["pubDate", "updated", "published"]),
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
