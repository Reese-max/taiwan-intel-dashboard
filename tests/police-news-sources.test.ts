import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fetchRssItems, TW_NEWS_FEEDS, deriveNewsProvenance } from "../scripts/lib/fetch-rss.mjs";
import { isRelevantNewsItem, mapBulkNews } from "../scripts/lib/news-bulk.mjs";
import { validateEventContract } from "../scripts/lib/event-contract.mjs";

const official = (title: string, description = "") => ({
  title, description, source: "警察／地方檢察署官網", hint: "治安", official: true,
  link: "https://www.npa.gov.tw/news/1", sourceUrl: "https://www.npa.gov.tw/rss",
  pubDate: "2026-11-04T00:00:00+08:00",
});

describe("官方警察檢調新聞的行政與宣導雜訊", () => {
  it.each([
    "嘉義縣警察局115年10月份公益勸募條例辦理公開徵信資料",
    "最新消息-臺北市政府資訊局約僱人員2名職缺甄選(委託本市就業服務處辦理)",
    "警察機關通譯聯絡窗口",
    "新聞稿-有關115年11月7日濟南路一段等路段舉行集會遊行活動實施交通管制、疏導措施說明",
    "新北市政府警察局慶祝615警察節影片",
    "為持續深化學童識詐教育，警政署製作識詐Podcast廣播劇《真的假的？》",
    "什麼是職場性騷擾？",
    "【禮品卡詐騙手法解析】",
    "高市警少年隊2警獲警政署長頒獎 -少年保護工作績優員警",
    "中檢四大系列反賄選宣導深入松鶴部落守護乾淨選舉 結合泰雅族語與原民文化，攜手原鄉守護民主",
    "雲檢召開115年第二次毒品戒治網絡平台聯繫會議新聞稿",
    "公告新竹市警察局舉發違反道路交通管理事件應受送達人清冊1份",
    "公示送達本署115年度偵字第15409號竊盜案不起訴處分書1件，應受送達人黃桂芬。",
    "南投縣政府警察局115年1-10月份家庭暴力案件統計表",
    "Untitled - 臺灣新北地方檢察署",
    "臺灣士林地方檢察署新聞稿 - 臺灣士林地方檢察署",
    "嘉義市政府警察局 - 嘉義市政府警察局",
    "「廢柴」出任務別讓你的選票被「柴」叼走屏檢攜手 社勞人彩繪水門社區",
    "齊心抗疫慈濟及民間企業捐贈保大警「防疫殺菌通道」等物資",
    "115/11/05 九合一大選倒數 全民作伙來反賄 基檢檢察長再次接受吉隆電視台專訪",
    "高雄地檢署選舉查賄司法警察專責隊進駐 黃檢察長授旗誓師強化查緝妨害選舉量能",
    "【看不見的陷阱，就在你我身邊】-犯罪防治 - 新北市政府警察局土城分局",
    "🔍 詐騙集團的「真假混搭」手法大破解： 這類詐騙最狡猾的地方，在於它會「參雜真實資訊來誤導」： - 新北市政府警察局土城分局",
    "杜絕ETC詐騙不點連結不上當！ - 嘉義市政府警察局",
    "東區興中街，台灣電力公司進行挖掘道路工程施工訊息 - 嘉義市政府警察局",
    "警察刑事紀錄證明 - 新北市政府警察局新店分局",
    "7月21日起良民證調整申辦及領證方式",
    "「警察好酷！」29名萌娃走進大溪分局 警察初體驗活潑熱鬧",
    "【競選小物免費送？留言＋1，小心遇上詐騙】 - 新北市政府警察局土城分局",
    "警察機關受理人與動物噪音檢舉案件法源依據及處理原則？ - 新北市政府警察局資訊服務網",
    // GN 地檢署：統計表、附表、偵結清冊、緩起訴金表
    "桃園地方檢察署執行裁判確定判決有罪者性別統 - 臺灣桃園地方檢察署",
    "臺灣高等檢察署所屬各地檢署檢察官（含檢察事務官）準時開庭調查統計分析表（統計期間：115 - 臺灣桃園地方檢察署",
    "附表二： 臺灣高等檢察署所屬各地檢署 - 臺灣桃園地方檢察署",
    "股別年冠字案號案由移送機關或告訴人被告偵結要旨孝115 偵 006421 傷害礁溪分局李○芬 - 臺灣宜蘭地方檢察署",
    "臺灣宜蘭地方檢察署緩起訴處分金被告履行支付情形 - 臺灣宜蘭地方檢察署",
  ])("排除：%s", title => {
    const item = official(title, "警察局辦理相關業務；防範詐騙、查獲犯罪。");
    expect(isRelevantNewsItem(item)).toBe(false);
    expect(mapBulkNews([item], { fetchedAt: "2026-11-05T00:00:00Z" })).toEqual([]);
  });

  it.each([
    "新北警打擊毒品不手軟，溯源查獲毒品分裝場-最新消息",
    "毒駕新制開鍘！嘉市警查獲本市首案，重罰並沒入車輛。",
    "送紅酒請託支持某區長候選人涉賄選 中檢漏夜聲請羈押候選人之配偶及樁腳2人",
    "宜蘭地檢署偵辦東○寺住持等涉犯公益侵占及洗錢等罪嫌",
    "【新聞】拒檢仍難逃法網！第五大隊巡邏查獲珍貴臺灣肖楠、香杉共340公斤",
    "雷霆除暴再出擊！楊梅警逮車手 175萬贓款全數追回",
    "警方反詐宣導現場查獲車手並移送",
    "假借捐贈名義詐騙，檢方偵破並起訴",
    "礁警即時處置工廠火警案",
    "員警救援失智翁 倒臥地面抱扶返家並連結長照資源",
    "新聞稿---士檢迅速組成專案小組 偵辦北投重大工安事故 即時勘驗現場 全力保全事證",
    "新聞稿---士林地檢持續強力查賄 搜索汐止區莊姓里長候選人 訊後諭知新臺幣30萬元具保候傳",
    "雄檢偵結高雄市動保處葉姓處長貪瀆案，依法提起公訴",
    "檢察官偵破大型吸金案",
    "檢方偵結假公益捐贈案提起公訴",
    "1151104桃檢同日執行二件里長現金及搓湯圓賄選案新聞稿-最新消息 - 臺灣桃園地方檢察署",
    "1151030桃檢偵辦北市沈姓市長候選人遭散布深偽音檔案新聞稿-最新消息 - 臺灣桃園地方檢察署",
    // 跨家族審查 S2：真實高雄 fixture 標題、宣導／施工字眼但有執法動作者
    "當志工有錢領」竟是吸金陷阱！高市警揭穿假公益龐氏騙局 籲民眾切勿落入投資圈套",
    "沒開店卻收扣款通知　高市警少年隊揭「假電商扣款」新騙局",
    "分局長頒獎表揚機警行員 警銀聯手成功阻詐保住老翁百萬",
    "毒駕新制施行首日 嘉市警攔查毒駕送辦",
    "道路工程施工未設警示釀車禍 警依過失傷害罪嫌送辦",
  ])("保留案件與既有救援：%s", title => {
    expect(isRelevantNewsItem(official(title))).toBe(true);
  });

  it("官方 GN 去掉署名後，車禍碰撞標題仍保留", () => {
    const item = { ...official("遊覽車不慎撞進長庚轉運站 - 桃園市政府警察局", "遊覽車不慎撞進長庚轉運站 桃園市政府警察局"), sourceUrl: "https://news.google.com/rss/search?q=site%3Atypd.gov.tw" };
    expect(isRelevantNewsItem(item)).toBe(true);
  });

  it("不擴大排除一般媒體或其他官方主題的事件", () => {
    expect(isRelevantNewsItem({ ...official("捐贈品遭竊 警方調查中"), official: false })).toBe(true);
    expect(isRelevantNewsItem({ ...official("豪雨道路交通管制公告"), hint: "災防" })).toBe(true);
  });

  it("官方 GN 的機關署名不替沒有事件詞的圖卡提供相關性", () => {
    const item = { ...official("自行車騎士也要有禮貌！ - 嘉義市政府警察局", "自行車騎士也要有禮貌！ 嘉義市政府警察局"), sourceUrl: "https://news.google.com/rss/search?q=site%3Accpb.gov.tw" };
    expect(isRelevantNewsItem(item)).toBe(false);
    expect(isRelevantNewsItem({ ...item, title: "毒駕新制開鍘！嘉市警查獲本市首案，重罰並沒入車輛。 - 嘉義市政府警察局" })).toBe(true);
  });

  it.each(["", "   "])("官方 RSS 缺摘要時以原標題落地，避免案件被事件契約丟棄：%j", description => {
    const item = official("雄檢偵結高雄市動保處葉姓處長貪瀆案，依法提起公訴", description);
    const events = mapBulkNews([item], { fetchedAt: "2026-11-05T00:00:00Z" });
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe(item.title);
    expect(validateEventContract(events).invalid).toEqual([]);
  });
});

// 桃園警局擋境外 IP 已從 TW_NEWS_FEEDS 移除；解析器保留並以同一設定測試，待有境內出口時接回。
const TAOYUAN_FEED = { label: "桃園市警局官網", url: "https://www.typd.gov.tw/index.php?catid=18&cid=1", parser: "police-taoyuan", hint: "治安" };
const feedByLabel = (label: string) => label === TAOYUAN_FEED.label ? TAOYUAN_FEED : TW_NEWS_FEEDS.find(f => f.label === label);

describe("高雄與桃園固定新聞列表解析", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["高雄市警局官網", "police-kaohsiung-news.html", "代客現煮販毒耍猴戲，高市警聯手特勤突襲製毒、毒品交易據點", "2026-11-03T00:00:00+08:00", "高雄市"],
    ["桃園市警局官網", "police-taoyuan-news.html", "交通違規露餡！楊梅警接連查獲2毒駕", "2026-11-04T00:00:00+08:00", "桃園市"],
  ])("%s 使用實際列表 fixture 保留完整標題、日期與 provenance", async (label, fixture, title, pubDate, jurisdiction) => {
    const feed = feedByLabel(label);
    expect(feed).toBeDefined();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8"))));
    const result = await fetchRssItems({ feeds: [feed], perFeed: 100, retryDelayMs: 0 });
    expect(result.feedStatus[0]).toMatchObject({ ok: true, count: 20 });
    const item = result.items.find(i => i.title === title);
    expect(item).toMatchObject({ title, pubDate, jurisdiction, official: true, ingestMethod: "direct-html" });
    expect(new URL(item.link).origin).toBe(new URL(feed.url).origin);
    expect(deriveNewsProvenance(item)).toMatchObject({ authority: "official", ingestMethod: "direct-html", sourceConfidence: "verified" });
    expect(isRelevantNewsItem(item)).toBe(true);
  });

  it.each(["高雄市警局官網", "桃園市警局官網"])("%s 遇到 200 錯誤頁回報來源失敗", async label => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>系統維護中</html>")));
    const result = await fetchRssItems({ feeds: [feedByLabel(label)], retryDelayMs: 0 });
    expect(result.feedStatus[0]).toMatchObject({ ok: false, count: 0 });
    expect(result.items).toEqual([]);
  });

  it("不接受站外文章、JavaScript 連結或不合法日期", async () => {
    const body = readFileSync(new URL("./fixtures/police-taoyuan-news.html", import.meta.url), "utf8")
      .replaceAll('href="index.php?', 'href="https://evil.example/index.php?');
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    const feed = TAOYUAN_FEED;
    expect((await fetchRssItems({ feeds: [feed], retryDelayMs: 0 })).items).toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body.replaceAll('https://evil.example/index.php?', 'javascript:alert(1)?'))));
    expect((await fetchRssItems({ feeds: [feed], retryDelayMs: 0 })).items).toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(readFileSync(new URL("./fixtures/police-taoyuan-news.html", import.meta.url), "utf8").replaceAll(/202[0-9]-\d{2}-\d{2}/g, "2026-02-30"))));
    expect((await fetchRssItems({ feeds: [feed], retryDelayMs: 0 })).items).toEqual([]);
  });
});

describe("涵蓋率量測補洞（2026-11-06 三立 sitemap 對照）", () => {
  const media = (title: string, description = "") => ({
    title, description, source: "GN 三立綜合治安", hint: "治安", official: false,
    link: "https://news.google.com/x", sourceUrl: "https://news.google.com/rss/search?q=x", pubDate: "2026-11-06T00:00:00+08:00",
  });

  it.each([
    "共諜案外的風暴／張俊傑潛逃扯出竹聯幫主之爭　檢調私下透露：中資介入 - 鏡週刊",
    "台64計程車丟包案今宣判！司機認「筆錄說謊」 家屬怒：應判無期徒刑",
    "誆送內衣誘少女自拍裸照！噁男一審遭重判…靠30萬「鈔能力」換自由 - 三立新聞網SETN.com",
    "國中女遭父體罰還受「薑罰」！母親急上網求助",
  ])("保留原本漏收的案件：%s", title => {
    expect(isRelevantNewsItem(media(title))).toBe(true);
  });

  it("不因「重判斷」「都更審」等詞誤收", () => {
    expect(isRelevantNewsItem(media("北市辯論爆要求給「穿鞋後身高」", "范立達表示，選民應慎重判斷候選人政見"))).toBe(false);
    expect(isRelevantNewsItem(media("老屋太多、都更審不完 專家喊話「處升格局」解塞車"))).toBe(false);
  });

  it("官方人事調整公告即使摘要提到一審、二審檢察署也排除", () => {
    expect(isRelevantNewsItem(official("法務部115年檢察官人事調整案，業經本部檢察官人事審議", "調動一審、二審檢察署主任檢察官"))).toBe(false);
  });
});
