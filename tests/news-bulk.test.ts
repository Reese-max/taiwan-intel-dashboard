import { describe, it, expect } from "vitest";
import {
  mapBulkInternationalNews,
  mapBulkNews,
  dedupeTitleKey,
  titleKey,
  cleanTitle,
  categoryFromItem,
  refreshDomesticNewsCategory,
  isForeignNonTaiwan,
  isNonEventNoise,
  isPoliceRelevant,
  isRelevantNewsItem,
  isFigurativeNewsNoise,
  buildNewsRelevanceAudit,
  riskFromTitle,
  detectCountyInBody,
} from "../scripts/lib/news-bulk.mjs";

const FETCHED_AT = "2026-06-20T00:00:00.000Z";

// figurative-overseas regression start
describe("國內新聞比喻與境外發行者", () => {
  it.each([
    "【盤前】甜甜價來了？外資殺人不眨眼 連兩日狠砍「0050」近17萬張",
    "華孚搶食車用大餅",
    "拓凱越南廠 搶航太商機",
    "和碩搶攻伺服器商機 鎖定代理型 AI 需求",
    "光麗搶進AI醫療！診所藥局雙軌擴張 明年營運拚轉強",
    "周春米選戰衝刺今起請假 率屏東隊市場掃街、路口拜票力拚連任",
    "沈伯洋選前黃金週衝刺 11/22邀市民出任務",
    "新店議員9搶5選情升溫 侯友宜接力車掃催票、綠營父子交棒遇風波",
    "外資再砍380億！台玻、台積電殺最兇 買賣超前10大一次看",
    "外資大屠殺！賣超前10大「ETF包辦6席」 它連兩日遭狠砍36萬張| 財經",
    "辰亦儒昔創「月營收5億」神話 送曾之喬百萬鑽戒被打槍",
    "本土投顧第一槍！台股「恐探35K」 5萬大關等明年",
    "台股上演史詩級大反攻！一週狂漲近4000點 資金瘋搶3大族群",
    "台股1個月以來急跌萬點 法人：不宜貿然搶反彈",
    "漫威粉絲快搶！「復仇者聯盟5」第二波預售開跑 12款限定小卡曝光",
    "阿里山賞楓列車11/17開搶！「楓度翩翩」主題列車12月限時5梯次",
    "物理治療人力荒⋯台大分院創院22年來首度不再「隨到隨做」祭高薪搶人",
    "【美股盤前】機構大砍AI支出預測！點名輝達首當其衝 聯發科TPU也中槍",
    "輝達大砍英特爾持股25% 轉加碼SpaceX、英特爾盤後再跌近4%",
    "澄清國防追加預算逾95%將過 藍黨團：「砍成零元賣台」謠言告到底",
  ])("剔除比喻：%s", (title) => {
    for (const hint of ["治安", "反詐", "災防"]) {
      expect(isRelevantNewsItem({ title, description: `${title} 經濟日報`, hint })).toBe(false);
      expect(isRelevantNewsItem({ title: "新聞焦點", description: title, hint })).toBe(false);
    }
  });

  it.each([
    ["被控涉詐助理費 新北市議員林銘仁判刑1年", "治安"],
    ["輝達介入台灣晶片走私案惹議！員工遭起訴、台積電拒絕協助", "治安"],
    ["青雲摜跌停，捲走私案遭檢調搜索！雷虎亮燈漲停，無人機預算案通過！｜口袋日報｜2026.06.30", "治安"],
    ["關渡橋頭八里路段死亡車禍機車騎士遭卡車輾過喪命- 股市爆料同學會", "治安"],
    ["台菲聯手打擊網路詐騙 菲律賓移民局再逮4台男", "反詐"],
    ["台中廠區工安意外釀1死 美光：自主停工調查原因", "災防"],
    ["柯文哲談遭羈押：最辛苦是外面家人", "治安"],
    ["台股雪崩，韭菜翻車！旺矽、倉和爆違約交割逾6500萬，千金股旺矽今年第2起", "治安"],
    ["淡水毒品債務討錢爆命案 43歲男遭刺頸胸腹亡…2兇嫌殺人罪送辦", "治安"],
    ["內埔男嫌怪手太吵開槍 警抄出制式霰彈槍等7槍400彈 法院火速裁押", "治安"],
    ["男子持刀搶劫超商", "治安"], ["婦人遭搶奪皮包", "治安"], ["銀行搶案", "治安"],
    ["「甜心議員」林穎孟離婚撕破臉！前夫動粗「扯棉被、搶手機」...判拘確定", "治安"],
    ["「管我叫什麼名字！」嘉義婦拒警盤查 帽打警員搶手機判罰9萬", "治安"],
    ["男子搶手提包", "治安"], ["男子搶手錶", "治安"],
    ["男子衝進餐廳搶客人手機後逃逸", "治安"], ["男子搶客人手提包", "治安"],
    ["持刀刺傷路人", "治安"], ["男子砍人", "治安"], ["男子開槍", "治安"],
    ["狠砍路人", "治安"], ["男子中槍", "治安"], ["兇手殺人不眨眼", "治安"],
    ["嫌犯朝店家開出第一槍", "治安"],
    ["外資大砍持股 公司涉詐遭搜索", "治安"],
    ["台股大跌 男子中槍", "治安"],
    ["新店議員選前衝刺遭持刀刺傷", "治安"],
    ["搶攻AI市場 業者遭詐騙", "治安"],
  ])("保留真案件事故：%s", (title, hint) => {
    expect(isRelevantNewsItem({ title, description: title, hint, source: "經濟日報" })).toBe(true);
  });

  it.each([
    ["北角丹拿道破毒品快餐車 兩男疑車內吸毒被捕", "星島頭條"],
    ["港漢行李藏大麻煙機場被截", "澳門日報"],
    ["三藩市大麻監管辦公室介紹職能", "Singtaousa"],
    ["荔景站偷拍裙底 休班警判120小時社服令", "明報"],
    ["宏福苑殉職消防員何偉豪周二浩園立碑", "香港01"],
    ["藍田啟田邨火警 消防救出長毛貓", "Singtaousa"],
    ["堪培拉持刀犯罪加劇 政府不能再坐視不管", "大紀元時報香港"],
    ["拱北海關揭偷運大麻煙", "澳門廣播電視股份有限公司"],
    ["羅湖口岸海關查獲體內藏毒案", "香港01"],
    ["越南籍男女觀塘超市偷牛柳落網", "on.cc東網"],
    ["港人遭詐騙 外籍移工涉案", "TVB"],
    ["本地個資外洩案", "香港01"],
  ])("剔除境外當地新聞：%s", (title, source) => {
    for (const publisher of [source, { name: source, aggregatorName: "Google News", query: "台灣治安" }]) {
      expect(isRelevantNewsItem({ title, description: title, source: publisher, hint: "治安" })).toBe(false);
    }
  });

  it.each([
    "香港01", "Sing Tao Daily 星島日報加拿大", "星島頭條", "Singtaousa", "加拿大星島日報",
    "on.cc東網", "澳門廣播電視股份有限公司", "澳門日報", "澳門力報", "澳門特別行政區政府入口網站",
    "dotdotnews", "巴士的報", "RTHK News", "明報新聞網", "香港政府資訊中心", "香港經濟日報HKET",
    "香港文匯報", "大公文匯網", "香港商报", "東方日報", "TVB", "大紀元時報香港", "華人今日網", "澳洲看新闻",
  ])("發行者清單：%s", (source) => {
    expect(isRelevantNewsItem({ title: "超市偷竊案", source })).toBe(false);
  });

  it("RSS 原始項目的發行者在頂層 publisherName", () => {
    expect(isRelevantNewsItem({ title: "北角丹拿道破毒品快餐車 兩男疑車內吸毒被捕", publisherName: "星島頭條", source: "GN 毒品", hint: "治安" })).toBe(false);
    expect(isRelevantNewsItem({ title: "北角丹拿道破毒品快餐車 兩男疑車內吸毒被捕", publisherName: "自由時報", source: "GN 毒品", hint: "治安" })).toBe(true);
  });

  it.each([
    ["半個月連遭兩度槍擊恐嚇！台灣歌手「芒果王子」急報警：我不怕事", "香港01", "治安"],
    ["高雄校園午餐食安連環爆 三杯雞驚見完整青蛙", "Singtaousa", "食安"],
    ["超市偷竊案", "TVBS新聞網", "治安"],
    ["超市偷竊案", "TVBS", "治安"],
    ["超市偷竊案", "台灣大紀元", "治安"],
    ["駭客竊資售殯葬業者 兩駭客遭羈押", "大紀元", "資安"],
    ["超市偷竊案", "臺灣大紀元", "治安"],
    ["超市偷竊案", "未列名媒體", "治安"],
  ])("保留台灣關聯或非清單發行者：%s", (title, source, hint) => {
    expect(isRelevantNewsItem({ title, source, hint })).toBe(true);
  });

  it.each(["台灣", "臺灣", "中華民國", "台北", "新北", "高雄", "金門", "馬祖", "國人", "兩岸", "來台", "在臺", "赴台", "返台", "台男", "台女", "台商"])("摘要台灣關聯：%s", (description) => {
    expect(isRelevantNewsItem({ title: "超市偷竊案", description, source: "香港01" })).toBe(true);
  });

  it("新規則不影響官方與國際來源，也不改寫輸入", () => {
    for (const metadata of [{ official: true }, { source: { authority: "official" } }, { scope: "international" }, { datasetId: "international-news" }]) {
      expect(isRelevantNewsItem({ title: "搶攻新市場", ...metadata })).toBe(true);
      expect(isRelevantNewsItem({ title: "超市偷竊案", source: "香港01", ...metadata })).toBe(true);
    }
    const item = { title: "搶攻新市場", description: "衝刺業績", hint: "治安" };
    isRelevantNewsItem(item);
    expect(item).toEqual({ title: "搶攻新市場", description: "衝刺業績", hint: "治安" });
    expect(isRelevantNewsItem({ title: "搶攻新市場", description: "業者涉詐遭起訴", hint: "治安" })).toBe(true);
  });

  it.each([
    "外資殺紅眼 連3天賣超台積電",
    "外資續砍台股 新台幣貶值壓力難解創逾19個月新低",
    "投信大砍6檔金融！它3天倒貨3.2萬張股價崩10.73% 45萬股東傻眼",
    "三大法人賣超632億！外資連3賣狂砍766億、投信轉買大成鋼",
    "外資連3砍台積電！今賣超8466張收最低 進出前10大一次看",
    "外資大屠殺ETF！0050連3天遭砍19.3萬張 股價竟逆勢翻紅",
    "前3季營收年減近6％！米斯特砍低效門市 押寶韓設計師品牌",
    "專訪》Arm自己賣CPU 會搶聯發科、高通生意？副總裁揭開AI晶片競合新戰局",
    "免高學歷年薪破80萬！半導體大廠急搶「這類基層」 近5成企業願加薪",
    "輝達財報成績單滿分！Vera Rubin迎爆炸開局、給強勁財測",
    "股王慘丟萬金破案！投信連2砍 天價進場1張最多賠1208萬",
    "【新新聞】AI算力預測狂砍1.6兆美元！黃仁勳離開輝達的風暴還沒算進去",
  ])("財經語境的砍搶殺是比喻：%s", (title) => {
    for (const hint of ["治安", "反詐", "災防"]) {
      expect(isRelevantNewsItem({ title, description: title, hint, source: "三立新聞網SETN.com" })).toBe(false);
    }
  });

  it.each([
    ["台灣非法殯葬業者勾結駭客，以AI入侵消防系統通報搶賺死人生意", "災防"],
    ["台股開盤前 銀行分行遭持槍搶劫", "治安"],
    ["股東會爆衝突 股東遭砍傷送醫", "治安"],
    ["投資糾紛釀血案 男子殺害股東後落網", "治安"],
    ["男子闖門市搶手機 業者營收受損", "治安"],
    ["詐團捲款3億 車手持刀砍傷被害人", "治安"],
    ["台中生意糾紛 男子遭砍十多刀送醫", "治安"],
    ["台中男子搶銀行 稱生意失敗缺錢", "治安"],
    ["台中股東遭砍殺", "治安"],
    ["台中男子搶銀樓 稱生意失敗缺錢", "治安"],
    ["台中生意糾紛 男子遭砍斷手指", "治安"],
    ["台中生意糾紛 老闆遭砍斷手指", "治安"],
    ["台中生意糾紛 兄弟互砍", "治安"],
    ["台中男生意失敗搶銀樓", "治安"],
    ["搶劫銀行 搶走客戶存款", "治安"],
    ["台中投資人遭砍十多刀送醫", "治安"],
    ["台中男子遭砍倒在門市前", "治安"],
    ["台中男子搶銀行客戶現金", "治安"],
  ])("財經語境的真案件保留：%s", (title, hint) => {
    const item = { title, description: title, hint, source: "經濟日報" };
    expect(isRelevantNewsItem(item)).toBe(true);
    expect(isFigurativeNewsNoise(item)).toBe(false);
  });

  it.each([
    "男子年薪百萬 搶買新車",
    "蔣萬安急搶小草票也沒用？王世堅：柯文哲1招拉高政治價碼",
    "選情觀察》中正萬華搶第4席！張銘祐緊咬藍營3將 成綠營全壘打關鍵",
    "花蓮縣長候選人搶開普發現金支票…恐拖累縣庫？縣府說明財政狀況",
    "金馬63／男配角5強 朱軒洋搶鏡、黃冠智拚突圍",
    "楊奇煜172公分身高遭男團海放！嗆靠顏值搶C位",
    "Uber Eats熱銷冠軍是它！10年賣2千萬份 麥當勞、漢堡王買1送1限時搶",
    "TPBL／林書緯傷癒狂砍27分 克雷格大三元奪單週MVP",
    "黃金11年最慘！高盛砍目標價 重返5600美元要等到2028年",
    "00981A兩天跌12.83%！瑤姐狠下心大砍它 反加碼這兩檔",
    "得獎公告／《名偵探柯南第30號殺人事件》雙人電影票",
    "與天搶命！口服標靶藥 助童腫瘤縮小",
    "COP31／96%珊瑚礁極度瀕危 台達電用LED、機器手臂搶救",
  ])("選戰、演藝、消費、球賽的搶砍殺不算案件：%s", (title) => {
    expect(isRelevantNewsItem({ title, description: title, hint: "治安", source: "三立新聞網SETN.com" })).toBe(false);
  });

  it.each([
    "花蓮老翁清晨步行穿越道路遭車撞 送醫搶救不治",
    "快訊／台64線「4車撞一團」車流大回堵！ 1命危、3傷送醫搶救中",
    "快訊／三重菜市場父子爆口角！兒「激動點火」釀三度燙傷搶救中",
    "彰化村長夫妻離奇雙亡！兒還原搶救過程",
    "死神前搶命！台中50歲男「癱坐駕駛座」腦溢血 暖警神反應救回一命",
    "北捷隨機殺人事件 嫌犯判死",
    "男子遭砍3刀送醫",
    "男子持刀搶走車票",
    "搶救病人20多年換自己倒下！急診醫值班中風 職災遭拒心寒發聲",
    "歹徒持刀砍福利社店員後逃逸",
    "搶救作業期間工人跌落地坑",
  ])("有傷亡或事故跡象的搶救與真案件保留：%s", (title) => {
    const item = { title, description: title, hint: "治安", source: "三立新聞網SETN.com" };
    expect(isRelevantNewsItem(item)).toBe(true);
    expect(isFigurativeNewsNoise(item)).toBe(false);
  });

  it("移民署新聞網轉載的財經新聞不算案件，移民署查緝照收", () => {
    const base = { source: "移民署 新聞", official: true, hint: "治安" };
    expect(isRelevantNewsItem({ ...base, title: "台股1個月以來急跌萬點 法人：不宜貿然搶反彈" })).toBe(false);
    expect(isRelevantNewsItem({ ...base, title: "AI換臉假護照金門闖關踢鐵板！重犯發監前夕遭移民署當場攔截" })).toBe(true);
  });

  it.each([
    "涉替中共偷拍美機場 中國留學生被判羈押候審",
    "堪培拉持刀犯罪加劇 政府不能再坐視不管",
    "領館外襲擊法輪功學員 嫌犯返中國遭加國通緝",
    "受賄數額特別巨大 西藏女「老虎」王峻被公訴",
    "亞省東部高速公路車禍 一女兩兒童亡",
    "參與詐騙美國老人2700萬 中國男子獲刑6年半",
    "警察局（HPD）",
    "艾姆赫斯特少年遭槍擊 警方通緝嫌犯",
    "麻州男子持槍搶劫超市",
  ])("大紀元總站標題有海外地名就剔除：%s", (title) => {
    expect(isRelevantNewsItem({ title, description: `${title} 大紀元`, source: "大紀元", hint: "治安" })).toBe(false);
  });

  it.each([
    "台中市長政見辯論會 何欣純控藍不實言論恐嚇長輩",
    "駭客竊資售殯葬業者 兩駭客遭羈押",
    "共諜案 中共滲透國軍 退役中校遭起訴",
    "北市美籍男子販毒遭起訴",
    "美籍男子酒駕撞死人 法院判刑",
    "北市日本籍男子販毒遭起訴",
    "和美警破獲販毒集團",
    "北市美籍男子持日本刀砍人",
    "美籍男子持日本刀砍人",
    "刑事局破獲跨境運毒集團 查扣泰國大麻",
    "北檢偵辦日本進口大麻案 起訴3人",
    "高市破獲日本大麻走私案",
    "雄檢偵辦日本大麻走私案",
  ])("大紀元總站地點不明或在台灣就保留：%s", (title) => {
    expect(isRelevantNewsItem({ title, description: `${title} 大紀元`, source: "大紀元", hint: "治安" })).toBe(true);
  });
});
// figurative-overseas regression end

describe("嘉義縣市地點辨識", () => {
  it.each([
    ["嘉義縣東石鄉車禍 騎士送醫", "嘉義縣", "city"],
    ["嘉縣道路車禍 騎士送醫", "嘉義縣", "city"],
    ["嘉義市東區車禍 騎士送醫", "嘉義市", "city"],
    ["嘉市道路車禍 騎士送醫", "嘉義市", "city"],
    ["嘉義東石鄉車禍 騎士送醫", "嘉義縣", "city"],
    ["嘉義 東石鄉車禍 騎士送醫", "嘉義縣", "city"],
    ["嘉義車禍 騎士送醫", "嘉義市", "city"],
  ])("依標題辨識 %s", (title, expectedRegion, expectedPrecision) => {
    const events = mapBulkNews(
      [{ title, link: "https://example.test/chiayi", description: "交通事故", source: "s", sourceUrl: "u", hint: "治安", pubDate: "x" }],
      { fetchedAt: FETCHED_AT },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ region: expectedRegion, locationPrecision: expectedPrecision });
    if (expectedPrecision === "unknown") {
      expect(events[0]).toMatchObject({ lat: null, lng: null });
    }
  });

  it("摘要的嘉義短名接縣轄鄉鎮時判嘉義縣", () => {
    expect(detectCountyInBody("嘉義東石鄉車禍造成道路中斷")).toMatchObject({ region: "嘉義縣" });
  });
});

const ITEMS = [
  { title: "高雄街頭砍人 男子背部受傷送醫 - 自由時報", link: "https://x/1", description: "街頭鬥毆", source: "自由時報 社會", sourceUrl: "u1", hint: "治安", pubDate: "Fri, 20 Jun 2026 01:00:00 +0800" },
  { title: "新北詐騙集團車手落網", link: "https://news.google.com/rss/articles/2?oc=5", description: "假檢警詐騙", source: "GN 詐騙逮捕", sourceUrl: "https://news.google.com/rss/search?q=詐騙逮捕", hint: "反詐", pubDate: "Fri, 20 Jun 2026 02:00:00 +0800" },
  { title: "台南工廠火警濃煙竄天", link: "https://news.google.com/rss/articles/3?oc=5", description: "消防搶救", source: "GN 火警氣爆", sourceUrl: "https://news.google.com/rss/search?q=火警氣爆", hint: "災防", pubDate: "Fri, 20 Jun 2026 03:00:00 +0800" },
  // 重複標題（不同連結/媒體）→ 去重
  { title: "高雄街頭砍人 男子背部受傷送醫 - ETtoday", link: "https://x/4", description: "...", source: "GN 傷害鬥毆", sourceUrl: "u4", hint: "治安", pubDate: "x" },
];

describe("titleKey / cleanTitle", () => {
  it("strips media suffix for dedup key and display", () => {
    expect(cleanTitle("高雄街頭砍人 - 自由時報")).toBe("高雄街頭砍人");
    expect(titleKey("高雄街頭砍人 - 自由時報")).toBe(titleKey("高雄街頭砍人 - ETtoday"));
  });
});

describe("mapBulkInternationalNews", () => {
  it("全量收錄國際 RSS、保留官方來源，並讓 LLM id 排除 bulk 重複", () => {
    const items = [
      {
        title: "Global ransomware attack disrupts hospitals",
        link: "https://example.test/intl/cyber",
        description: "Hospitals reported service disruptions after a ransomware attack.",
        source: "BBC World",
        sourceUrl: "https://example.test/bbc.xml",
        hint: "資安",
        pubDate: "2026-06-20T01:00:00.000Z",
      },
      {
        title: "Global ransomware attack disrupts hospitals",
        link: "https://example.test/intl/cyber-copy",
        description: "Syndicated duplicate.",
        source: "Guardian World",
        sourceUrl: "https://example.test/guardian.xml",
        hint: "資安",
        pubDate: "2026-06-20T01:01:00.000Z",
      },
      {
        title: "Police arrest fraud suspects",
        link: "https://example.test/intl/police",
        description: "Police arrested suspects in a cross-border fraud case.",
        source: "US DOJ Press Releases",
        sourceUrl: "https://example.test/doj.xml",
        hint: "反詐",
        official: true,
        pubDate: "2026-06-20T02:00:00.000Z",
      },
    ];

    const events = mapBulkInternationalNews(items, { fetchedAt: FETCHED_AT });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      scope: "international",
      region: "國際",
      category: "資安",
      locationPrecision: "unknown",
      source: {
        datasetId: "international-news",
        normalizationMethod: "bulk",
      },
    });
    expect(events[0].summary).toContain("Hospitals reported");
    expect(events[0].source.query).toContain("輕量收錄");
    expect(events[1]).toMatchObject({
      category: "反詐",
      source: { authority: "official", datasetId: "international-news" },
    });

    const excluded = mapBulkInternationalNews(items, {
      fetchedAt: FETCHED_AT,
      excludeIds: new Set([events[0].id]),
    });
    expect(excluded.map((event) => event.id)).toEqual([events[1].id]);
  });

  it.each([
    ["New molecular study explains cell repair", "其他", "Scienmag", "其他", "hint:其他"],
    ["Major earthquake damages homes in Chile", "金融", "BBC World", "災害", "evidence:災害"],
    ["Hospitals disrupted by ransomware attack", "災害", "Scienmag", "資安", "evidence:資安"],
    ["Stock market crash follows bank earnings", "災害", "Financial News", "金融", "evidence:金融"],
    ["Infectious disease outbreak spreads across region", "災害", "BBC World", "災害", "evidence:災害"],
    ["Infection control protocol contains Candida auris outbreak", "災害", "Scienmag", "其他", "rule:science-publication"],
    ["Magnitude 5.2 event recorded at station", "災害", "USGS Quakes M4.5 week", "其他", "rule:no-disaster-evidence"],
  ])("國際分類以標題摘要證據優先：%s", (title, hint, source, category, categoryBasis) => {
    const [event] = mapBulkInternationalNews([{ title, hint, source, link: `https://example.test/${encodeURIComponent(title)}` }], { fetchedAt: FETCHED_AT });
    expect(event).toMatchObject({ category, categoryBasis });
  });

  it("分類關鍵字只看標題，摘要背景詞不蓋過 feed hint", () => {
    const [event] = mapBulkInternationalNews([{
      title: "Researchers explain brain banks and military veterans",
      description: "A flood of wealth follows the company's IPO; police custody healthcare study",
      hint: "其他",
      source: "Scienmag",
      link: "https://example.test/context-only-keywords",
    }], { fetchedAt: FETCHED_AT });
    expect(event).toMatchObject({ category: "其他", categoryBasis: "hint:其他" });
  });
});

const categoryCases = [
  ["台股雪崩，韭菜翻車！旺矽、倉和爆違約交割逾6500萬，千金股旺矽今年第2起", "非交通"],
  ["又有韭菜翻車？2檔爆鉅額違約交割合計金額6502萬元", "非交通"],
  ["少年股神翻車！2檔台股「違約交割6千萬」 千金股旺矽今年第2起", "非交通"],
  ["輝達風暴襲台廠1／搭AI快車台廠進入黃金年代 輝達翻車韓國趁虛而入拚翻盤", "非交通"],
  ["愛車失蹤竟是記錯車位！三多警調監視器抽絲剝繭，助六旬車主尋回機車", "非交通"],
  ["北市保大選前掃黑臨檢 查獲騎士車內藏安非他命藥錠100顆", "治安"],
  ["騎機車帶路到選民家 1票1千元 屏東縣里港鄉代候選人父涉賄遭起訴", "治安"],
  ["前鎮警追查無牌機車 42歲女小吃店內遭逮 安非他命快篩陽性", "治安"],
  ["74歲翁騎車出門失聯！機車留加走埤旁 隔日上午尋獲已溺斃", "非交通"],
  ["台64線五股段4貨車連環撞 釀1死3傷", "交通"],
  ["快訊／三峽馬自達女疑越雙黃線撞黃牌重機 騎士搶救1小時不治", "交通"],
  ["影音／清晨例行散步遇死劫！花蓮77歲翁過馬路返家遭小貨車撞亡", "交通"],
  ["國1新竹系統3車連環撞！小貨車頭變形駕駛受困 34歲孕婦遭波及共3人送醫", "交通"],
  ["快訊／台南大貨車右轉輾機車 女騎士「頭顱破裂」當場身亡", "交通"],
  ["台中母子登山遇雨折返竟翻車 疑煞車失靈撞山壁受困驚險獲救", "交通"],
  ["交通新制11月上路！機車停車制度改了「停錯小心被罰1200元」， 最新取締標準一次看", "交通"],
  ["酒駕自撞掉輪仍狂飆！通緝犯拖行4.6公里狂冒火星 酒測值高達0.99", "交通"],
  ["貨車自撞電桿 駕駛受困", "交通"],
  ["機車擦撞行人 騎士遭起訴", "交通"],
  ["兩車對撞 消防救出受困駕駛", "交通"],
  ["跨海訪問／《碰撞搜查線2》弄壞46輛車！ 李民基「隨身帶棉被」笑翻全場", "非交通"]
];

describe("國內新聞交通分類回歸", () => {
  it.each(categoryCases)("%s → %s", (title, expected) => {
    for (const hint of [undefined, "治安"]) {
      const result = categoryFromItem(title, hint);
      if (expected === "非交通") expect(result.category).not.toBe("交通");
      else expect(result.category).toBe(expected);
    }
  });
});

describe("refreshDomesticNewsCategory", () => {
  it("LLM 正規化過的事件（標題可能被改寫）沒有原始項目時不重算", () => {
    const event = { id: "twnews-x", title: "老婦外出迷路 警助返家", category: "協尋", categoryBasis: "rule:協尋",
      aiTopic: "協尋", scope: "domestic", source: { datasetId: "tw-news" } };
    expect(refreshDomesticNewsCategory(event)).toBe(event);
  });
});

describe("mapBulkNews", () => {
  it("標記 bulk categoryBasis：rule / hint / default，且 category 判定不變", () => {
    expect(categoryFromItem("新北詐騙集團車手落網", "治安")).toEqual({
      category: "反詐",
      basis: "rule:反詐",
    });
    expect(categoryFromItem("醫院資訊系統遭駭客攻擊 個資外洩", "資安")).toEqual({
      category: "資安",
      basis: "hint:資安",
    });
    expect(categoryFromItem("高雄街頭砍人 男子背部受傷送醫", undefined)).toEqual({
      category: "治安",
      basis: "default",
    });
  });

  it("協尋規則：失蹤/走失/尋人細分出協尋，且不搶災防/反詐既有規則", () => {
    expect(categoryFromItem("8旬失智翁走失2天 警調閱監視器尋獲", "治安")).toEqual({
      category: "協尋",
      basis: "rule:協尋",
    });
    expect(categoryFromItem("15歲少女離家失聯 家屬急尋人", "治安")).toEqual({
      category: "協尋",
      basis: "rule:協尋",
    });
    expect(categoryFromItem("老婦騎三輪車迷航40公里 東港警助返家", "治安")).toEqual({
      category: "協尋",
      basis: "rule:協尋",
    });
    // 災防語境優先：溺水/搜救類失蹤維持災防。
    expect(categoryFromItem("東港漁民落海失蹤 海巡搜救中", "治安").category).toBe("災防");
    // 反詐優先：詐團話術含失聯不得改判協尋。
    expect(categoryFromItem("假投資群組收錢後失聯 受害者報案", "治安").category).toBe("反詐");
    // 一般治安不受影響。
    expect(categoryFromItem("持刀搶超商 嫌犯落網", "治安").category).toBe("治安");
    // 負向排除：失聯移工查緝、命案報導、通緝逃亡、詐團失聯話術皆非尋人。
    expect(categoryFromItem("桃警攔違停意外逮6失聯移工 車內通緝犯落網", "治安").category).toBe("治安");
    expect(categoryFromItem("泰山姊弟命案 失聯父遺體今相驗", "治安").category).toBe("治安");
    expect(categoryFromItem("醫美負責人境外失聯 不甩檢方遭通緝", "治安").category).toBe("治安");
    expect(categoryFromItem("匯數萬元買裝備 對方一句查帳中秒失聯被騙", "反詐").category).toBe("反詐");
  });

  it("dedupes by title, classifies by hint, geocodes by county, scores risk", () => {
    const ev = mapBulkNews(ITEMS, { fetchedAt: FETCHED_AT });
    expect(ev).toHaveLength(3); // 去重後 3
    const ks = ev.find((e) => e.title.includes("砍人"));
    expect(ks!.region).toBe("高雄市");
    expect(ks!.lat).toBeCloseTo(22.6273, 2);
    expect(ks!.category).toBe("治安");
    expect(ks!.categoryBasis).toBe("hint:治安");
    expect(ks!.riskLevel).toBe("high"); // 砍人
    expect(ks!.scope).toBe("domestic");
    expect(ks!.source.datasetId).toBe("tw-news");

    const fraud = ev.find((e) => e.title.includes("車手"));
    expect(fraud!.region).toBe("新北市");
    expect(fraud!.category).toBe("反詐");
    expect(fraud!.categoryBasis).toBe("rule:反詐");
    expect(fraud!.riskLevel).toBe("medium"); // 詐騙
    expect(fraud!.source.name.startsWith("GN ")).toBe(false);
    expect(fraud!.source.aggregatorName).toBe("Google News");
    expect(fraud!.locationPrecision).toBe("city");

    const fire = ev.find((e) => e.title.includes("火警"));
    expect(fire!.region).toBe("臺南市");
    expect(fire!.category).toBe("災防");
    expect(fire!.categoryBasis).toBe("rule:災防");
  });

  it("dedupes repeated outlet/category suffix variants while preserving titleKey exclusions", () => {
    const title = "新店23歲男4樓住處墜落";
    const events = mapBulkNews([
      { title: `${title}| 社會萬象| 社會`, link: "https://x/a", description: "新店發生墜落事故", hint: "治安" },
      { title: `快訊／${title} - ETtoday`, link: "https://x/b", description: "新店發生墜落事故", hint: "治安" },
    ], { fetchedAt: FETCHED_AT });
    expect(dedupeTitleKey(`${title}| 社會萬象| 社會`)).toBe(dedupeTitleKey(title));
    expect(events).toHaveLength(1);
  });

  it("excludes titles already enriched", () => {
    const exclude = new Set([titleKey("高雄街頭砍人 男子背部受傷送醫 - 自由時報")]);
    const ev = mapBulkNews(ITEMS, { fetchedAt: FETCHED_AT, excludeKeys: exclude });
    expect(ev.find((e) => e.title.includes("砍人"))).toBeUndefined();
    expect(ev).toHaveLength(2);
  });

  it("filters out non-police items (health/culture/policy noise)", () => {
    const noise = [
      { title: "癌症篩檢抽大獎 嘉義縣送iPhone 17", link: "https://x/a", description: "鼓勵民眾顧健康", source: "s", sourceUrl: "u", hint: "治安", pubDate: "x" },
      { title: "新北市躋身全球幸福城市前50名", link: "https://x/b", description: "英國評比", source: "s", sourceUrl: "u", hint: "治安", pubDate: "x" },
      { title: "高雄街頭砍人送醫", link: "https://x/c", description: "", source: "s", sourceUrl: "u", hint: "治安", pubDate: "x" },
    ];
    const ev = mapBulkNews(noise, { fetchedAt: FETCHED_AT });
    expect(ev).toHaveLength(1); // 只留砍人
    expect(ev[0].title).toContain("砍人");
  });

  it("falls back to 全國 with null coords when no county in title", () => {
    const ev = mapBulkNews(
      [{ title: "立委質詢打詐成效", link: "https://x/9", description: "", source: "s", sourceUrl: "u", hint: "反詐", pubDate: "x" }],
      { fetchedAt: FETCHED_AT },
    );
    expect(ev[0].region).toBe("全國");
    expect(ev[0].lat).toBeNull();
  });

  it("標題無縣市時用摘要判斷（NCDR 台17線型事件）", () => {
    const ev = mapBulkNews(
      [{
        title: "省道台17線 115K+0 道路封閉",
        link: "https://x/t17",
        description: "嘉義縣 東石鄉 台17線 115K+0 道路封閉，災害搶修中，請用路人改道。",
        source: "s",
        sourceUrl: "u",
        hint: "災防",
        pubDate: "x",
      }],
      { fetchedAt: FETCHED_AT },
    );
    expect(ev).toHaveLength(1);
    expect(ev[0].region).toBe("嘉義縣");
    expect(ev[0].lat).toBeCloseTo(23.4518, 3);
    expect(ev[0].locationPrecision).toBe("city");
  });

  it("標題命中的縣市優先於摘要提到的其他縣市", () => {
    const ev = mapBulkNews(
      [{
        title: "高雄車禍 騎士送醫",
        link: "https://x/pri",
        description: "臺北市警局呼籲用路人注意行車安全",
        source: "s",
        sourceUrl: "u",
        hint: "治安",
        pubDate: "x",
      }],
      { fetchedAt: FETCHED_AT },
    );
    expect(ev[0].region).toBe("高雄市");
  });

  it("標題明確寫嘉義縣時不再誤判為嘉義市", () => {
    const ev = mapBulkNews(
      [{
        title: "嘉義縣東石鄉車禍 騎士送醫",
        link: "https://x/chiayi",
        description: "車禍事故",
        source: "s",
        sourceUrl: "u",
        hint: "治安",
        pubDate: "x",
      }],
      { fetchedAt: FETCHED_AT },
    );
    expect(ev[0].region).toBe("嘉義縣");
  });

  it("標題短名清單順序優先：標題內全名不介入（新北車禍 臺北市警方支援 → 新北市）", () => {
    const ev = mapBulkNews(
      [{
        title: "新北車禍 臺北市警方支援",
        link: "https://x/title-order",
        description: "",
        source: "s",
        sourceUrl: "u",
        hint: "治安",
        pubDate: "x",
      }],
      { fetchedAt: FETCHED_AT },
    );
    expect(ev[0].region).toBe("新北市");
  });

  it("摘要剝發稿地後取最早出現縣市（宜蘭報導不被後文新北市蓋過）", () => {
    const ev = mapBulkNews(
      [{
        title: "寺廟住持涉侵占信徒捐款 檢方偵結",
        link: "https://x/yilan",
        description: "〔記者江志雄／宜蘭報導〕宜蘭彌陀之家東林寺住持釋見寰，遭控侵占信徒捐款，檢方昨日偵結，並搜索其新北市住處。",
        source: "s",
        sourceUrl: "u",
        hint: "治安",
        pubDate: "x",
      }],
      { fetchedAt: FETCHED_AT },
    );
    expect(ev).toHaveLength(1);
    expect(ev[0].region).toBe("宜蘭縣");
  });

  it("摘要剝發稿地後取最早出現縣市（彰化報導不被後文台中地檢署蓋過）", () => {
    const ev = mapBulkNews(
      [{
        title: "電競網紅涉販毒 檢方聲押",
        link: "https://x/changhua",
        description: "〔記者湯世名／彰化報導〕香港籍電競網紅涉嫌在彰化住處販毒，昨日遭警方移送台中地檢署偵辦。",
        source: "s",
        sourceUrl: "u",
        hint: "治安",
        pubDate: "x",
      }],
      { fetchedAt: FETCHED_AT },
    );
    expect(ev).toHaveLength(1);
    expect(ev[0].region).toBe("彰化縣");
  });

  it("中央社「台北4日電」署名後內文最早縣市勝出（高雄事件不判成台北）", () => {
    const ev = mapBulkNews(
      [{
        title: "左營槍擊案 警逮3嫌",
        link: "https://x/kaohsiung",
        description: "（中央社記者陳朝福台北4日電）高雄市左營區今日凌晨發生槍擊案，警方逮捕3名嫌犯，全案依殺人未遂罪嫌移送。",
        source: "s",
        sourceUrl: "u",
        hint: "治安",
        pubDate: "x",
      }],
      { fetchedAt: FETCHED_AT },
    );
    expect(ev).toHaveLength(1);
    expect(ev[0].region).toBe("高雄市");
  });

  it("發稿地只剝開頭署名結構：括號內「通訊設備」不被「訊」誤剝", () => {
    const ev = mapBulkNews(
      [{
        title: "通訊設備起火",
        link: "https://x/dateline-strict",
        description: "〔記者王明／台北報導〕（高雄市通訊設備起火）新北市警方協助調查。",
        source: "s",
        sourceUrl: "u",
        hint: "治安",
        pubDate: "x",
      }],
      { fetchedAt: FETCHED_AT },
    );
    expect(ev).toHaveLength(1);
    expect(ev[0].region).toBe("高雄市");
  });

  it.each([
    ["〔", "〕"],
    ["【", "】"],
    ["［", "］"],
    ["（", "）"],
    ["[", "]"],
    ["(", ")"],
  ])("署名括號變體 %s%s 結果一致（［］全形方括號亦支援）", (open, close) => {
    expect(detectCountyInBody(`${open}記者王明／台北報導${close}高雄市發生火警。`).region).toBe("高雄市");
  });

  it("剝發稿地後全文無縣市時，退回發稿地縣市", () => {
    const ev = mapBulkNews(
      [{
        title: "廟宇負責人涉詐 檢方偵辦",
        link: "https://x/dateline-only",
        description: "〔記者江志雄／宜蘭報導〕彌陀之家住持釋見寰遭控侵占信徒捐款，檢方昨日偵結。",
        source: "s",
        sourceUrl: "u",
        hint: "治安",
        pubDate: "x",
      }],
      { fetchedAt: FETCHED_AT },
    );
    expect(ev).toHaveLength(1);
    expect(ev[0].region).toBe("宜蘭縣");
  });

  it("保留官方新聞來源的轄區 provenance", () => {
    const [ev] = mapBulkNews([{
      title: "警方發布最新治安消息",
      link: "https://police.taichung.gov.tw/news/1",
      description: "警方說明案件進度",
      source: "臺中市警局官網",
      sourceUrl: "https://news.google.com/rss/search?q=site%3Apolice.taichung.gov.tw",
      hint: "治安",
      official: true,
      jurisdiction: "臺中市",
      pubDate: "Fri, 20 Jun 2026 03:00:00 +0800",
    }], { fetchedAt: FETCHED_AT });

    expect(ev.source).toMatchObject({ authority: "official", jurisdiction: "臺中市" });
  });
});

describe("isRelevantNewsItem（hint 分派主題漏斗）", () => {
  const mk = (title: string, hint: string, description = "") => ({
    title,
    hint,
    description,
    link: "https://x/t",
    source: "s",
    sourceUrl: "u",
    pubDate: "x",
  });

  it("食安 hint 用食安關鍵字（不再被警政漏斗擋掉）", () => {
    expect(isRelevantNewsItem(mk("知名餐廳使用餿水油遭勒令下架", "食安"))).toBe(true);
    expect(isRelevantNewsItem(mk("農委會推廣有機農業補助說明會", "食安"))).toBe(false);
  });

  it("衛生 hint 用衛生關鍵字", () => {
    expect(isRelevantNewsItem(mk("腸病毒疫情升溫 幼兒園爆群聚", "衛生"))).toBe(true);
    expect(isRelevantNewsItem(mk("醫院擴建工程動土典禮", "衛生"))).toBe(false);
  });

  it("環境 hint 用環境關鍵字", () => {
    expect(isRelevantNewsItem(mk("電鍍廠偷排廢水遭裁罰百萬", "環境"))).toBe(true);
    expect(isRelevantNewsItem(mk("公園綠美化志工招募", "環境"))).toBe(false);
  });

  it("資安 hint 用資安關鍵字", () => {
    expect(isRelevantNewsItem(mk("駭客入侵上市公司 個資外洩百萬筆", "資安"))).toBe(true);
    expect(isRelevantNewsItem(mk("新款筆電開箱評測", "資安"))).toBe(false);
    expect(isRelevantNewsItem(mk("南投仁愛鄉土石流紅色警戒 對外道路坍方", "資安"))).toBe(false);
  });

  it("食安 hint 涵蓋動物疫病爆發（農業部 feed 分診：H5N1 確診遭誤殺）", () => {
    expect(isRelevantNewsItem(mk("屏東高樹蛋中雞確診H5N1高原病性禽流感，請業者落實各項生物安全工作", "食安"))).toBe(true);
    expect(isRelevantNewsItem(mk("彰化雞場爆禽流感疫情 撲殺上萬隻蛋雞", "食安"))).toBe(true);
    // 行政公告/知識文章仍須擋下（高精度：認事件詞，不認病名）。
    expect(isRelevantNewsItem(mk("修正「豬瘟檢驗方法」，並自即日生效", "食安"))).toBe(false);
    expect(isRelevantNewsItem(mk("「Ｏ型口蹄疫東南亞株」之簡介與防治宣導單張", "食安"))).toBe(false);
    expect(isRelevantNewsItem(mk("紐西蘭產食用馬鈴薯輸入檢疫條件", "食安"))).toBe(false);
    expect(isRelevantNewsItem(mk("2026台北國際食品展「台灣館」盛大登場", "食安"))).toBe(false);
  });

  it("災防 hint 用災害預警與事故傷亡關鍵字", () => {
    expect(isRelevantNewsItem(mk("南投仁愛鄉土石流紅色警戒 對外道路坍方", "災防"))).toBe(true);
    expect(isRelevantNewsItem(mk("台8線邊坡滑動預警 預防性封閉", "災防"))).toBe(true);
    expect(isRelevantNewsItem(mk("民宅火警2人送醫", "災防"))).toBe(true);
    expect(isRelevantNewsItem(mk("全民防災週系列宣導起跑", "災防"))).toBe(false);
  });

  it("未列 TOPIC_RE 的 hint 照舊走警政漏斗（回歸保護）", () => {
    expect(isRelevantNewsItem(mk("高雄街頭砍人送醫", "治安"))).toBe(true);
    expect(isRelevantNewsItem(mk("老婦騎三輪車迷航40公里 東港警助返家", "治安"))).toBe(true);
    expect(isRelevantNewsItem(mk("新北市躋身全球幸福城市前50名", "治安"))).toBe(false);
    expect(isRelevantNewsItem(mk("球團回應打假球傳聞 聯盟啟動調查", "治安"))).toBe(true);
  });

  it("移民署來源排除新住民生活與便民公告，但保留真實執法事件", () => {
    const immigration = (title: string) => ({ ...mk(title, "治安"), source: "移民署 新聞" });

    expect(isRelevantNewsItem(immigration("【百人百聲】澳門青年：自由，是我選擇台灣的理由"))).toBe(false);
    expect(isRelevantNewsItem(immigration("搭起臺韓文化鵲橋 新住民講師帶你解密韓國七夕"))).toBe(false);
    expect(isRelevantNewsItem(immigration("來臺更便利！TWAC填報期限放寬至抵臺前7天"))).toBe(false);
    expect(isRelevantNewsItem(immigration("曾誤闖警局鬧笑話 臺南移民署邀新住民暢談勤學扎根路"))).toBe(false);
    expect(isRelevantNewsItem(immigration("移民署攜手企業 助新住民子女探索職涯"))).toBe(false);
    expect(isRelevantNewsItem(immigration("移民署查獲非法仲介藏匿18名失聯移工 全案移送"))).toBe(true);
    expect(isRelevantNewsItem(immigration("移民署破獲人口販運集團 逮捕主嫌"))).toBe(true);
    expect(isRelevantNewsItem(immigration("甜言蜜語誘投資 警銀聯手攔阻80萬元假交友詐騙"))).toBe(true);
    expect(isRelevantNewsItem(immigration("泰國桂圓暗藏大麻 刑事局攜手海關瓦解跨境運毒"))).toBe(true);
    expect(isRelevantNewsItem(immigration("菲籍母子車站走散 捷警10分鐘尋回7歲童"))).toBe(true);
  });

  it("排除反詐宣導行銷稿，但保留真實查緝事件", () => {
    expect(isRelevantNewsItem(mk("東勢地政換照講習 宣導不動產防詐", "反詐"))).toBe(false);
    expect(isRelevantNewsItem(mk("台南反詐宣傳聯名角色換上警察制服", "治安"))).toBe(false);
    expect(isRelevantNewsItem(mk("警方反詐宣導現場查獲車手並移送", "反詐"))).toBe(true);
  });

  it("排除純政治口水，保留政治人物涉刑案的司法進度", () => {
    expect(isRelevantNewsItem(mk("苗博雅嗆蔣萬安缺席食安會 市府反擊", "食安"))).toBe(false);
    expect(isRelevantNewsItem(mk("致癌油風暴 蔣萬安號召人民上街頭", "食安"))).toBe(false);
    expect(isRelevantNewsItem(mk("藍綠互批治安政策 朝野再爆口水", "治安"))).toBe(false);
    expect(isRelevantNewsItem(mk("藍委砍預算 市府反擊：施政恐受影響", "治安"))).toBe(false);
    expect(isRelevantNewsItem(mk("朝野互批政策攻擊 總統府回應", "治安"))).toBe(false);
    expect(isRelevantNewsItem(mk("別一屍多命 國民黨桃園議員致電黨部狂罵要求快處理", "治安"))).toBe(false);
    expect(isRelevantNewsItem(mk("香港獨立書店店員遭捕 民進黨團舉牌聲援", "治安"))).toBe(false);
    expect(isRelevantNewsItem(mk("毒油案蔣萬安喊上街 綠嗆別搞政治秀", "食安"))).toBe(false);
    expect(isRelevantNewsItem(mk("國民黨號召上凱道 抗議政府食安失能", "食安"))).toBe(false);
    expect(isRelevantNewsItem(mk("致癌油食安風暴的政治責任", "食安"))).toBe(false);
    expect(isRelevantNewsItem(mk("藍籲沒真相不准上架 綠稱食安決策要檢討", "食安"))).toBe(false);
    expect(isRelevantNewsItem(mk("市議員詐領助理費遭檢方起訴", "治安"))).toBe(true);
    expect(isRelevantNewsItem(mk("前幫派成員涉共諜案遭判刑", "治安"))).toBe(true);
  });

  it("政治口水詞不誤殺槍擊與天災中的一般動詞", () => {
    expect(isRelevantNewsItem(mk("血染音樂教室 教授砍死店長 警方連轟4槍制伏", "治安"))).toBe(true);
    expect(isRelevantNewsItem(mk("颱風暴雨狂轟北台 多處道路淹水", "災防"))).toBe(true);
    expect(isRelevantNewsItem(mk("北市爆集體虐童 家長怒轟市府擺爛", "治安"))).toBe(true);
    expect(isRelevantNewsItem(mk("白營走讀變調 爬拒馬襲警遭批根本造勢", "治安"))).toBe(true);
  });
});

describe("案件代稱與國內條件刑度的窄規則", () => {
  it.each([
    "獨∕河口湖案全台恐有「24個小藍」？女助理餘悸：那已死了多少人？",
    "國中女疑遭父施「薑罰」！網怒炸通報　衛福部開轟說重話：最重判7年",
    "心內話／狼師案吹哨者：我們36個受害者，不要賠償只要正義",
    "閃兵案開庭！藝人「王子」當庭自爆另找閃兵集團 法官傻眼",
    "網傳鬼父「薑罰」女兒！衛福部：恐涉加重強制性交，可判7年以上",
    "衛生福利部：若屬實恐判７年",
    "法務部：若屬實可判七年",
  ])("保留 %s，且災防聯集與 bulk 入口一致", (title) => {
    expect(isPoliceRelevant(title, "")).toBe(true);
    for (const hint of ["治安", "反詐", "災防"]) {
      const item = { title, hint, description: "", link: "https://example.test/case" };
      expect(isRelevantNewsItem(item), hint).toBe(true);
      expect(mapBulkNews([item], { fetchedAt: FETCHED_AT }), hint).toHaveLength(1);
    }
  });

  it.each([
    "立法院三讀通過預算案", "市府提案", "專案管理",
    "黃之鋒再遭重判10年", "都更審不完",
    "黃之鋒國安案開庭", "香港民主派恐判10年", "台灣關切香港民主派可判10年",
    "某人最重判7年", "河口湖案最新進度", "甲案開庭", "甲乙丙丁戊己庚案開庭",
  ])("不因案字或普通刑度擴收 %s", (title) => {
    expect(isPoliceRelevant(title, "")).toBe(false);
    expect(isRelevantNewsItem({ title, hint: "治安" })).toBe(false);
  });

  it.each([
    "提案", "法案", "方案", "預算案", "草案", "議案", "專案", "檔案", "答案",
    "個案", "教案", "圖案", "文案", "備案", "定案", "建案", "推案", "併購案",
    "投資案", "上市案", "修正案", "開案", "結案",
  ])("行政／商業詞 %s 不因受害與庭訊詞誤收", (term) => {
    expect(isPoliceRelevant(`年度${term}開庭 受害人說明`, "")).toBe(false);
  });

  it("補充規則只認標題脈絡，並保留主題與雜訊閘門", () => {
    const title = "河口湖案女助理餘悸未消";
    expect(isPoliceRelevant("年度方案公布", title)).toBe(false);
    expect(isPoliceRelevant("某人可判7年", "衛福部說明")).toBe(false);
    expect(isRelevantNewsItem({ title, hint: "食安" })).toBe(false);
    expect(isRelevantNewsItem({ title: `${title} 懶人包`, hint: "治安" })).toBe(false);
    expect(isRelevantNewsItem({ title: `新劇拍攝現場 ${title}`, hint: "治安" })).toBe(false);
    expect(isRelevantNewsItem({ title: `市府互嗆 ${title}`, hint: "治安" })).toBe(false);
  });
});

describe("buildNewsRelevanceAudit（每日誤殺／漏網抽樣）", () => {
  it("以近 24 小時母體分開列出被排除與通過的人工複核候選", () => {
    const generatedAt = "2026-06-20T12:00:00.000Z";
    const items = [
      { title: "高雄街頭砍人送醫", hint: "治安", description: "", link: "https://x/pass", source: "媒體", sourceUrl: "u", pubDate: "2026-06-20T11:00:00.000Z" },
      { title: "新北市躋身全球幸福城市前50名", hint: "治安", description: "", link: "https://x/drop", source: "媒體", sourceUrl: "u", pubDate: "2026-06-20T10:00:00.000Z" },
      { title: "台南工廠火警濃煙竄天", hint: "災防", description: "", link: "https://x/old", source: "媒體", sourceUrl: "u", pubDate: "2026-06-18T10:00:00.000Z" },
    ];

    const report = buildNewsRelevanceAudit(items, { generatedAt, sampleSize: 5 });

    expect(report.windowHours).toBe(24);
    expect(report.population).toEqual({ rawUnique: 2, accepted: 1, rejected: 1 });
    expect(report.samples.potentialFalseNegatives.map((item) => item.title)).toEqual([
      "新北市躋身全球幸福城市前50名",
    ]);
    expect(report.samples.potentialFalsePositives.map((item) => item.title)).toEqual([
      "高雄街頭砍人送醫",
    ]);
    expect(report.note).toContain("待人工判讀");
  });
});

describe("isForeignNonTaiwan（bulk domestic 純外國負面閘門）", () => {
  const mk = (title: string, hint = "災防", description = "") => ({
    title,
    hint,
    description,
    link: `https://x/${encodeURIComponent(title)}`,
    source: "Google News",
    sourceUrl: "u",
    pubDate: "x",
  });

  it("必移明確外國且無台灣關聯事件，不成為 bulk domestic 事件", () => {
    const foreignOnly = [
      mk("委內瑞拉強震2600死"),
      mk("巴基斯坦客運墜深谷 已知40死"),
      mk("俄羅斯襲基輔至少17死"),
      mk("奈及利亞爆發流血衝突釀48死"),
      mk("法國熱浪已導致千人喪命"),
      // 2026-07-06 災防漏斗聯集後實測漏網：地名/語境不在表內的純外國災難。
      mk("洪災不斷！祕魯狂暴土石流女子連人帶房被沖走"),
      mk("象牙海岸暴雨成災！雨季剛開始已奪59命 經濟首都成重災區"),
      mk("印度孟買暴雨成災！貧民窟房屋倒塌奪6命、交通大癱瘓"),
      mk("丹佛西南山火迫數千人疏散 焚毀超160建築"),
    ];

    for (const item of foreignOnly) {
      expect(isForeignNonTaiwan(item), item.title).toBe(true);
      expect(isRelevantNewsItem(item), item.title).toBe(false);
    }
    // negated-context：「與台灣無關」不算台灣關聯，純外國災難仍移除。
    expect(isForeignNonTaiwan({
      ...mk("委內瑞拉強震釀2600死 逾萬人無家可歸"),
      summary: "此震災與台灣無直接關聯。",
    })).toBe(true);

    expect(mapBulkNews(foreignOnly, { fetchedAt: FETCHED_AT })).toHaveLength(0);
  });

  it("必留含台灣關聯、資安豁免與無外國地名的正常台灣事件", () => {
    const mustKeep = [
      mk("台灣捐款委內瑞拉震災"),
      mk("台商在越南工廠火災"),
      mk("國人在日本遇車禍身亡"),
      mk("外交部關切加薩情勢"),
      mk("南韓酷澎個資外洩", "資安"),
      mk("高雄街頭砍人送醫", "治安"),
      mk("新北詐騙集團車手落網", "反詐"),
      mk("颱風來襲 氣象署發警報", "災防"),
    ];

    for (const item of mustKeep) {
      expect(isForeignNonTaiwan(item), item.title).toBe(false);
    }

    const domesticContextMustKeep = [
      mk("林口大賣場隨機砍人 印度籍男遭砍傷", "治安"),
      mk("內政部：依托咪酯走私來源部分來自越南或馬來西亞", "治安"),
      mk("越南移工二林溪抓螃蟹失聯 消防救援上岸已死亡", "災防"),
      mk("台德合作偵破液態K他命德國走私來台", "治安"),
      // 收窄回歸：這些含外國地名但屬台灣事件/豁免類，廣版曾誤刪，須保留。
      mk("去日本都看過通緝令！八田與一逃亡4年抓嘸 警擴大緝捕", "治安"), // 台語「抓嘸」台灣通緝案
      mk("美國豆換巴西豆引食安風暴? 中聯油脂：產季輪換", "食安"), // 台廠食安（食安豁免）
      mk("緬甸三佛塔成電詐園區新據點 陸退伍軍人淪豬仔", "反詐"), // 詐騙園區（反詐豁免、國人相關）
      mk("新加坡修法加重打詐 涉詐最高可處24下鞭刑", "反詐"), // 打詐借鏡（反詐豁免）
      // 收窄行為：外國一般犯罪（無天災/戰爭/大量傷亡）不再過濾，保留以免誤刪台灣邊案。
      mk("東京上野餐廳老闆遭殺害棄屍 2共犯判刑30年", "治安"),
      // T8-17 回歸保護：新增地名/語境不可誤殺台灣關聯或台灣本地事件。
      mk("祕魯強震 外交部：目前無國人傷亡", "治安"),
      mk("新竹626豪雨成災 議員質疑整修工程", "災防"),
      // T9-08 豁免收窄後回歸保護：共軍/中國軍事動態是本產品核心情報，提及外國（日本關切）不可被當純外國事件剔除。
      mk("中國突試射潛射戰略飛彈 日本表達嚴重關切", "反詐"),
      mk("解放軍軍演逼近海峽中線 美日關切", "治安"),
    ];
    for (const item of domesticContextMustKeep) {
      expect(isForeignNonTaiwan(item), item.title).toBe(false);
    }
    expect(isForeignNonTaiwan({ title: "南韓酷澎個資外洩", category: "資安" })).toBe(false);

    expect(isRelevantNewsItem(mustKeep[0])).toBe(false);
    expect(isRelevantNewsItem(mustKeep[1])).toBe(true);
    expect(isRelevantNewsItem(mustKeep[2])).toBe(true);
    expect(isRelevantNewsItem(mustKeep[3])).toBe(false);
    expect(isRelevantNewsItem(mustKeep[4])).toBe(true);
    expect(isRelevantNewsItem(mustKeep[5])).toBe(true);
    expect(isRelevantNewsItem(mustKeep[6])).toBe(true);
    expect(isRelevantNewsItem(mustKeep[7])).toBe(true);

    const bulkEvents = mapBulkNews(mustKeep, { fetchedAt: FETCHED_AT });
    expect(bulkEvents.map((event) => event.title)).toEqual([
      "台商在越南工廠火災",
      "國人在日本遇車禍身亡",
      "南韓酷澎個資外洩",
      "高雄街頭砍人送醫",
      "新北詐騙集團車手落網",
      "颱風來襲 氣象署發警報",
    ]);
  });
});

describe("isNonEventNoise / bulk domestic 負面閘門", () => {
  const mk = (title: string, hint = "環境", description = "", source = "Google News") => ({
    title,
    hint,
    description,
    link: `https://x/${encodeURIComponent(title)}`,
    source,
    sourceUrl: "u",
    pubDate: "x",
  });

  it("必剔高確定性 landing page / 參考頁 / 娛樂劇情雜訊", () => {
    const noise = [
      mk("Vares 空氣品質指數（AQI）和波斯尼亞 空氣污染 | IQAir"),
      mk("Annobon 空氣品質指數（AQI）和赤道幾內亞 空氣污染 | IQAir"),
      mk("固定空氣污染源管理資訊系統-環境部"),
      mk("列管污染源資料查詢系統"),
      mk("持久性有機污染物(POPs)資訊網站"),
      mk("國家溫室氣體排放清冊報告"),
      mk("環保稽查處分管制系統"),
      mk("非份之罪劇透1-10集｜賴慰玲捲石棺命案", "治安"),
      mk("玩命關頭11線上看 完整版預告片", "治安"),
      mk("成毅新劇演警察狂練胸肌 拍攝現場粉絲圍觀", "治安"),
    ];

    for (const item of noise) {
      expect(isNonEventNoise(item), item.title).toBe(true);
    }

    const ev = mapBulkNews(noise, { fetchedAt: FETCHED_AT });
    expect(ev).toHaveLength(0);
  });

  it("必留真實 bulk 事件，避免誤殺犯罪/交通/災防/環境/食安/衛生事件", () => {
    const events = [
      mk("雨後巨量海廢淹沒林園貝殼灣 志工淨灘清出268公斤", "環境"),
      mk("苗栗台13線死亡車禍 重機男過彎自撞墜橋亡", "交通"),
      mk("台中豐原透天厝火警 72歲翁全身72%燒燙傷", "災防"),
      mk("雲林全面下架問題大豆油 54家業者稽查 423件產品急回收", "食安"),
      mk("屏東旅館驚見冰鎮女屍 高大成相驗：死因與毒品有關", "治安"),
      mk("高雄工廠偷排廢水遭稽查裁罰", "環境"),
      mk("知名餐廳使用餿水油遭勒令下架", "食安"),
      mk("腸病毒疫情升溫 幼兒園爆群聚", "衛生"),
      mk("台南工廠火警濃煙竄天 消防搶救", "災防"),
      mk("新北詐騙集團車手落網", "反詐"),
      mk("高雄街頭砍人 男子背部受傷送醫", "治安"),
      mk("警方破獲個資外洩詐騙系統 逮捕嫌犯", "治安"),
      mk("醫院資訊系統遭駭客攻擊 個資外洩", "資安"),
      mk("食藥署稽查違規食品 下架回收", "食安"),
      mk("賽道狂人、冰雪奇緣2線上看？LINE帳號恐遭登入盜用", "反詐"),
    ];

    for (const item of events) {
      expect(isNonEventNoise(item), item.title).toBe(false);
    }

    const relevantEvents = events.filter(isRelevantNewsItem);
    const ev = mapBulkNews(relevantEvents, { fetchedAt: FETCHED_AT });
    expect(ev).toHaveLength(relevantEvents.length);
  });
});

describe("mapBulkNews 新主題分類", () => {
  it("食安/環境/資安 item 入庫且歸到自己的分類", () => {
    const items = [
      {
        title: "台中查獲黑心食品工廠",
        link: "https://x/f1",
        description: "",
        source: "GN 食安黑心",
        sourceUrl: "u",
        hint: "食安",
        pubDate: "x",
      },
      {
        title: "高雄工廠偷排廢水遭稽查裁罰",
        link: "https://x/e1",
        description: "",
        source: "環境部官網",
        sourceUrl: "u",
        hint: "環境",
        pubDate: "x",
      },
      {
        title: "勒索病毒攻擊醫院系統 個資外洩",
        link: "https://x/c1",
        description: "",
        source: "TechNews",
        sourceUrl: "u",
        hint: "資安",
        pubDate: "x",
      },
    ];
    const ev = mapBulkNews(items, { fetchedAt: FETCHED_AT });
    expect(ev).toHaveLength(3);
    expect(ev.find((e) => e.title.includes("黑心"))!.category).toBe("食安");
    expect(ev.find((e) => e.title.includes("廢水"))!.category).toBe("環境");
    expect(ev.find((e) => e.title.includes("勒索病毒"))!.category).toBe("資安");
  });
});

describe("EN 來源支援（Focus Taiwan / Taipei Times）", () => {
  const mk = (title: string) => ({ title, hint: "治安", description: "", link: "https://x/en", source: "Focus Taiwan (EN)", sourceUrl: "u", pubDate: "x" });

  it("英文警政標題通過相關性漏斗", () => {
    expect(isRelevantNewsItem(mk("Police arrest fraud ring leader in Taipei"))).toBe(true);
    expect(isRelevantNewsItem(mk("Drug smuggling suspects detained at port"))).toBe(true);
    expect(isRelevantNewsItem(mk("Taiwan shares close higher on tech gains"))).toBe(false);
  });

  it("英文標題風險評級正確（不再全判 low）", () => {
    const ev = mapBulkNews(
      [
        { ...mk("Man killed in Kaohsiung shooting incident"), link: "https://x/en1" },
        { ...mk("Police arrest fraud suspects in Taichung"), link: "https://x/en2" },
      ],
      { fetchedAt: FETCHED_AT },
    );
    expect(ev.find((e) => e.title.includes("killed"))!.riskLevel).toBe("high");
    expect(ev.find((e) => e.title.includes("fraud"))!.riskLevel).toBe("medium");
  });
});

describe("riskFromTitle 主題感知", () => {
  it("正式入口使用摘要補足標題省略的嚴重風險證據", () => {
    const [event] = mapBulkNews([{
      title: "新埔工廠事故持續調查",
      link: "https://example.test/event",
      description: "工廠氣爆造成2死19傷，檢警持續調查。",
      source: "測試媒體",
      sourceUrl: "https://example.test/feed",
      hint: "災防",
      pubDate: "2026-06-20T00:00:00.000Z",
    }], { fetchedAt: FETCHED_AT });

    expect(event?.riskLevel).toBe("critical");
  });

  it("驗收基線：正常、剛好升級門檻與急迫公共安全事件維持固定評級", () => {
    const cases = [
      { title: "警方公告夜間巡邏勤務正常", hint: "治安", expectedRisk: "low" },
      // 兩位數死亡的既有 critical 升級門檻，10 是最小邊界值。
      { title: "花蓮地震造成10人死亡", hint: "災防", expectedRisk: "critical" },
      { title: "捷運站發生爆炸，警消緊急疏散乘客", hint: "災防", expectedRisk: "high" },
    ];

    const events = mapBulkNews(
      cases.map(({ title, hint }, index) => ({
        title,
        hint,
        link: `https://example.test/risk-${index}`,
        description: "驗收事件",
        source: "驗收來源",
        sourceUrl: "https://example.test",
        pubDate: "2026-08-03T00:00:00.000Z",
      })),
      { fetchedAt: FETCHED_AT },
    );

    expect(events).toHaveLength(cases.length);
    expect(events.map((event) => event.riskLevel)).toEqual(cases.map((testCase) => testCase.expectedRisk));
  });

  it("重大傷亡與大規模事件升為 critical，但一般重案不灌水", () => {
    expect(riskFromTitle("台中隨機殺人釀3死", "治安")).toBe("critical");
    expect(riskFromTitle("新北氣爆釀2死 多人送醫", "災防")).toBe("critical");
    expect(riskFromTitle("高雄命案嫌犯落網", "治安")).toBe("high");
  });

  it("「大規模」只和同一句的傷亡攻擊詞連成危急，背景描述不跨句連結", () => {
    expect(riskFromTitle("車站發生大規模砍人事件", "治安")).toBe("critical");
    expect(riskFromTitle("園區遭大規模無差別攻擊", "治安")).toBe("critical");
    const desc = "北京近來加大對台施壓，不僅持續在台海周邊舉行大規模海上與空中軍演行動，還委託「代理人」對台灣政治人物、媒體人及藝文工作者進行跟蹤、偷拍、恐嚇，甚至暴力攻擊";
    expect(riskFromTitle("[兩岸] 成蕾談國安牢獄1154天 籲看清中國高科技表象下的人權困境", "治安", desc)).not.toBe("critical");
  });

  it("依 hint 套用主題高風險關鍵字優先，維持警政備援", () => {
    expect(riskFromTitle("餿水油流入市面 廠商遭起訴", "食安")).toBe("high");
    expect(riskFromTitle("黑心廠商瘦肉精超標遭下架", "食安")).toBe("medium");
    expect(riskFromTitle("食安稽查員遭殺害", "食安")).toBe("high");
    expect(riskFromTitle("醫院爆院內感染 2 死", "衛生")).toBe("high");
    expect(riskFromTitle("北部群聚確診再增", "衛生")).toBe("medium");
    expect(riskFromTitle("工廠毒物外洩 居民急疏散", "環境")).toBe("high");
    expect(riskFromTitle("電鍍廠偷排廢水遭裁罰", "環境")).toBe("medium");
    expect(riskFromTitle("駭客勒索病毒癱瘓醫院系統", "資安")).toBe("high");
    expect(riskFromTitle("電商個資外洩", "資安")).toBe("medium");
  });

  it("無 hint 時維持既有警政風險邏輯", () => {
    expect(riskFromTitle("北部群聚確診再增")).toBe("low");
    expect(riskFromTitle("公安局深夜緝毒失聯槍擊")).toBe("high");
    expect(riskFromTitle("反詐宣導說明會", "反詐")).toBe("low");
  });

  it("資安事件不靠 hint 也會全域升級，且大規模個資外洩升 high", () => {
    expect(riskFromTitle("駭客公開勒索200萬美金 台灣上市櫃企業", "治安")).toBe("high");
    expect(riskFromTitle("醫院遭駭癱瘓系統")).toBe("high");
    expect(riskFromTitle("3370萬筆個資外洩")).toBe("high");
    expect(riskFromTitle("9300萬筆個資遭竊", "治安")).toBe("high");
    expect(riskFromTitle("某公司資料庫個資外洩")).toBe("medium");
  });

  it("資安非事件與宣導教育產品語境不因資安詞誤升", () => {
    expect(riskFromTitle("個資保護法宣導講座", "資安")).toBe("low");
    expect(riskFromTitle("校園資安意識研習", "資安")).toBe("low");
    expect(riskFromTitle("大學生駭客松競賽", "資安")).toBe("low");
    expect(riskFromTitle("新款防毒軟體上市開箱", "資安")).toBe("low");
  });

  it("死亡與武裝暴力同義詞至少升 high，補回 bulk 致死漏報", () => {
    expect(riskFromTitle("高雄60多歲男遭刺殺不治倒臥住家", "治安")).toBe("high");
    expect(riskFromTitle("高雄男疑債務糾紛家門口中2刀不治", "治安")).toBe("high");
    expect(riskFromTitle("彰化男子失去生命徵象送醫不治", "災防")).toBe("high");
    expect(riskFromTitle("登玉山失足墜50米邊坡傷重不治", "災防")).toBe("high");
    expect(riskFromTitle("桃園街頭槍手開3槍", "治安")).toBe("high");
    expect(riskFromTitle("苗栗車禍1人死亡", "災防")).toBe("high");
    expect(riskFromTitle("中壢4死案", "治安")).toBe("high");
  });

  it("二位數以上或十百千萬級死亡升 critical，個位數死亡不升 critical", () => {
    expect(riskFromTitle("委國雙強震近3,000死", "災防")).toBe("critical");
    expect(riskFromTitle("巴基斯坦客運墜深谷 已知40死", "災防")).toBe("critical");
    expect(riskFromTitle("俄羅斯襲基輔至少17死90多傷", "治安")).toBe("critical");
    expect(riskFromTitle("苗栗車禍1人死亡", "災防")).toBe("high");
    expect(riskFromTitle("中壢4死案", "治安")).toBe("high");
  });

  it("死亡字面雜訊與無傷亡反向詞不誤升", () => {
    expect(riskFromTitle("生死關頭消防員即時救援", "災防")).toBe("low");
    expect(riskFromTitle("打詐死角 立委籲補強", "治安")).toBe("low");
    expect(riskFromTitle("無人傷亡的住宅火警", "災防")).toBe("medium");
    expect(riskFromTitle("交通安全宣導記者會", "災防")).toBe("low");
  });
});
