// 全量新聞輕量收錄（免 LLM）：把抓回來的 RSS 原文全部轉成 IntelEvent。
// 分類用來源主題(hint)、風險用標題與摘要關鍵字、座標用標題短名縣市偵測。
// 與 LLM 精修層(nvidia.normalizeDomesticNews)互補：LLM 精修最近一批，其餘走這裡，達成「全量下載」。
import { COUNTY_CENTER, countyCoordFromAddr } from "./coords.mjs";
import { eventIdFor } from "./event-id.mjs";
import { deriveNewsProvenance } from "./fetch-rss.mjs";
import { cleanNewsTitleTail, dedupeTitleKey, titleKey } from "./title-key.mjs";
import { INTERNATIONAL_FEEDS } from "./international-feeds.mjs";
export { titleKey } from "./title-key.mjs";
export { dedupeTitleKey } from "./title-key.mjs";

export function cleanTitle(title) {
  return cleanNewsTitleTail(title) || String(title || "").trim();
}

// 縣市短名規則；實際命中依文字位置排序。
const COUNTY_MATCH = [
  [/新北/, "新北市"], [/台北|臺北|北市/, "臺北市"], [/桃園|桃市/, "桃園市"],
  [/台中|臺中|中市/, "臺中市"], [/台南|臺南|南市/, "臺南市"], [/高雄|高市/, "高雄市"],
  [/基隆/, "基隆市"], [/竹縣/, "新竹縣"], [/新竹|竹市/, "新竹市"], [/苗栗/, "苗栗縣"],
  [/彰化|彰縣/, "彰化縣"], [/南投/, "南投縣"], [/雲林/, "雲林縣"],
  [/嘉縣/, "嘉義縣"], [/嘉義|嘉市/, "嘉義市"], [/屏東/, "屏東縣"], [/宜蘭/, "宜蘭縣"],
  [/花蓮/, "花蓮縣"], [/台東|臺東/, "臺東縣"], [/澎湖/, "澎湖縣"], [/金門/, "金門縣"],
  [/連江|馬祖/, "連江縣"],
];

// 唯一性較高的鄉鎮／地標只用來推定縣市中心座標；重名行政區另要求同句出現縣市。
const TOWNSHIP_COUNTY = new Map(Object.entries({
  新店: "新北市", 永和: "新北市", 三重: "新北市", 板橋: "新北市", 淡水: "新北市", 貢寮: "新北市",
  新莊: "新北市", 汐止: "新北市", 瑞芳: "新北市", 三峽: "新北市", 鶯歌: "新北市", 林口: "新北市",
  五股: "新北市", 泰山: "新北市", 土城: "新北市", 樹林: "新北市", 蘆洲: "新北市", 三芝: "新北市",
  石門: "新北市", 金山: "新北市", 萬里: "新北市", 坪林: "新北市", 石碇: "新北市", 深坑: "新北市",
  雙溪: "新北市", 平溪: "新北市", 烏來: "新北市", 中和: "新北市", 中壢: "桃園市", 龜山: "桃園市", 蘆竹: "桃園市",
  大園: "桃園市", 楊梅: "桃園市", 平鎮: "桃園市", 八德: "桃園市", 觀音: "桃園市", 新屋: "桃園市",
  中捷: "臺中市", 三多警: "高雄市",
  竹北: "新竹縣", 竹東: "新竹縣", 新埔: "新竹縣", 關西: "新竹縣", 湖口: "新竹縣", 新豐: "新竹縣", 芎林: "新竹縣",
  橫山: "新竹縣", 北埔: "新竹縣", 寶山: "新竹縣", 峨眉: "新竹縣", 尖石: "新竹縣", 五峰: "新竹縣",
  竹南: "苗栗縣", 頭份: "苗栗縣", 苑裡: "苗栗縣", 通霄: "苗栗縣", 后龍: "苗栗縣",
  后里: "臺中市", 沙鹿: "臺中市", 西屯: "臺中市", 神岡: "臺中市", 烏日: "臺中市", 太平: "臺中市", 大里: "臺中市",
  豐原: "臺中市", 清水: "臺中市", 龍井: "臺中市", 大甲: "臺中市", 霧峰: "臺中市", 東勢: "臺中市", 大雅: "臺中市",
  員林: "彰化縣", 鹿港: "彰化縣", 和美: "彰化縣", 田中: "彰化縣", 北斗: "彰化縣", 二林: "彰化縣", 斗六: "雲林縣",
  虎尾: "雲林縣", 斗南: "雲林縣", 北港: "雲林縣", 西螺: "雲林縣", 口湖: "雲林縣", 古坑: "雲林縣",
  朴子: "嘉義縣", 太保: "嘉義縣", 民雄: "嘉義縣", 大林: "嘉義縣", 新港: "嘉義縣", 梅山: "嘉義縣", 竹崎: "嘉義縣",
  水上: "嘉義縣", 布袋: "嘉義縣", 東石: "嘉義縣", 六腳: "嘉義縣", 中埔: "嘉義縣", 阿里山: "嘉義縣",
  新營: "臺南市", 永康: "臺南市", 善化: "臺南市", 新化: "臺南市", 麻豆: "臺南市", 玉井: "臺南市", 安平: "臺南市",
  歸仁: "臺南市", 仁德: "臺南市", 佳里: "臺南市", 七股: "臺南市", 學甲: "臺南市", 鹽水: "臺南市", 關廟: "臺南市",
  楠西: "臺南市", 龍崎: "臺南市", 大內: "臺南市", 大埔: "嘉義縣",
  左營: "高雄市", 鳳山: "高雄市", 岡山: "高雄市", 旗山: "高雄市", 楠梓: "高雄市", 前鎮: "高雄市", 小港: "高雄市",
  大寮: "高雄市", 仁武: "高雄市", 大社: "高雄市", 橋頭: "高雄市", 林園: "高雄市", 美濃: "高雄市", 三民: "高雄市",
  潮州: "屏東縣", 枋寮: "屏東縣", 鹽埔: "屏東縣", 里港: "屏東縣", 南州: "屏東縣", 恆春: "屏東縣", 東港: "屏東縣",
  羅東: "宜蘭縣", 宜蘭市: "宜蘭縣", 秀林: "花蓮縣", 光復: "花蓮縣", 玉里: "花蓮縣", 吉安: "花蓮縣", 花蓮市: "花蓮縣",
  臺東市: "臺東縣", 成功: "臺東縣", 池上: "臺東縣", 關山: "臺東縣",
  冬山: "宜蘭縣", 礁溪: "宜蘭縣", 蘇澳: "宜蘭縣", 五結: "宜蘭縣", 頭城: "宜蘭縣", 壯圍: "宜蘭縣", 三星: "宜蘭縣",
  新城: "花蓮縣", 瑞穗: "花蓮縣", 壽豐: "花蓮縣", 鳳林: "花蓮縣", 豐濱: "花蓮縣", 富里: "花蓮縣",
  東河: "臺東縣", 長濱: "臺東縣", 鹿野: "臺東縣", 太麻里: "臺東縣", 大武: "臺東縣", 卑南: "臺東縣",
  水里: "南投縣", 名間: "南投縣",
  內埔: "屏東縣", 萬丹: "屏東縣", 長治: "屏東縣", 佳冬: "屏東縣", 車城: "屏東縣", 林邊: "屏東縣",
  埔心: "彰化縣", 田尾: "彰化縣", 大村: "彰化縣", 溪州: "彰化縣", 芳苑: "彰化縣", 秀水: "彰化縣", 花壇: "彰化縣",
  大湖: "苗栗縣", 卓蘭: "苗栗縣", 公館: "苗栗縣", 銅鑼: "苗栗縣", 三義: "苗栗縣", 南庄: "苗栗縣", 頭屋: "苗栗縣",
  八里: "新北市", 坪林: "新北市", 林口: "新北市", 溪口: "嘉義縣", 番路: "嘉義縣", 義竹: "嘉義縣", 鹿草: "嘉義縣",
  官田: "臺南市", 西港: "臺南市", 柳營: "臺南市", 後壁: "臺南市", 北門: "臺南市", 將軍: "臺南市", 下營: "臺南市",
  士林: "臺北市", 北投: "臺北市", 內湖: "臺北市", 南港: "臺北市", 文山: "臺北市", 松山: "臺北市", 萬華: "臺北市",
  苓雅: "高雄市", 鼓山: "高雄市", 鹽埕: "高雄市", 新興: "高雄市", 旗津: "高雄市", 大樹: "高雄市", 燕巢: "高雄市",
  苗栗市: "苗栗縣", 斗南鎮: "雲林縣", 埔里: "南投縣", 草屯: "南投縣", 竹山: "南投縣", 集集: "南投縣",
  連江: "連江縣", 馬公: "澎湖縣", 金城: "金門縣", 金湖: "金門縣",
  復興: "桃園市", 大溪: "桃園市", 龍潭: "桃園市", 香山: "新竹市", 造橋: "苗栗縣", 西湖: "苗栗縣", 三灣: "苗栗縣", 獅潭: "苗栗縣",
  潭子: "臺中市", 大肚: "臺中市", 梧棲: "臺中市", 外埔: "臺中市", 石岡: "臺中市", 新社: "臺中市", 和平: "臺中市",
  線西: "彰化縣", 伸港: "彰化縣", 福興: "彰化縣", 埔鹽: "彰化縣", 埤頭: "彰化縣", 溪湖: "彰化縣", 永靖: "彰化縣", 社頭: "彰化縣", 二水: "彰化縣", 芬園: "彰化縣", 大城: "彰化縣", 竹塘: "彰化縣",
  台西: "雲林縣", 麥寮: "雲林縣", 莿桐: "雲林縣", 林內: "雲林縣", 崙背: "雲林縣", 二崙: "雲林縣", 元長: "雲林縣",
  四湖: "雲林縣", 褒忠: "雲林縣", 水林: "雲林縣",
  白河: "臺南市", 山上: "臺南市", 左鎮: "臺南市", 南化: "臺南市", 新市: "臺南市", 安南: "臺南市", 安定: "臺南市",
  甲仙: "高雄市", 六龜: "高雄市", 桃源: "高雄市", 茂林: "高雄市", 那瑪夏: "高雄市", 阿蓮: "高雄市", 路竹: "高雄市",
  前金: "高雄市", 永安: "高雄市", 彌陀: "高雄市", 田寮: "高雄市", 梓官: "高雄市", 茄萣: "高雄市",
  來義: "屏東縣", 牡丹: "屏東縣", 瑪家: "屏東縣", 泰武: "屏東縣", 三地門: "屏東縣", 霧臺: "屏東縣", 春日: "屏東縣", 獅子: "屏東縣", 萬巒: "屏東縣", 竹田: "屏東縣", 高樹: "屏東縣", 枋山: "屏東縣", 新埤: "屏東縣",
  南澳: "宜蘭縣", 卓溪: "花蓮縣", 萬榮: "花蓮縣", 海端: "臺東縣", 綠島: "臺東縣", 蘭嶼: "臺東縣",
  達仁: "臺東縣", 金峰: "臺東縣", 延平: "臺東縣",
  中科: "臺中市", 南科: "臺南市", 竹科: "新竹市", 烏山頭水庫: "臺南市", 北車: "臺北市",
  北檢: "臺北市", 中檢: "臺中市", 雄檢: "高雄市", 橋檢: "高雄市", 彰檢: "彰化縣",
  內壢站: "桃園市", 新左營站: "高雄市", 南監: "臺南市", 屏監: "屏東縣", 南警三分局: "臺南市",
  安中所: "臺南市", 曾文溪: "臺南市",
  漢寶段: "彰化縣",
}));
const AMBIGUOUS_TOWNS = new Set(["中山", "中正", "信義", "大安", "東區", "北區", "西區", "南區", "大同", "中西", "東山"]);
const TOWNSHIP_EVENT_RE = /墜|落|遇害|遇襲|命案|殺人|兇殺|凶殺|傷害|霸凌|偷拍|砍|刺|搶|中刀|火警|火災|倒塌|車禍|追撞|連環撞|自撞|相撞|事故|工安|職災|偵結|起訴|查獲|逮|判刑|判決|一審|羈押|聲押|移送|約談|衝撞|通緝|涉貪|賄選|車手|毒駕|毒品|詐騙|宣導|演練|走失|迷途|失智|命危|送醫|受困|爆炸|淹水|土石流|坍方|警|檢|分局|派出所|案件|涉案|遭竊|落網|拘提|搜索|水庫|園區|車站|國小|國中|全武行/;

const COUNTY_DISAMBIGUATION = {
  新竹市: { county: "新竹縣", city: /新竹市|竹市/, cityPlace: /^新竹(?:東區|北區|香山|巨城|科學工業園區)/, towns: "竹北|竹東|新埔|關西|湖口|新豐|芎林|橫山|北埔|寶山|峨眉|尖石|五峰" },
  嘉義市: { county: "嘉義縣", city: /嘉義市|嘉市/, cityPlace: /^嘉義(?:東區|西區|文化路|湖美夜市)/, towns: "太保|朴子|布袋|大林|民雄|溪口|新港|六腳|東石|義竹|鹿草|水上|中埔|竹崎|梅山|番路|大埔|阿里山" },
};

function resolveCountyShortName(key, text, context = "", index = 0) {
  const rule = COUNTY_DISAMBIGUATION[key];
  if (!rule || rule.city.test(text.slice(index, index + 3))) return key;
  const short = key.slice(0, 2);
  // ponytail: 鄉鎮只看各次命中前後 8 字；移動目的地與另一案排除，更複雜關係需斷句解析。
  // 「東石路段」仍是鄉鎮路段描述；「寶山路」等道路名稱不算鄉鎮證據。
  const sentence = text.slice(0, index).split(/[。！？；\n]/).at(-1) + text.slice(index).split(/[。！？；\n]/)[0];
  const town = `(?:${rule.towns})(?!${rule.city.test(sentence) ? "路" : "路(?!段)"}|街|大道|巷)`;
  const after = new RegExp(`^${short}[^，。！？；\\n]{0,8}${town}`);
  const before = new RegExp(`${town}[^，。！？；\\n]{0,8}$`);
  const next = text.indexOf(short, index + short.length);
  const hit = text.slice(index, next < 0 ? undefined : next);
  if (rule.cityPlace.test(hit)) return key;
  if (after.test(hit) || before.test(text.slice(0, index)) ||
    (key === "新竹市" && /^新竹(?:產業園區|工業區)/.test(hit))) return rule.county;
  // 只有第一處仍模糊時，才以後續同名或剝署名後的摘要補足；明確市區不改判。
  for (const [source, start] of [[text, index + short.length], [stripDatelines(context).body, 0]]) {
    for (const m of source.matchAll(new RegExp(`${short}(?:縣|市)?|${rule.city.source}`, "g"))) {
      if (m.index < start) continue;
      const prefix = source.slice(0, m.index);
      if (/(?:逃往|逃回|逃到|前往|南下|北上|返回)\s*$|另一案[^。！？；\n]*$/.test(prefix)) continue;
      if (rule.city.test(m[0])) return key;
      if (m[0] === rule.county) return rule.county;
      const end = source.indexOf(short, m.index + m[0].length);
      const local = source.slice(m.index, end < 0 ? undefined : end);
      if (rule.cityPlace.test(local)) return key;
      if (after.test(local) || before.test(prefix) ||
        (key === "新竹市" && /^新竹(?:產業園區|工業區)/.test(local))) return rule.county;
    }
  }
  return key;
}

export function detectCounty(text, context = "") {
  return detectCountyEarliest(text, context);
}

// 全名（含「縣/市」）比對優先於短名規則：避免「嘉義縣」被短名「嘉義」誤判為嘉義市。
export function detectCountyLoose(text) {
  return countyCoordFromAddr(text) || detectCounty(text);
}

// 發稿地/記者署名區塊：摘要比對前先剝掉（署名地僅作最後 fallback，地方記者駐地多半是事發地）。
// 開頭另處理明確署名標記（記者/報導/日電/專電/電訊/本報訊）、
// 或 ≤10 字以「訊」結尾的短署名（〔台北訊〕（高雄訊）本報訊）。括號內的一般詞（通訊、資訊…）不剝。
// 中段只移除「署名／地名報導」結構；一般括號內容保留。
const BRACKET_DATELINE_RE = /[〔【\[［（(][^〔【\[［（(〕】\]］）)\n／/]{1,80}[／/][^〔【\[［（(〕】\]］）)\n／/]{1,15}報導[〕】\]］）)]/g;
// 中段「（中央社記者X台北1日電）」型署名：必須同時有「記者」與電訊字尾，避免剝掉一般括號。
const BRACKET_WIRE_DATELINE_RE = /[〔【\[［（(][^〔【\[［（(〕】\]］）)\n]{0,40}?記者[^〔【\[［（(〕】\]］）)\n]{0,30}?(?:日電|專電|電訊)[〕】\]］）)]/g;
const DATELINE_PLACE = `(?:${COUNTY_MATCH.map(([re]) => re.source).join("|")})(?:縣|市)?`;
// 姓名僅 2–4 字，空白只可隔開姓名與地名，不接受跨子句的正文。
const REPORTERS = "[\\p{Script=Han}]{2,4}(?:[、 \\t]+[\\p{Script=Han}]{2,4}){0,3}";
const BYLINE_PREFIX = "[^\\s，。！？；／/]{1,30}";
const UNBRACKETED_DATELINE_RE = new RegExp(`^\\s*(?:${BYLINE_PREFIX}[／/](?:記者)?${REPORTERS}[ \\t]*(?:${DATELINE_PLACE})?|${BYLINE_PREFIX}記者${REPORTERS}[／/](?:${DATELINE_PLACE})?|${BYLINE_PREFIX}[／/](?:記者${REPORTERS}|[^\\s／/]{1,8}中心)[／/]${DATELINE_PLACE})報導`, "u");
const DATELINE_RES = [
  UNBRACKETED_DATELINE_RE,
  /^\s*[〔【\[［（(][^〔【\[［（(〕】\]］）)\n]{0,80}?(?:記者|報導|日電|專電|電訊|本報訊)[^〔【\[［（(〕】\]］）)\n]{0,30}?[〕】\]］）)]/,
  /^\s*[〔【\[［（(][^〔【\[［（(〕】\]］）)\n]{1,10}?訊[〕】\]］）)]/,
  /^\s*[^\s，。、：:（(〔【\[［]{1,10}?訊(?=[\s，。、：:．.]|$)/,
];

// 文中「最早出現」的縣市：全名（COUNTY_CENTER 鍵，含台/臺異體）與短名規則一起取最小 index；
// 同位置全名優先（「嘉義縣」不被短名「嘉義」誤判為嘉義市）；機關所在地僅在標題降為備援。
export function detectCountyEarliest(text, context = "", isTitle = true) {
  const s = String(text || "");
  let best = null;
  let institution = null;
  const consider = (idx, full, key, length) => {
    const candidate = { idx, full, key };
    if (isTitle && /^(?:縣|市)?(?:地檢署|地院|地方法院|地方檢察署)/.test(s.slice(idx + length))) {
      if (!institution || idx < institution.idx || (idx === institution.idx && full)) institution = candidate;
    } else if (!best || idx < best.idx || (idx === best.idx && full)) best = candidate;
  };
  for (const name of Object.keys(COUNTY_CENTER)) {
    for (const m of s.matchAll(new RegExp(name, "g"))) {
      consider(m.index, true, name.replace(/^台/, "臺"), name.length);
    }
  }
  for (const [re, key] of COUNTY_MATCH) {
    for (const m of s.matchAll(new RegExp(re.source, "g"))) {
      if (/^(?:路(?!段)|街(?!頭)|大道|巷)/.test(s.slice(m.index + m[0].length))) continue;
      consider(m.index, false, resolveCountyShortName(key, s, context, m.index), m[0].length);
    }
  }
  for (const [place, key] of TOWNSHIP_COUNTY) {
    for (const m of s.matchAll(new RegExp(place, "g"))) {
      const after = s.slice(m.index + place.length);
      const before = s.slice(Math.max(0, m.index - 4), m.index);
  if ((place === "成功" && /^(?:攔阻|攔截|制止|阻止|導航)/.test(after)) ||
          (place === "成功" && /^嶺/.test(after)) ||
          (place === "將軍" && /^(?:級|詐騙)/.test(after)) ||
          (place === "太平" && /^間/.test(after)) ||
          (place === "口湖" && /河$/.test(before)) ||
          (place === "三星" && /^傳媒/.test(after)) ||
          (place === "泰山" && /^(?:企業|前?總經理|總座|董事長|集團)/.test(after)) ||
          (place === "將軍" && /(?:中東|神秘|詐騙)$/.test(before)) ||
          (place === "新營" && /重$/.test(before)) ||
          (place === "新興" && /^毒品/.test(after))) continue;
      if (/^(?:[東西南北中外新舊]+)?(?:[一二三四五六七八九十0-9]+)?(?:路(?!段)|街(?!頭)|大道|巷)/.test(after) && !(place === "林口" && /^街友/.test(after))) continue;
      const sentence = s.slice(0, m.index).split(/[，。！？；\n]/).at(-1) + s.slice(m.index).split(/[，。！？；\n]/)[0];
      const prefixedCounty = Object.keys(COUNTY_CENTER).some((county) => new RegExp(`${county}.{0,6}${place}`).test(sentence));
      if (AMBIGUOUS_TOWNS.has(place) && !prefixedCounty) continue;
      if (!prefixedCounty && !TOWNSHIP_EVENT_RE.test(sentence)) continue;
      if (/日本|韓國|美國|中國|英國|法國|德國|加拿大|澳洲|紐西蘭/.test(s.slice(Math.max(0, m.index - 20), m.index))) continue;
      consider(m.index, false, key, place.length);
    }
  }
  best ??= institution;
  if (!best) return { region: "全國", lat: null, lng: null };
  const [lat, lng] = COUNTY_CENTER[best.key];
  return { region: best.key, lat, lng };
}

// 長文（摘要/描述）縣市偵測：剝發稿地→取最早縣市；剝完無命中才回退發稿地縣市。
function stripDatelines(text) {
  const s = String(text || "");
  const datelines = [];
  let body = s.replace(BRACKET_DATELINE_RE, (m) => (datelines.push(m), " "))
    .replace(BRACKET_WIRE_DATELINE_RE, (m) => (datelines.push(m), " "));
  // 全域署名剝除後，再處理開頭的日電／短署名；連續署名逐層剝，最多 4 層防呆。
  for (let i = 0; i < 4; i++) {
    let next = body;
    for (const re of DATELINE_RES) {
      next = next.replace(re, (m) => {
        if (re === UNBRACKETED_DATELINE_RE && /發生|遭搶|火警|車禍|查獲|追蹤|民宅|銀樓/.test(m)) return m;
        datelines.push(m);
        return " ";
      });
    }
    if (next === body) break;
    body = next;
  }
  return { body, datelines };
}

export function detectCountyInBody(text) {
  const { body, datelines } = stripDatelines(text);
  const loc = detectCountyEarliest(body, "", false);
  if (loc.lat != null) return loc;
  return detectCountyEarliest(datelines.join(" "), "", false);
}

// 標題優先（取最早出現縣市），無命中才看摘要/描述（剝發稿地、取最早出現縣市）：
// 避免摘要提及的他縣市蓋過標題（如標題無地名、摘要寫「嘉義縣 東石鄉」）。
function countyFromItem(item) {
  const titleLoc = detectCounty(item?.title, [item?.description, item?.summary].filter(Boolean).join(" "));
  const titleNamesOffice = /(?:北檢|中檢|南檢|雄檢|桃檢|竹檢|苗檢|彰檢|嘉檢|屏檢|宜檢|花檢|東檢|地檢署|地方法院|地院)/.test(String(item?.title || ""));
  if (titleLoc.lat != null && !titleNamesOffice) return titleLoc;
  for (const text of [item?.description, item?.summary]) {
    const loc = detectCountyInBody(text);
    if (loc.lat != null) return loc;
  }
  if (titleLoc.lat != null) return titleLoc;
  return { region: "全國", lat: null, lng: null };
}

const HINT_TO_CAT = { 治安: "治安", 交通: "交通", 反詐: "反詐", 災防: "災防", 資安: "資安", 食安: "食安", 衛生: "衛生", 環境: "環境" };
// 翻車單獨出現在財經語境時不是事故；明確事故詞仍優先（例如股東駕車撞亡）。
export const TRAFFIC_INCIDENT_RE = /車禍|酒駕|毒駕|肇事|肇逃|超速|闖紅燈|追撞|連環撞|自撞|擦撞|對撞|相撞|撞死|撞傷|撞亡|撞山壁|輾(?:過|壓|斃|機車)|^(?!.*(?:台股|美股|股市|股價|股神|千金股|韭菜|違約交割|輝達|財報|股票|投資|台廠)).*翻車/s;
// 先依標題關鍵字判類，無命中再回退來源主題(hint)，預設治安（來源本就警政取向）。
const CAT_RULES = [
  [/詐騙|詐欺|車手|假投資|人頭帳戶|釣魚|解除分期|盜刷|博弈|洗錢|假交友|假檢警/, "反詐"],
  [TRAFFIC_INCIDENT_RE, "交通"],
  [/火警|火災|氣爆|爆炸|地震|颱風|豪雨|水災|淹水|山難|溺|搜救|消防|坍|土石|救護|受困/, "災防"],
  // 協尋置於災防後：溺水/搜救型失蹤維持災防；不含「尋獲」單獨詞（失竊物尋獲非協尋）。
  // 負向排除：失聯移工=查緝、命案/棄屍/通緝=刑案、騙=詐團話術，皆非尋人。
  [/^(?!.*(?:失聯移工|命案|兇殺|凶殺|殺人|棄屍|通緝|騙)).*(?:失蹤|協尋|走失|尋人|失聯|迷航|迷途)/s, "協尋"],
  // 車種與道路僅是弱訊號，不蓋過災防、協尋或刑案；酒駕等明確交通行為已在前面命中。
  [/^(?=.*(?:國道|機車|貨車|騎士)).*(?:毒品|安非他命|海洛因|愷他命|販毒|緝毒|掃黑|賄|起訴|遭逮|逮捕|查獲|通緝|命案|殺人|棄屍|竊|搶(?!救)|失聯移工|失物|尋回)/s, "治安"],
  [/國道|機車|貨車|騎士/, "交通"],
];
export function categoryFromItem(title, hint) {
  const s = String(title || "");
  for (const [re, c] of CAT_RULES) {
    if (re.test(s)) return { category: c, basis: `rule:${c}` };
  }
  if (HINT_TO_CAT[hint]) return { category: HINT_TO_CAT[hint], basis: `hint:${hint}` };
  return { category: "治安", basis: "default" };
}

export function refreshDomesticNewsCategory(event, item) {
  const basis = event?.categoryBasis || "";
  if (event?.scope === "international" || event?.source?.datasetId !== "tw-news" ||
      event.curated || event.curation || !/^(?:rule:|hint:|default)/.test(basis)) return event;
  // LLM 正規化過的事件標題可能已改寫，沒有原始項目時不能拿改寫後標題重算。
  if (!item && "aiTopic" in event) return event;
  // 舊 rule 不含原始 hint，不能把錯誤的 category 當回退值；hint 來源則可還原。
  const hint = item?.hint ?? (basis.startsWith("hint:") ? basis.slice(5) : undefined);
  const result = categoryFromItem(item?.title ?? event.title, hint);
  const refreshed = { ...event, category: result.category, categoryBasis: result.basis };
  // 使用者 2026-11-20 定案的降級（單純交通事故死亡、一般毒品查獲）也套用到沿用事件；只降這兩類，其他風險不重算。
  if (event.riskLevel === "high") {
    const text = `${item?.title ?? event.title} ${item?.description ?? event.summary ?? ""}`;
    const now = riskFromTitle(item?.title ?? event.title, hint, item?.description ?? event.summary);
    if (now === "medium" && (isPlainTrafficDeath(text) || DRUG_ONLY_RE.test(text))) refreshed.riskLevel = "medium";
  }
  // 地點規則更新後，沿用的「全國」舊新聞也重判一次；已有縣市者不動，避免來回跳動。
  if (event.region !== "全國" || event.lat != null) return refreshed;
  const loc = countyFromItem({ title: item?.title ?? event.title, description: item?.description ?? event.summary });
  if (loc.lat == null) return refreshed;
  return { ...refreshed, region: loc.region, lat: loc.lat, lng: loc.lng, locationPrecision: "city", locationNote: "依新聞地區推論，非精準事發地址" };
}

const HIGH = /命案|兇殺|凶殺|殺人|殺害|砍人|砍殺|砍傷|持刀|刺死|刺傷|分屍|棄屍|槍擊|開槍|中彈|性侵|擄人|勒贖|(?<![躲逃]過一)劫(?!後餘生)|致死|身亡|死亡|喪命|溺斃|縱火|爆炸|氣爆|滅門/;
const MED = /詐騙|詐欺|毒品|毒販|海洛因|安非他命|愷他命|K他命|大麻|喵喵|依托咪酯|緝毒|販毒|竊|搶|強盜|酒駕|毒駕|肇逃|肇事|傷害|鬥毆|車禍|起訴|收押|羈押|逮捕|查獲|落網|火警|火災|墜|溺|走私|偷渡|賄|貪/;
const HIGH_EN = /\b(murder|homicide|killed|dead|death|fatal|shooting|stabbing|explosion|kidnap\w*|rape|sexual assault|arson)\b/i;
const MED_EN = /\b(fraud|scam|drug|narcotic|arrest\w*|theft|robbery|burglar\w*|smuggl\w*|drunk driving|DUI|crash|fire|indict\w*|prosecut\w*|detain\w*|assault)\b/i;
const CRITICAL =
  /隨機殺人|無差別(?:殺人|砍人)|(?:氣爆|爆炸)[^，。！？；]{0,24}(?:[0-9０-９一二三四五六七八九十百兩]+\s*(?:死|亡)|死|亡|重傷)|(?:炸彈爆炸|爆炸)[^，。！？；]{0,12}縱火攻擊|(?:[0-9０-９]{2,}|[0-9０-９]{1,3}(?:[,，][0-9０-９]{3})+|[一二三四五六七八九兩幾數]*[十百千萬][一二三四五六七八九兩幾數十百千萬]*)\s*[餘多]?\s*(?:人|名)?\s*(?:死|亡|罹難|喪生|喪命|身亡)|(?:大量|重大|多人)(?:傷亡|死傷|死亡)|多人(?:罹難|喪命|身亡)|滅門|挾持[^，。！？；]{0,12}人質|大規模[^，。！？；、]{0,12}(?:傷亡|死傷|死亡|爆炸|攻擊|砍人|殺人)/;
const NO_CRITICAL_CASUALTY = /(?:幸)?無(?:人)?傷亡|未(?:造成|傳出)?傷亡|無人(?:受傷|死亡|傷亡)/;
const HIGH_FLOOR = /命案|兇殺|凶殺|殺人|殺害|不治|罹難|奪命|斃命|喪生|喪命|遇害|遇難|悶死|枉死|猝死|暴斃|刺殺|中刀|壓死|壓斃|槍手|持槍|中槍|中彈|[1-9１-９]\s*(?:人|名)?\s*(?:死(?!角)|亡|罹難|喪生|喪命|身亡)|槍擊|開槍|槍械|槍彈|槍枝|彈藥|持刀[^，。！？；]{0,16}(?:致死|死亡|身亡|喪命)|(?:毒品|海洛因|安非他命|愷他命|K他命|大麻|古柯鹼|喵喵)[^，。！？；]{0,16}(?:重案|大案|工廠|集團|走私|販運|製造|[0-9０-９.]+\s*(?:公斤|噸))|[0-9０-９.]+\s*(?:公斤|噸)[^，。！？；]{0,6}(?:毒品|海洛因|安非他命|愷他命|K他命|大麻|古柯鹼)|緝毒[^，。！？；]{0,16}(?:重案|大案)|(?:販毒|運毒|製毒)集團|製毒|毒品工廠/;
const ROUTINE = /說明會|宣導|記者會|頒獎/;
const CYBER_ROUTINE =
  /宣導|講座|說明會|研習|論壇|課程|競賽|駭客松|體驗營|防護(?:週|月|宣導)|資安月|徵才|開箱|評測|上市(?!櫃|上櫃|公司|企業)|個資保護(?:法)?|資安意識|防詐宣導/;
const CYBER_HIGH =
  /勒索(?:病毒|軟體|攻擊)?|遭勒索|網攻|網路攻擊|(?:遭|被)?駭(?:客)?(?:入侵|攻擊|竊)|入侵[^，。！？；]{0,20}(?:系統|主機|伺服器)|癱瘓[^，。！？；]{0,20}(?:系統|服務|網路)|殭屍網路|供應鏈攻擊/;
const CYBER_DATA_BREACH =
  /個資外洩|資料外洩|個(?:人)?資(?:料)?[^，。！？；]{0,6}(?:外洩|遭竊)|外洩[^，。！？；]{0,6}個資|資料庫外洩|帳號(?:密碼)?外洩/;
const CYBER_DATA_BREACH_SCALE =
  /大規模|[0-9０-９]{2,}\s*萬|[0-9０-９]+\s*億|百萬|千萬|上億|數十萬|數百萬/;

// 主題提示詞專用風險詞（高/中）；若存在 hint 時優先套用 topic 規則，否則沿用警政規則。
export const TOPIC_RISK = {
  食安: {
    high: /餿水油|病死豬|食物中毒|致癌|致死|中毒/,
    med: /黑心|瘦肉精|農藥殘留|摻偽|偽藥|禁藥|下架|回收|查獲|走私|標示不實|逾期/,
  },
  衛生: {
    high: /群聚感染|爆發|重症|死亡|院內感染/,
    med: /確診|群聚|隔離|傳染|染疫/,
  },
  環境: {
    high: /毒物|外洩|重金屬|致癌|戴奧辛/,
    med: /偷排|廢水|污染|裁罰|廢棄物|棄置|盜採|濫墾/,
  },
  資安: {
    high: /勒索|網攻|入侵|癱瘓|殭屍網路/,
    med: /駭客|個資|外洩|漏洞|釣魚|盜刷|木馬/,
  },
};

// 使用者 2026-11-20 定案：交通事故的死亡算中；命案、殺人與蓄意衝撞仍算高。
const DEATH_RE = /不治|罹難|奪命|斃命|喪生|喪命|遇難|猝死|暴斃|身亡|死亡|致死|撞亡|撞死|輾斃|壓死|壓斃|[0-9０-９一二三四五六七八九十兩]+\s*(?:人|名)?\s*(?:死(?!角)|亡|罹難|喪生|喪命|身亡)|死劫/g;
const DRUG_ONLY_RE = /海洛因|安非他命|愷他命|K他命|大麻|喵喵|依托咪酯|毒品|毒販/;
// 使用者 2026-11-20 二次確認：酒駕、毒駕、肇逃等交通死亡也算中；只有蓄意或隨機衝撞這類攻擊、命案仍算高。
const CRIMINAL_TRAFFIC_RE = /蓄意|故意|殺人|命案|持刀|槍|隨機撞|衝撞人群|開車衝撞|駕車衝撞/;

function isPlainTrafficDeath(s) {
  const traffic = TRAFFIC_INCIDENT_RE.test(s) ||
    (/撞|輾|翻覆/.test(s) && /車|騎士|行人|國道|快速道路|省道|台[0-9０-９]+[甲乙丙]?線|公路|路口|斑馬線/.test(s) &&
      !/雲霄飛車|遊樂|樂園|摩天輪/.test(s));
  // 工地的吊車、堆高機翻覆是工安事故，不算交通事故。
  if (!traffic || CRIMINAL_TRAFFIC_RE.test(s) || /工安|職災|工地|吊車|堆高機|怪手/.test(s)) return false;
  const withoutDeaths = s.replace(DEATH_RE, " ");
  return withoutDeaths !== s && !HIGH_FLOOR.test(withoutDeaths) && !HIGH.test(withoutDeaths);
}

export function riskFromTitle(title, hint, description = "") {
  const risk = riskFromText(title, hint, description);
  // 只把「因死亡字眼才判高」的單純交通事故降為中，不把原本較低的拉高。
  return risk === "high" && isPlainTrafficDeath(`${String(title || "")} ${String(description || "")}`) ? "medium" : risk;
}

function riskFromText(title, hint, description = "") {
  const titleText = String(title || "");
  const s = `${titleText} ${String(description || "")}`;
  if (CRITICAL.test(s) && !NO_CRITICAL_CASUALTY.test(s)) return "critical";
  if (HIGH_FLOOR.test(s)) return "high";
  const isRoutine = ROUTINE.test(titleText);
  const isCyberRoutine = isRoutine || CYBER_ROUTINE.test(titleText);
  if (!isCyberRoutine) {
    if (CYBER_HIGH.test(s)) return "high";
    if (CYBER_DATA_BREACH.test(s)) return CYBER_DATA_BREACH_SCALE.test(s) ? "high" : "medium";
  }
  const topicRisk = TOPIC_RISK[hint];
  if (topicRisk) {
    if (hint === "資安" && isCyberRoutine) return "low";
    if (topicRisk.high.test(s)) return "high";
    if (HIGH.test(s) || HIGH_EN.test(s)) return "high";
    if (isRoutine) return "low";
    if (topicRisk.med.test(s)) return "medium";
    if (MED.test(s) || MED_EN.test(s)) return "medium";
    return "low";
  }
  if (HIGH.test(s) || HIGH_EN.test(s)) return "high";
  if (isRoutine) return "low";
  if (MED.test(s) || MED_EN.test(s)) return "medium";
  return "low";
}

// 警政相關性關鍵字（標題＋摘要任一命中才收）。濾掉政府/綜合 feed 的非犯罪內容（政策、活動、排名、衛教…）。
const POLICE_RE = /詐|車手|毒品|緝毒|販毒|製毒|安非他命|海洛因|大麻|愷他命|竊|偷|扒|搶|強盜|劫|侵占|命案|兇殺|凶殺|殺人|砍|刺|鬥毆|毆|傷害|施暴|槍|彈藥|爆裂|爆炸|氣爆|性侵|性騷|猥褻|偷拍|性影像|妨害|家暴|虐|跟蹤|跟騷|騷擾|恐嚇|脅迫|擄|勒贖|綁架|賭|博弈|簽賭|假球|娼|應召|嫖|幫派|黑道|圍事|角頭|竹聯|四海幫|天道盟|潛逃|逃亡|走私|偷渡|人口販運|人蛇|洗錢|吸金|騙局|行騙|賄選|查賄|買票|貪污|貪瀆|收賄|圖利|掏空|背信|內線|偽造|偽鈔|變造|假冒|冒用|盜刷|盜用|個資|駭客|勒索病毒|起訴|公訴|偵辦|偵查|偵結|偵破|搜索|約談|羈押|聲押|收押|交保|通緝|落網|到案|逮捕|查獲|破獲|查緝|查扣|移送|判刑|判決|定讞|求刑|宣判|一審|二審|體罰|犯|嫌|警方|員警|警察|捷警|鐵警|刑事|刑警|檢方|檢警|檢調|地檢|調查局|海巡|移民署|消防|救護|搜救|溺|墜|罹難|傷亡|死傷|身亡|致死|喪命|奪命|縱火|火警|火災|肇事|肇逃|酒駕|毒駕|車禍|碰撞|擦撞|追撞|自撞|撞死|撞傷|撞進|翻車|事故|失蹤|協尋|尋回|走失|迷航|迷途|失聯|襲警|拒檢|拒捕|臨檪|臨檢|攔查|路檢|掃蕩|掃黑|肅竊|取締|落水|中毒|外洩|不法|違法|非法|犯罪|刑案|治安|報案|110|165/;

const CASE_TITLE_RE = /(?<!\p{Script=Han})\p{Script=Han}{2,6}案/gu;
// 行政／商業與泛稱國安案不足以推定一般刑案，尤其不能擴收港澳政治審判。
const EXCLUDED_CASE_NAME_RE = /(?:提|法|方|預算|草|議|專|檔|答|個|教|圖|文|備|定|建|推|併購|投資|上市|修正|開|結|國安(?:法)?)案$/;
const CASE_TITLE_CONTEXT_RE = /受害(?:者|人)|被害(?:者|人)|餘悸|開庭|求判|辯論終結/;
const CONDITIONAL_SENTENCE_RE = /(?:最重判|可判|恐判)\s*[0-9０-９一二三四五六七八九十百兩]+\s*年/;
const DOMESTIC_JUSTICE_RE = /衛福部|衛生福利部|法務部|司法院/;

function hasPoliceTitleEvidence(title) {
  const text = String(title || "");
  if (CONDITIONAL_SENTENCE_RE.test(text) && DOMESTIC_JUSTICE_RE.test(text)) return true;
  // ponytail: 案名只認獨立的 2–6 個漢字且須有受害／庭訊脈絡；更長或省略脈絡的標題需另做語意判讀。
  return CASE_TITLE_CONTEXT_RE.test(text) &&
    [...text.matchAll(CASE_TITLE_RE)].some(([name]) => !EXCLUDED_CASE_NAME_RE.test(name));
}

const NON_EVENT_LANDING_RE = /查詢系統|管理資訊系統|資訊系統|資訊網站|全球資訊網|清冊|資料查詢/;
const SPECIFIC_NON_EVENT_TITLE_RE = /環保稽查處分管制系統/;
const EVENT_ACTION_RE = /駭客|(?:個資|資料)?外洩|攻擊|破獲|查獲|逮捕|落網|起訴|下架|回收|裁罰|偷排|食物中毒|群聚|確診|火警|車禍|命案|殺人|砍人|詐騙|盜用|盜刷|釣魚|冒用|毒品/;
const ENTERTAINMENT_RE = /劇透|劇情|懶人包|追劇|大結局|第\s*[0-9０-９]+(?:\s*[-–—~至到]\s*[0-9０-９]+)?\s*集|第\s*[一二三四五六七八九十百兩]+\s*集|分集劇情/;
const ENTERTAINMENT_PRODUCTION_RE = /(?:新劇|新戲).{0,30}(?:演|拍攝|開拍|殺青)|(?:拍攝現場|粉絲圍觀).{0,20}(?:新劇|新戲|演員|藝人)/;
// 弱娛樂訊號：受 EVENT_ACTION_RE 保護（盜版片名常是詐騙/盜帳號誘餌，不可無條件剔）
const WEAK_ENTERTAINMENT_RE = /線上看|預告片/;
const AIR_QUALITY_REFERENCE_RE = /(?:空氣品質指數|空氣品質).{0,12}(?:AQI|空氣污染)|\bAQI\b.{0,12}空氣污染/i;
const FOREIGN_PLACE_RE =
  /委內瑞拉|巴基斯坦|俄羅斯|烏克蘭|基輔|莫斯科|緬甸(?!女|籍)|奈及利亞|法國|德國|英國|美國|加拿大|南韓|韓國(?!瑜)|首爾|日本|東京|大阪|印度(?!籍|男|女|妻|法商|移工)|以色列|加薩|巴勒斯坦|敘利亞|大馬士革|黎巴嫩|泰國(?!籍|進口|龍眼|神秘|航空|空服|箱屍)|曼谷|菲律賓|馬尼拉|印尼|雅加達|(?<!橫)越南(?!籍|移工|女|妻|同鄉)|河內|馬來西亞|新加坡|墨西哥|巴西|阿根廷|義大利|西班牙|葡萄牙|荷蘭|比利時|瑞士|瑞典|挪威|波蘭|希臘|土耳其|埃及|沙烏地|阿聯|伊朗|伊拉克|阿富汗|蘇丹|肯亞|南非|澳洲|紐西蘭|烏干達|剛果|衣索比亞|阿爾及利亞|摩洛哥|波斯尼亞|赤道幾內亞|摩爾多瓦|祕魯|秘魯|孟買|象牙海岸|丹佛/;
const TAIWAN_MARKER_RE =
  /台灣|臺灣|中華民國|我國|本國|國內|國人|台商|臺商|僑(?:胞|民|界)|外交部|陸委會|僑委會|駐[^\s]{1,5}(?:代表處|辦事處|使館)|國防部|移民署|刑事局|警政署|內政部|國安局|調查局|檢調|食藥署|海巡署|海關|法務部|行政院|立法院|立院|立委|地檢署|台北|臺北|新北|桃園|台中|臺中|台南|臺南|高雄|基隆|新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|台東|臺東|澎湖|金門|馬祖|連江|林口|二林|中正|兩岸|台男|臺男|台女|臺女|台版|臺版|台廠|臺廠|全台|全臺|台海|臺海|來台|來臺|在台|在臺|赴台|赴臺|返台|返臺|入台|入臺|台日|臺日|台美|臺美|台德|臺德|駐美|駐日|駐外|移工|外籍|新住民|美籍|英籍|澳籍|印尼籍|印度籍|越南籍|緬甸籍|泰籍|港人|印尼語|越南語|泰語|華語|青雲|是方電訊|美超微|黃國昌|四叉貓|郭正亮|奧丁丁|東京著衣|解放軍|共軍|中國(?:大陸)?[^，。；]{0,8}(?:試射|軍演|飛彈|航艦|航母|軍機|擾台|封鎖)/;
const TAIWAN_NEGATED_CONTEXT_RE = /與(?:台灣|臺灣)[^，。；、]{0,12}無(?:直接)?關聯|無(?:任何)?(?:台灣|臺灣)關聯|不只(?:台灣|臺灣)/g;
const CYBER_FOREIGN_EXEMPT_RE = /資安|個資|資料.{0,6}外洩|漏洞|駭客|網攻|網路犯罪|勒索|CVE/i;
// 純外國事件只在「天災/戰爭/大量傷亡」語境才過濾——外國一般犯罪/貿易/司法常與台灣有關（進口、跨境嫌犯、國人涉案），保留以免誤刪。
const FOREIGN_EVENT_CONTEXT_RE =
  /強震|地震|餘震|野火|森林大火|山火|林火|熱浪|颶風|龍捲風|洪水|水災|土石流|火山|海嘯|乾旱|暴雪|寒流|內戰|戰爭|開戰|停火|空襲|飛彈|導彈|無人機|砲擊|恐攻|恐怖攻擊|爆炸案|炸彈客|自殺炸彈|政變|叛軍|交火|流血衝突|墜谷|墜崖|墜機|空難|沉船|船難|成災|(?:[0-9０-９]{2,}|千|萬|多人|大量|數十|數百)\s*[餘多]?\s*人?\s*(?:死|亡|傷|罹難|喪生|喪命)/;

function sourceText(source) {
  if (!source) return "";
  if (typeof source === "string") return source;
  return [
    source.name,
    source.aggregatorName,
    source.publisher,
    source.source,
    source.query,
  ].filter(Boolean).join(" ");
}

function isDomesticMediaNews(item) {
  const datasetId = item?.source?.datasetId ?? item?.datasetId;
  return item?.scope !== "international" && (!datasetId || datasetId === "tw-news") &&
    item?.official !== true && item?.source?.authority !== "official";
}

// 只認發行者完整名稱，不讓 TVB 命中 TVBS；「大紀元」總站也報台灣新聞（如桃檢殯葬駭客案），只列香港版。
const OVERSEAS_PUBLISHER_RE = /^(?:香港01|Sing Tao Daily 星島日報加拿大|星島頭條|Singtaousa|加拿大星島日報|on\.cc東網|澳門廣播電視股份有限公司|澳門日報|澳門力報|澳門特別行政區政府入口網站|dotdotnews|巴士的報|RTHK News|明報(?:新聞網)?|香港政府資訊中心|香港經濟日報HKET|香港文匯報|大公文匯網|香港商报|東方日報|TVB|大紀元時報香港|華人今日網|澳洲看新闻)$/i;
// 不使用海關、移工、外籍、港人、國內等各地通用詞，也不使用 feed query 的台灣標籤。
const STRONG_TAIWAN_MARKER_RE = /[台臺]灣|中華民國|[台臺]北|新北|桃園|[台臺]中|[台臺]南|高雄|基隆|新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|[台臺]東|澎湖|金門|馬祖|連江縣|林口|二林|淡水|板橋|新莊|中壢|八里|內埔|國人|兩岸|(?:來|在|赴|返|入|駐|全)[台臺]|[台臺](?:男|女|商|海)/;

// 大紀元總站兼報台灣與海外：只在標題有海外地名時剔除，地點不明者保留（不用國籍、「中共」，台灣共諜／外籍嫌犯案也會用）。
const OVERSEAS_PLACE_HINT_RE = /(?<!和)美(?:國|機場|警)|聯邦調查局|FBI|加國|亞省|卑詩|安省|魁省|多倫多|溫哥華|堪培拉|雪梨|悉尼|墨爾本|紐約|洛杉磯|舊金山|三藩市|夏威夷|檀香山|HPD|中國(?:男子|女子|留學生)|西藏|新疆|香港|澳門|州|郡|斯特/;

export function isOverseasLocalNews(item) {
  if (!isDomesticMediaNews(item)) return false;
  // RSS 原始項目把發行者放在頂層 publisherName，source 只是 feed 標籤。
  const publisher = sourceText(item?.publisherName ?? item?.source?.name ?? item?.source?.publisherName ?? item?.source).trim();
  const text = `${item?.title || ""} ${item?.description || ""} ${item?.summary || ""}`;
  if (STRONG_TAIWAN_MARKER_RE.test(text.replace(TAIWAN_NEGATED_CONTEXT_RE, ""))) return false;
  if (OVERSEAS_PUBLISHER_RE.test(publisher)) return true;
  if (publisher !== "大紀元") return false;
  // 總站兼報台灣：台灣機關（刑事局、地檢署）、市級簡稱（北市）、檢方簡稱（北檢）都算台灣；國籍（日本籍）只說明人。
  if (TAIWAN_MARKER_RE.test(text) || /(?:北|桃|竹|中|嘉|南)市|高市(?!早苗)|(?:雄|橋|北|士林|板橋|新北|桃|新竹|苗栗|中|彰|投|雲|嘉|南|橋頭|高|屏|宜|花|東|澎|金)檢/.test(text)) return false;
  const title = String(item?.title || "").replace(/[一-鿿]{1,4}籍|日本刀|武士刀/g, " ");
  return FOREIGN_PLACE_RE.test(title) || OVERSEAS_PLACE_HINT_RE.test(title);
}

// ponytail: 有限詞表只遮掉明確比喻片段；未涵蓋的歧義留待人工稽核，不封鎖整篇財經新聞。
const FIGURATIVE_NEWS_RE = new RegExp([
  "搶攻|搶進|搶搭|搶食|搶客(?!人)|搶票|搶才|搶先|搶購|搶眼|搶反彈|搶(?:航太)?商機|搶席次|高薪搶人|搶人大戰|開搶|快搶|瘋搶",
  "衝刺|刺激|諷刺|被打槍|投顧第一槍|外資殺人不眨眼|殺最兇|殺價",
  "(?:狠|大)?砍(?:單|價|評等|持股|預算|成零元)",
  "(?:狠|大)砍(?=(?:「[^」]{1,12}」|[0-9]{4,6})?(?:近|逾)?[0-9.]+(?:萬)?(?:張|股|億)|AI支出|英特爾持股)",
  "外資(?:再)?砍(?=[0-9.]+億)|(?:聯發科|輝達|英特爾)(?:TPU)?也中槍",
  // 選戰、演藝、消費、球賽的「搶、砍、殺」（正式站 2026-11-19 實見漏網）。
  "搶(?:鏡|戲|C位|獎|功|主導權|經營權|大單|愛心|曬|跑|訂|買|打卡|吸)|搶(?![劫奪走])[^，。！？ 　]{0,4}(?:票|席)|搶開(?=[^，。！？ 　]{0,6}支票)|(?:限時|準時)搶",
  "(?<![遭被])砍(?=[0-9０-９]{1,3}分(?!鐘))|砍(?=目標價|福利(?!社)|[^，。！？ 　]{0,2}行程)|大砍它|殺人事件(?=[^《》]{0,12}》)|殺人誅心|相愛相殺",
].join("|"), "g");
// 「搶救、搶命」在車禍火警等真事件裡常是唯一的關鍵字，全文有傷亡或事故跡象才當證據。
const REAL_RESCUE_RE = /撞|跌|摔|倒下|中風|職災|工安|燒|燙|墜|溺|送醫|不治|命危|傷|亡|死|倒地|輾|OHCA|心跳|火|爆|救回|救出|受困|昏迷|中毒|意外|車禍|警|消防/;
// 財經比喻只認市場主詞（外資續砍、投信大砍、外資殺紅眼）或市場受詞（砍6.5萬張、搶商機），
// 不用「生意」等泛用語境，避免誤刪生意糾紛砍人、搶銀樓等真案件。
const MARKET_FIGURATIVE_RE = new RegExp([
  "(?<=(?:外資|投信|自營商|法人|機構|資金|投資人|國家隊)[^，。！？ 　遭被]{0,6})(?:砍|殺)(?!人|傷|死|害|斷|頭|倒)",
  "砍(?!人|傷|死|殺|頭|斷|倒)(?=[^，。！？ 　在於]{0,8}(?:持股|萬張|[0-9]張|[0-9]檔|億|兆|[台臺]股|ETF|門市|據點|產能|支出|預測|評等))",
  "搶(?!劫|案|奪|匪|走|銀|超商|店|金|車|機|包|錢)(?=[^，。！？ 　在於]{0,10}(?:生意|商機|訂單|市場|市占|客戶|資料中心|基層|人才|灘|反彈))",
  "能搶(?=[？?])|殺(?=紅眼|盤|低|進殺出)|爆炸(?=開局|性成長|式成長)|萬金破案",
].join("|"), "g");
// 移民署新聞網會轉載一般財經新聞，雖是官方來源仍套用比喻判斷。
const IMMIGRATION_NEWS_SOURCE_RE = /移民署|移民新聞|新住民全球新聞網/;

function withoutFigurativeNewsEvidence(item) {
  if (!isDomesticMediaNews(item) && !IMMIGRATION_NEWS_SOURCE_RE.test(sourceText(item?.source))) return item;
  const realRescue = REAL_RESCUE_RE.test(`${item?.title || ""} ${item?.description || item?.summary || ""}`);
  const strip = (value) => {
    let text = String(value || "").replace(FIGURATIVE_NEWS_RE, " ");
    if (!realRescue) text = text.replace(/搶(?:救|命|時間)/g, " ");
    text = text.replace(MARKET_FIGURATIVE_RE, " ");
    if (/賣超|ETF|持股/.test(text)) text = text.replace(/大屠殺/g, " ");
    if (/選情|選戰|議員|席次/.test(text)) text = text.replace(/[0-9]+搶[0-9]+/g, " ");
    return text;
  };
  const title = strip(item?.title);
  const description = strip(item?.description || item?.summary);
  if (title === String(item?.title || "") && description === String(item?.description || item?.summary || "")) return item;
  return { ...item, title, description };
}

export function isFigurativeNewsNoise(item) {
  const stripped = withoutFigurativeNewsEvidence(item);
  return stripped !== item && !isRelevantNewsItem(stripped);
}

const IMMIGRATION_LIFESTYLE_RE =
  /百人百聲|TWAC|文化交流|文化體驗|文化鵲橋|七夕|職涯|親子活動|親子連結|體驗營|課程|講座|宣導|說明會|報名|抽獎|好禮|得獎名單|表揚|頒獎|影音新聞|廉政動畫|療癒|暢談|扎根|便民|填報|申報|樂園|音樂祭|能力升級|數位資訊|服務站|人道關懷/;
const IMMIGRATION_ENFORCEMENT_RE =
  /查獲|查緝|查察|破獲|逮捕|拘提|搜索|移送|偵辦|起訴|判刑|收押|羈押|通緝|攔截|截獲|攔阻|瓦解|尋回|救出|救援|裁處|遣返|驅逐|偷渡|非法入境|逾期居留|失聯移工|人口販運|人蛇|假結婚|偽造證件|性剝削|勞力剝削/;
const POLITICAL_CONTEXT_RE =
  /總統|總統府|行政院|中央|市府|縣府|立法院|立院|議會|立委|議員|市長|縣長|候選人|政黨|國民黨|民進黨|民眾黨|白營|藍營|綠營|藍綠|朝野|政治|施政|食安會|缺席|藍(?=籲|批|嗆)|綠(?=籲|批|嗆|稱)/;
const POLITICAL_RHETORIC_RE = /互嗆|喊話|喊|嗆|號召|抗議|批評|反擊|缺席|口水|杯葛|造勢|政治秀|政治責任|檢討|轟|酸/;
const PURE_POLITICS_RE = /號召.{0,8}上街|選舉|罷免|民調|政黨攻防|藍綠互批|朝野攻防/;
const CRIMINAL_PROCEEDING_RE =
  /查獲|查緝|破獲|逮捕|拘提|搜索|移送|偵辦|偵查|起訴|羈押|收押|交保|判刑|判決|定讞|通緝|報案|涉嫌|涉案|被控|拒捕|襲警|詐騙|詐欺|貪污|收賄|行賄|圖利|洗錢|偽造|共諜|洩密|暴力|恐嚇|性騷|性侵|命案|殺人|砍(?:人|傷|死)|刺(?:人|傷|死)|虐童|兒虐|虐待|毒品|槍擊|竊盜|搶劫|酒駕|肇事|車禍|火災|爆炸|人口販運|食物中毒|偷排|裁罰|裁處|稽查/;
const ANTI_FRAUD_OUTREACH_RE = /(?:反詐|防詐).{0,24}(?:宣導|宣傳|講習|聯名)|(?:宣導|宣傳|講習|聯名).{0,24}(?:反詐|防詐)/;
// 官方 feed 的機關名稱本身就命中 POLICE_RE；行政標題不能靠摘要的制式犯罪詞變成案件。
const OFFICIAL_ADMIN_RE = /公示送達|應受送達|偵查終結公告|偵結公告|移置保管逾期|案件統計表|統計(?:分析)?表|有罪者性別統|^附表|偵結要旨|履行支付情形|人事調整|認罪協商金|財產申報|會計月報|授旗誓師/;
const OFFICIAL_OUTREACH_RE = /捐贈|受贈|捐血|公益勸募|職缺|甄選|甄試|徵才|招募|通譯.*(?:名冊|聯絡窗口)|交通(?:管制|疏導)|管制措施|彈性管制|臨時(?:使用道路|道路使用)|道路.*施工|工程施工|執法設備設置地點|公告名單|警察刑事紀錄證明|良民證|初體驗|警察節.*影片|宣導|宣傳|圖卡|海報|Podcast|識詐教育|犯罪防治|小編說時事|手法.*(?:解析|破解)|小心.*詐騙|法源依據|不上當|新制施行|什麼是|怎麼防|頒獎|受獎|獲獎|表揚|聯繫會議|座談|研習|參訪|專訪|彩繪|嘉年華|熱舞比賽|發糖同樂|志工培力營/i;
const OFFICIAL_CASE_ACTION_RE = /查獲|查緝|偵破|破獲|逮捕|逮獲|逮車手|拘提|搜索|移送|偵辦|偵結|起訴|公訴|聲押|羈押|收押|交保|判刑|判決|定讞|拒檢|拒捕|落網|上銬|人贓俱獲|攔阻|再阻|取締|裁罰|抗告|阻詐|成功阻|勸阻|攔查|送辦|法辦|究辦|緝獲|查扣|扣押|約談|傳喚|具保|通緝|到案|投案|攻堅|圍捕|壓制|制伏|瓦解|揭穿|尋獲|尋回|救出|遣返/;
const OFFICIAL_PLACEHOLDER_RE = /^(?:Untitled|pdf|[-–—]|\d[\d.-]*\.pdf|新聞稿|臺灣.{1,4}地方檢察署(?:新聞稿)?|.{2,3}[縣市](?:政府)?警察局)(?:\s+-\s+.*)?$/i;

export function isPoliceNewsNoise(item) {
  const title = String(item?.title || "");
  const text = `${title} ${String(item?.description || "")}`;
  if (item?.official === true && ["治安", "反詐", "協尋"].includes(item?.hint)) {
    if (OFFICIAL_ADMIN_RE.test(title) || OFFICIAL_PLACEHOLDER_RE.test(title)) return true;
    if (OFFICIAL_OUTREACH_RE.test(title) && !OFFICIAL_CASE_ACTION_RE.test(title)) return true;
  }
  if (ANTI_FRAUD_OUTREACH_RE.test(text) && !CRIMINAL_PROCEEDING_RE.test(text)) return true;
  if (
    IMMIGRATION_NEWS_SOURCE_RE.test(sourceText(item?.source)) &&
    IMMIGRATION_LIFESTYLE_RE.test(text) &&
    !IMMIGRATION_ENFORCEMENT_RE.test(text)
  ) {
    return true;
  }
  const politicalNoise = PURE_POLITICS_RE.test(title) ||
    (POLITICAL_CONTEXT_RE.test(title) && POLITICAL_RHETORIC_RE.test(title));
  return politicalNoise && !CRIMINAL_PROCEEDING_RE.test(title);
}

// 標題已有明確案件字眼者不送 LLM 複核，避免模型誤刪真案件。
export function hasStrongCaseTitle(title) {
  const text = String(title || "");
  return CRIMINAL_PROCEEDING_RE.test(text) || HIGH.test(text) || HIGH_FLOOR.test(text) || /工安|職災/.test(text);
}

export function isNonEventNoise(item) {
  const title = String(item?.title || "");
  const source = sourceText(item?.source);
  const text = `${title} ${source}`;
  if (ENTERTAINMENT_RE.test(title)) return true;
  if (ENTERTAINMENT_PRODUCTION_RE.test(title) && !EVENT_ACTION_RE.test(title)) return true;
  if (SPECIFIC_NON_EVENT_TITLE_RE.test(title)) return true;
  if (EVENT_ACTION_RE.test(title)) return false;
  if (WEAK_ENTERTAINMENT_RE.test(title)) return true;
  if (NON_EVENT_LANDING_RE.test(title)) return true;
  if (/\bIQAir\b/i.test(text)) return true;
  if (AIR_QUALITY_REFERENCE_RE.test(title)) return true;
  return false;
}

export function isForeignNonTaiwan(item) {
  if (isOverseasLocalNews(item)) return true;
  const title = String(item?.title || "");
  const text = `${title} ${String(item?.description || "")} ${String(item?.summary || "")}`;
  if (CYBER_FOREIGN_EXEMPT_RE.test(text)) return false;
  // 只在「標題同時命中外國地名與天災/戰爭/大量傷亡語境」才視為純外國事件（高確定性，避免誤刪提及外國的台灣新聞）。
  if (!(FOREIGN_PLACE_RE.test(title) && FOREIGN_EVENT_CONTEXT_RE.test(title))) return false;
  // 全文任一台灣關聯標記 → 保留（如「台灣捐款委內瑞拉震災」「國人在日本罹難」）。
  if (TAIWAN_MARKER_RE.test(text.replace(TAIWAN_NEGATED_CONTEXT_RE, ""))) return false;
  // 反詐/食安/資安來源通常保留跨境脈絡；但若標題已明確是純外國天災/戰爭/大量傷亡，仍應由相關性閘剔除。
  return true;
}

export function isPoliceRelevant(title, description) {
  const text = String(title || "") + " " + String(description || "");
  // 英文警政關鍵字（EN 來源靠此通過；POLICE_RE 為中文導向，對英文內容全 miss）。
  const POLICE_EN_RE =
    /\b(police|arrest\w*|fraud|scam|drug|narcotic|smuggl\w*|murder|homicide|kidnap\w*|robbery|theft|burglar\w*|assault|prosecut\w*|indict\w*|convict\w*|sentenc\w*|detain\w*|custody|wanted|gang|trafficking|launder\w*|bribe\w*|corruption|counterfeit|hack\w*|ransomware|phishing|crash|collision|drunk driving|DUI|blaze|explosion|rescue|drown\w*|manhunt|shooting|stabbing|crime|criminal|missing)\b/i;
  return POLICE_RE.test(text) || POLICE_EN_RE.test(text) || hasPoliceTitleEvidence(title);
}

// 主題來源專用相關性關鍵字（hint 命中此表 → 以主題正則取代警政漏斗；未列者照舊走 POLICE_RE）。
// 來源漏斗診斷（docs/reports/2026-07-03）：食安/環保/衛生/科技來源過不了警政關鍵字，貢獻歸零。
// 災防漏斗＝災害預警詞 ∪ 警政漏斗（2026-07-06 低貢獻 feed 分診：GN 土石流坍方 35 筆全滅於警政漏斗；
// 純取代制實測誤殺車禍/大火/消防救援等真實事件，故取聯集保證原本可過者零損失）。
const DISASTER_ALERT_RE =
  /土石流|坍方|走山|邊坡|落石|災情|警戒|撤離|疏散|避難|收容|淹水|積水|溢堤|潰堤|洪水|豪雨|暴雨|颱風|地震|餘震|海嘯|野火|停電|斷電|停水|路斷|封路|災害|災損|崩塌|坍塌|倒塌|殉職|受困|山難|海難|迷途|工安|職災|意外/;
const TOPIC_RE = {
  // 確診|疫情|撲殺：動物疫病爆發事件（2026-07-06 農業部 feed 分診：H5N1 確診遭誤殺；認事件詞不認病名，行政公告/知識文章照擋）。
  食安: /黑心|食安|餿水油|病死豬|瘦肉精|農藥殘留|逾期|竄改|標示不實|下架|回收|查獲|違規|走私|摻偽|偽藥|禁藥|食物中毒|確診|疫情|撲殺/,
  衛生: /疫情|群聚|確診|疫苗|傳染|染疫|食物中毒|中毒|院內感染|防疫|隔離/,
  環境: /污染|廢水|偷排|裁罰|稽查|廢棄物|棄置|排放|空污|盜採|濫墾|噪音|毒物|外洩/,
  資安: /資安|駭客|個資|外洩|漏洞|勒索|釣魚|盜刷|木馬|殭屍網路|網攻|入侵/,
  災防: new RegExp(`${DISASTER_ALERT_RE.source}|${POLICE_RE.source}`),
};

export function isRelevantNewsItem(item) {
  item = withoutFigurativeNewsEvidence(item);
  if (isNonEventNoise(item)) return false;
  if (isForeignNonTaiwan(item)) return false;
  if (isPoliceNewsNoise(item)) return false;
  const topicRe = TOPIC_RE[item?.hint];
  if (topicRe) return topicRe.test(String(item?.title || "") + " " + String(item?.description || "")) ||
    (item?.hint === "災防" && hasPoliceTitleEvidence(item?.title));
  if (item?.official === true && /https:\/\/news\.google\.com\//.test(item?.sourceUrl || "")) {
    // GN description 是同一標題加發行者，機關署名不構成案件證據。
    return isPoliceRelevant(String(item?.title || "").replace(/\s+-\s+[^-]+$/, ""), "");
  }
  return isPoliceRelevant(item?.title, item?.description);
}

export function buildNewsRelevanceAudit(items, { generatedAt = new Date().toISOString(), sampleSize = 20 } = {}) {
  const generatedMs = Date.parse(generatedAt);
  const endMs = Number.isFinite(generatedMs) ? generatedMs : Date.now();
  const windowHours = 24;
  const windowStartMs = endMs - windowHours * 60 * 60 * 1000;
  const limit = Math.max(1, Math.floor(Number(sampleSize) || 20));
  const recent = (items || [])
    .filter((item) => {
      const publishedMs = Date.parse(item?.pubDate);
      return Number.isFinite(publishedMs) && publishedMs >= windowStartMs && publishedMs <= endMs;
    })
    .sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));
  const accepted = recent.filter(isRelevantNewsItem);
  const rejected = recent.filter((item) => !isRelevantNewsItem(item));
  const sample = (item) => ({
    title: String(item?.title || ""),
    link: String(item?.link || ""),
    pubDate: String(item?.pubDate || ""),
    source: String(item?.source || ""),
    hint: String(item?.hint || ""),
    authority: item?.official === true ? "official" : "media",
    description: String(item?.description || "").slice(0, 200),
  });

  return {
    generatedAt: new Date(endMs).toISOString(),
    windowHours,
    windowStart: new Date(windowStartMs).toISOString(),
    note: "以下為待人工判讀候選，不代表已確認錯誤；誤殺候選是被閘門排除的項目，漏網候選是通過閘門的項目。",
    population: { rawUnique: recent.length, accepted: accepted.length, rejected: rejected.length },
    samples: {
      potentialFalseNegatives: rejected.slice(0, limit).map(sample),
      potentialFalsePositives: accepted.slice(0, limit).map(sample),
    },
  };
}

function toIso(pubDate) {
  if (!pubDate) return new Date().toISOString();
  const d = new Date(pubDate);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function hash(s) {
  let h = 5381;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// items: [{title, link, description, source, sourceUrl, hint, pubDate}]
// excludeKeys: 已被 LLM 精修的 titleKey（避免重複），Set。
export function mapBulkNews(items, { fetchedAt, excludeKeys = new Set() } = {}) {
  const seen = new Set();
  const events = [];
  for (const it of items || []) {
    if (!isRelevantNewsItem(it)) continue; // 濾掉非警政內容
    const k = titleKey(it.title);
    const dedupeKey = dedupeTitleKey(it.title);
    if (!dedupeKey || seen.has(dedupeKey) || excludeKeys.has(k) || excludeKeys.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const loc = countyFromItem(it);
    const source = deriveNewsProvenance({ ...it, link: it.link || k }, { fetchedAt });
    const categoryResult = categoryFromItem(it.title, it.hint);
    events.push({
      id: `twnews-${hash(it.link || it.title)}`,
      title: cleanTitle(it.title),
      region: loc.region,
      lat: loc.lat,
      lng: loc.lng,
      timestamp: toIso(it.pubDate),
      category: categoryResult.category,
      categoryBasis: categoryResult.basis,
      scope: "domestic",
      riskLevel: riskFromTitle(it.title, it.hint, it.description),
      summary: String(it.description || cleanTitle(it.title)).trim().slice(0, 200) || cleanTitle(it.title),
      locationPrecision: loc.lat != null && loc.lng != null ? "city" : "unknown",
      locationNote: loc.lat != null && loc.lng != null ? "依新聞地區推論，非精準事發地址" : undefined,
      source: {
        ...source,
        normalizationMethod: "bulk",
        query: `${source.query}（全量收錄）`,
      },
    });
  }
  return events;
}

const INTERNATIONAL_HINT_TO_CATEGORY = {
  地緣政治: "地緣政治",
  治安: "治安",
  反詐: "反詐",
  協尋: "協尋",
  災害: "災害",
  災防: "災害",
  資安: "資安",
  金融: "金融",
};
const INTERNATIONAL_FEED_BY_LABEL = new Map(INTERNATIONAL_FEEDS.map((feed) => [feed.label, feed]));
const SCIENCE_STUDY_RE = /\b(?:study|research|trial|simulation|model|analysis|review|experiment|findings|predict(?:ion|s)?|forecast(?:s|ing)?|protocol|webinar|risk|monitoring|reveals?|hazards?|habitats?|days surged)\b|研究|論文|試驗|實驗|模擬|分析|回顧|研討會/i;
const CLEAR_HEALTH_EVENT_RE = /\b(?:kills?|injures?|spreads?|hits?|strikes?|destroys?|evacuates?|displaces?|death toll|rescue|missing|without power|worsens)\b|造成死傷|蔓延|襲擊|摧毀|撤離|罹難|死亡/i;
const INTERNATIONAL_CATEGORY_EVIDENCE = [
  [/\b(?:fraud|scam|ponzi|money laundering|fake investment)\b|詐騙|詐欺|洗錢|假投資/i, "反詐"],
  [/\b(?:cyber\s*attacks?|ransomware|data breaches?|data leaks?|malware|phishing|hacked)\b|網攻|駭客|勒索|資安|個資外洩|資料外洩|漏洞/i, "資安"],
  [/\b(?:stock market|share prices?|financial results|earnings|investors?|IPO|profits?|inflation rate|interest rates?|market outlook|markets outlook)\b|\bLNG\b.{0,40}\b(?:glut|market|outlook|supply|demand)\b|股市|金融|通膨|利率|股價|財報|投資|獲利/i, "金融"],
  [/\b(?:war|airstrike|missile strike|troops deployed|sanctions?|diplomacy|election|invasion|ceasefire)\b|戰爭|軍事|軍隊|飛彈|空襲|制裁|外交|選舉|入侵|停火/i, "地緣政治"],
  [/\b(?:earthquakes?|tsunamis?|floods?|flooding|fires?|wildfires?|bushfires?|storms?|collapses?|sinking|hurricanes?|typhoons?|cyclones?|tornadoes?|landslides?|volcanic eruptions?|droughts?|heatwaves?|blizzards?|avalanches?|outbreaks?|epidemics?|pandemics?|explosions?|derailments?|capsiz\w*|evacuat\w*|death toll)\b|地震|海嘯|洪水|水災|野火|山火|颶風|颱風|龍捲風|暴雨|土石流|火山爆發|乾旱|熱浪|暴雪|疫情|爆炸|倒塌|墜機|空難|出軌|沉船|翻覆|火災|撤離|罹難|死亡/i, "災害"],
  [/\b(?:murder|homicide|shooting|stabbing|kidnapping|robbery|assault|arrested for|charged with|crime)\b|命案|殺人|槍擊|刺傷|綁架|逮捕|搶劫|竊盜|襲擊|犯罪/i, "治安"],
];
const COUNTRY_LOCATIONS = [
  ["美國", 39.8, -98.6, /\b(?:United States|America|USA|US|California|Texas|Florida|Alaska|Hawaii|Arizona|Pennsylvania|Ohio|Colorado|Oregon|Washington|Rhode Island|Nebraska|West Virginia|Louisiana|Illinois|New York|New Jersey|North Carolina|South Carolina|North Dakota|South Dakota|Oklahoma|Tennessee|Utah|Vermont|Virginia|Wisconsin|Wyoming|Nevada|New Mexico|Minnesota|Montana|Idaho|Iowa|Kansas|Kentucky|Michigan|Mississippi|Arkansas|Alabama|Indiana|Missouri|Maryland|Delaware|Connecticut|Massachusetts)\b|\bU\.S\.A?(?:\.|(?=\W|$))|State of Georgia|(?:在|赴|返|自|於)美國|美國(?:境內|各地|全國|發生|當地|州|城市)|華盛頓特區|紐約|洛杉磯|芝加哥|波士頓|邁阿密|舊金山|西雅圖|亞特蘭大|\b(?:Washington, D\.?C\.?|New York|Los Angeles|Chicago|Boston|Miami|San Francisco|Seattle|Atlanta|Philadelphia|Houston|Dallas|Austin|Phoenix|San Diego|Denver|Portland|Detroit)\b/i],
  ["中國", 35.86, 104.19, /中國(?!航空|國際航空)|中國大陸|(?<!South )\bChina\b|北京|上海|深圳|廣州|成都|武漢|\b(?:Beijing|Shanghai|Shenzhen|Guangzhou|Chengdu|Wuhan)\b/i],
  ["日本", 36.2, 138.25, /日本|東京|大阪|京都|廣島|\b(?:Japan|Tokyo|Osaka|Kyoto|Hiroshima)\b/i],
  ["英國", 55.38, -3.4, /英國|倫敦|曼徹斯特|\b(?:United Kingdom|Britain|U\.?K\.?|NHS|London|Manchester|Cardiff|Edinburgh|Bristol)\b/i],
  ["法國", 46.2, 2.2, /法國|巴黎|里昂|\b(?:France|Paris|Lyon)\b/i],
  ["德國", 51.16, 10.45, /德國|柏林|慕尼黑|聯邦國防軍|\b(?:Germany|German|Bundeswehr|Berlin|Munich)\b/i],
  ["俄羅斯", 61.5, 105.3, /俄羅斯|莫斯科|聖彼得堡|\b(?:Russia|Moscow|St\.? Petersburg)\b/i],
  ["烏克蘭", 48.37, 31.16, /烏克蘭|基輔|哈爾科夫|敖德薩|\b(?:Ukraine|Kyiv|Kiev|Kharkiv|Odesa)\b/i],
  ["印度", 20.59, 78.96, /印度(?!航空)|新德里|孟買|班加羅爾|清奈|\b(?:India(?!\s+Airlines)|Indian|New Delhi|Mumbai|Bengaluru|Chennai)\b/i],
  ["加拿大", 56.13, -106.35, /加拿大|渥太華|多倫多|溫哥華|\b(?:Canada|Canadian|RCMP|Fort Providence|Ottawa|Toronto|Vancouver)\b/i],
  ["澳洲", -25.27, 133.77, /澳洲|澳大利亞|坎培拉|雪梨|悉尼|墨爾本|\b(?:Australia|Canberra|Sydney|Melbourne|Perth)\b/i],
  ["以色列", 31, 34.85, /以色列|特拉維夫|耶路撒冷|\b(?:Israel|Tel Aviv|Jerusalem)\b/i],
  ["巴勒斯坦", 31.95, 35.23, /巴勒斯坦|加薩|加沙|約旦河西岸|\b(?:Palestine|Gaza|West Bank)\b/i],
  ["敘利亞", 34.8, 38.99, /敘利亞|大馬士革|\b(?:Syria|Damascus)\b/i],
  ["委內瑞拉", 6.42, -66.59, /委內瑞拉|卡拉卡斯|\b(?:Venezuela|Caracas)\b/i],
  ["比利時", 50.5, 4.47, /比利時|布魯塞爾|\b(?:Belgium|Brussels|Antwerp)\b/i],
  ["黎巴嫩", 33.85, 35.86, /黎巴嫩|貝魯特|\b(?:Lebanon|Beirut|Lebanese)\b/i],
  ["伊朗", 32.42, 53.68, /伊朗|德黑蘭|\b(?:Iran|Tehran)\b/i],
  ["伊拉克", 33.22, 43.68, /伊拉克|巴格達|\b(?:Iraq|Iraqi|Baghdad)\b/i],
  ["科威特", 29.31, 47.48, /科威特|科威特市|\b(?:Kuwait|Kuwait City)\b/i],
  ["巴基斯坦", 30.37, 69.35, /巴基斯坦|伊斯蘭馬巴德|卡拉奇|\b(?:Pakistan|Islamabad|Karachi)\b/i],
  ["土耳其", 38.96, 35.24, /土耳其|安卡拉|伊斯坦堡|\b(?:Turkey|Ankara|Istanbul)\b/i],
  ["巴西", -14.23, -51.92, /巴西|巴西利亞|里約熱內盧|聖保羅|\b(?:Brazil|Bras[ií]lia|Rio de Janeiro|S[aã]o Paulo)\b/i],
  ["墨西哥", 23.63, -102.55, /墨西哥|墨西哥城|\b(?:Mexico|Mexico City)\b/i],
  ["南韓", 35.9, 127.76, /南韓|韓國|首爾|釜山|\b(?:South Korean|South Korea|Seoul|Busan)\b/i],
  ["北韓", 40.34, 127.51, /北韓|平壤|\b(?:North Korea|Pyongyang)\b/i],
  ["西班牙", 40.46, -3.74, /西班牙|馬德里|\b(?:Spain|Madrid)\b/i],
  ["義大利", 41.87, 12.56, /義大利|羅馬|米蘭|\b(?:Italy|Rome|Milan)\b/i],
  ["南非", -30.56, 22.94, /南非|約翰尼斯堡|開普敦|\b(?:South Africa|Johannesburg|Cape Town)\b/i],
  ["埃及", 26.82, 30.8, /埃及|開羅|\b(?:Egypt|Cairo)\b/i],
  ["沙烏地阿拉伯", 23.88, 45.08, /沙烏地阿拉伯|沙特阿拉伯|利雅德|\b(?:Saudi(?: Arabia)?|Riyadh)\b/i],
  ["阿拉伯聯合大公國", 23.42, 53.85, /阿聯酋|阿拉伯聯合大公國|杜拜|阿布達比|\b(?:United Arab Emirates|Dubai|Abu Dhabi)\b/i],
  ["荷蘭", 52.13, 5.29, /荷蘭|阿姆斯特丹|\b(?:Netherlands|Amsterdam)\b/i],
  ["瑞典", 60.12, 18.64, /瑞典|斯德哥爾摩|\b(?:Sweden|Stockholm)\b/i],
  ["挪威", 60.47, 8.47, /挪威|奧斯陸|\b(?:Norway|Oslo)\b/i],
  ["波蘭", 51.92, 19.15, /波蘭|華沙|\b(?:Poland|Warsaw)\b/i],
  ["阿根廷", -38.42, -63.62, /阿根廷|布宜諾斯艾利斯|\b(?:Argentina|Buenos Aires)\b/i],
  ["智利", -35.67, -71.54, /智利|聖地牙哥|\b(?:Chile|Santiago)\b/i],
  ["奈及利亞", 9.08, 8.67, /奈及利亞|尼日利亞|阿布加|拉各斯|\b(?:Nigeria|Abuja|Lagos)\b/i],
  ["尼日", 17.6, 8.08, /尼日(?:共和國)?|尼阿美|\b(?:Niger|Niamey)\b/i],
  ["約旦", 30.59, 36.24, /約旦|安曼|\b(?:in Jordan|from Jordan|Jordan's government|Jordan country|Amman)\b/i],
  ["查德", 15.45, 18.73, /查德|恩加美納|\b(?:Chadian|in Chad|from Chad|Chad government|N'Djamena)\b/i],
  ["喬治亞", 42.32, 43.35, /喬治亞國|喬治亞共和國|第比利斯|巴統|\b(?:Georgia,? (?:the )?country|Tbilisi|Batumi)\b/i],
  ["幾內亞比索", 11.8, -15.18, /幾內亞比索|\bGuinea-Bissau\b/i],
  ["巴布亞紐幾內亞", -6.31, 143.95, /巴布亞紐幾內亞|\bPapua New Guinea\b/i],
  ["赤道幾內亞", 1.65, 10.26, /赤道幾內亞|\bEquatorial Guinea\b/i],
  ["幾內亞", 9.94, -9.7, /幾內亞(?!比索|共和國|灣)|幾內亞共和國|科納克里|\b(?:Guinea|Republic of Guinea|Conakry)\b/i],
  ["克羅埃西亞", 45.1, 15.2, /克羅埃西亞|札格瑞布|\b(?:Croatia|Zagreb|Vukovar)\b/i],
  ["奧地利", 47.52, 14.55, /奧地利|維也納|\b(?:Austria|Vienna)\b/i],
  ["紐西蘭", -40.9, 174.89, /紐西蘭|威靈頓|奧克蘭|\b(?:New Zealand|New Zealander|Wellington|Auckland)\b/i],
  ["泰國", 15.87, 100.99, /泰國|曼谷|清邁|\b(?:Thailand|Thai(?=\s+(?:rivers?|villages?|border|province|officials?|government|court))|Bangkok|Chiang Mai)\b/i],
  ["越南", 14.06, 108.28, /越南|河內|胡志明市|\b(?:Vietnam|Hanoi|Ho Chi Minh City)\b/i],
  ["印尼", -0.79, 113.92, /印尼|印度尼西亞|雅加達|\b(?:Indonesia|Indonesian|Jakarta)\b/i],
  ["厄瓜多", -1.83, -78.18, /厄瓜多|基多|瓜亞基爾|\b(?:Ecuador|Quito|Guayaquil)\b/i],
  ["烏拉圭", -32.52, -55.77, /烏拉圭|蒙特維多|\b(?:Uruguay|Montevideo)\b/i],
  ["烏茲別克", 41.38, 64.59, /烏茲別克|塔什干|\b(?:Uzbekistan|Tashkent)\b/i],
  ["菲律賓", 12.88, 121.77, /菲律賓|馬尼拉|宿霧|\b(?:Philippines|Manila|Cebu)\b/i],
  ["莫三比克", -18.67, 35.53, /莫三比克|莫桑比克|馬普托|\b(?:Mozambique|Maputo)\b/i],
  ["丹麥", 56.26, 9.5, /丹麥|哥本哈根|\b(?:Denmark|Copenhagen)\b/i],
  ["瑞士", 46.82, 8.23, /瑞士|蘇黎世|日內瓦|\b(?:Switzerland|Zurich|Geneva)\b/i],
  ["芬蘭", 61.92, 25.75, /芬蘭|赫爾辛基|\b(?:Finland|Helsinki)\b/i],
  ["愛爾蘭", 53.14, -7.69, /愛爾蘭|都柏林|\b(?:Ireland|Dublin)\b/i],
  ["希臘", 39.07, 21.82, /希臘|雅典|\b(?:Greece|Athens)\b/i],
  ["葡萄牙", 39.4, -8.22, /葡萄牙|里斯本|\b(?:Portugal|Lisbon)\b/i],
  ["捷克", 49.82, 15.47, /捷克|布拉格|\b(?:Czechia|Czech Republic|Prague)\b/i],
  ["羅馬尼亞", 45.94, 24.97, /羅馬尼亞|布加勒斯特|\b(?:Romania|Bucharest)\b/i],
  ["匈牙利", 47.16, 19.5, /匈牙利|布達佩斯|\b(?:Hungary|Budapest)\b/i],
  ["馬來西亞", 4.21, 101.98, /馬來西亞|吉隆坡|\b(?:Malaysia|Kuala Lumpur)\b/i],
  ["新加坡", 1.35, 103.82, /新加坡|\bSingapore\b/i],
  ["孟加拉", 23.68, 90.36, /孟加拉(?:國)?|達卡|\b(?:Bangladesh|Dhaka)\b/i],
  ["迦納", 7.95, -1.02, /迦納|阿克拉|\b(?:Ghana|Accra)\b/i],
  ["衣索比亞", 9.15, 40.49, /衣索比亞|亞的斯亞貝巴|\b(?:Ethiopia|Addis Ababa)\b/i],
  ["肯亞", -0.02, 37.91, /肯亞|奈洛比|\b(?:Kenya|Nairobi)\b/i],
  ["哥倫比亞", 4.57, -74.3, /哥倫比亞|波哥大|\b(?:Colombia|Bogota)\b/i],
  ["秘魯", -9.19, -75.02, /秘魯|利馬|\b(?:Peru|Lima)\b/i],
  ["也門", 15.55, 48.52, /葉門|也門|薩那|\b(?:Yemen|Sana'?a)\b/i],
  ["緬甸", 21.91, 95.96, /緬甸|仰光|奈比多|\b(?:Myanmar|Yangon|Naypyidaw)\b/i],
  ["塞內加爾", 14.5, -14.45, /塞內加爾|達卡爾|\b(?:Senegal|Dakar)\b/i],
];

function countryLocationIn(text, { uniqueOnly = false } = {}) {
  const raw = String(text || "");
  if (/\bOsaka Gas\b/i.test(raw) ||
      /\bin\s+the\s+US\s+and\s+Europe\b/i.test(raw) ||
      /\b(?:six|6)\s+(?:countries|カ国)\b/i.test(raw) ||
      /\b(?:watch|stream|broadcast).{0,35}\bvs\b/i.test(raw) ||
      /\bNew Zealand vs India\b/i.test(raw) ||
      /\bglobally\b/i.test(raw) && /\b(?:recall|recalls|affected|impact)\b/i.test(raw) ||
      /\b(?:main topic|topic) at .*meeting\b/i.test(raw) ||
      /\b(?:US|U\.S\.) chip restrictions\b/i.test(raw) ||
      /\bNvidia\b.{0,70}\b(?:stock|shares?|risks?)\b/i.test(raw) ||
      /\bRussia.{0,70}\bmunitions?\b.{0,80}\bUkraine\b/i.test(raw) ||
      /\bweighs?\b.{0,50}\bstrikes?\s+on\s+Iran\b/i.test(raw) ||
      /\bNorth Korea[- ]Linked\b/i.test(raw) ||
      /\b(?:worldwide|global(?:ly)?|across far western North America)\b/i.test(raw) ||
      /\b(?:Foreign Policy|AI (?:export|chip|policy)|China[-–]US|US[-–]China|America and China|US President).{0,100}\b(?:China|US|U\.S\.)\b/i.test(raw) ||
      /\b(?:Investec|FTSE 100|Sony|GTA VI|Ship Recycling Markets|Ohio State University|USA Rare Earth|AMD Japan|CNA Now|from anywhere|Washington (?:Accords|peace process))\b/i.test(raw) ||
      /\b(?:military|war|strike|attack|battle).{0,100}\b(?:Iran|Ukraine|Russia|China|Bahrain|Kuwait)\b/i.test(raw) &&
        /\b(?:Iran|Ukraine|Russia|China|Bahrain|Kuwait)\b.{0,100}\b(?:military|war|strike|attack|battle)\b/i.test(raw)) return null;
  const source = String(text || "").replace(/China Airlines|China Eastern|China Southern|China Merchants|Air India|Air China|Osaka Gas|Vienna Insurance Group/gi, " ");
  const matches = [];
  for (const [country, lat, lng, re] of COUNTRY_LOCATIONS) {
    const global = new RegExp(re.source, `${re.flags}g`);
    for (const match of source.matchAll(global)) {
      if (country === "美國" && match[0] === "us") continue;
      if (country === "美國" && /^America$/i.test(match[0]) && /\bLatin\s+$/i.test(source.slice(Math.max(0, match.index - 12), match.index))) continue;
      if (country === "美國" && /^America$/i.test(match[0]) && /\bNorth\s+$/i.test(source.slice(Math.max(0, match.index - 12), match.index))) continue;
      if (country === "美國" && /^USA$/i.test(match[0]) && /^\s+Rare Earth\b/i.test(source.slice(match.index + match[0].length))) continue;
      if (country === "美國" && /^\s*-listed\b/i.test(source.slice(match.index + match[0].length))) continue;
      // U.K.-built、Japan-made、China-backed 說的是製造或出資國，不是事件地點（-based 是公司所在地，照常定位）。
      if (/^\.?-(?:built|made|backed|born|funded|designed)\b/i.test(source.slice(match.index + match[0].length))) continue;
      if (country === "美國" && /\bTrump administration\b/i.test(source) && /\bUS firms?\b/i.test(source)) {
        matches.push({ country, lat, lng, index: match.index, length: match[0].length });
        continue;
      }
      if (country === "美國" && /^\s*(?:envoys?|officials?|firms?|companies|forces?|military|troops|strikes?|strike|aid|tech giant|market leader|market-leading)\b/i.test(source.slice(match.index + match[0].length))) continue;
      if (country === "美國" && /^\s*\$/.test(source.slice(match.index + match[0].length))) continue;
      if (country === "美國" && /\bUS\s+(?:chip )?(?:restrictions?|policy|sanctions?)\b/i.test(source) && !/\bTrump administration\b/i.test(source)) continue;
      if (country === "美國" && /\bUS(?:\s|-)(?:market leader|tech giant|listed)\b/i.test(source)) continue;
      if (country === "中國" && /\bChinese\b/i.test(match[0]) && !/\bChinese\b.{0,55}\b(?:company|platform|business)\b/i.test(source)) continue;
      if (country === "印度" && /^Indian$/i.test(match[0])) continue;
      if (country === "德國" && /^German$/i.test(match[0]) && /^\s+(?:lender|company|biotech|firm|business)\b/i.test(source.slice(match.index + match[0].length))) continue;
      if (country === "日本" && /\b(?:AMD Japan|Sony Japan)\b/i.test(source)) continue;
      if (country === "美國" && /\b(?:Ohio State University|Washington Accords|Washington peace process)\b/i.test(source)) continue;
      if (country === "義大利" && /\bfrom\s+Italy\b/i.test(source)) continue;
      if (country === "烏克蘭" && /^\s+war\b/i.test(source.slice(match.index + match[0].length))) continue;
      if (country === "北韓" && /^[- ]Linked\b/i.test(source.slice(match.index + match[0].length))) continue;
      if (country === "土耳其" && /\b(?:roast(?:ed)?|sandwich|dinner|recipe|turkey breast|turkey meat|Thanksgiving|gravy|stuffing|leftovers?)\b/i.test(source)) continue;
      // 小寫 turkey 是火雞；國名寫成 Turkey／Türkiye。
      if (country === "土耳其" && match[0] === "turkey") continue;
      if (country === "喬治亞" && /\b(?:Georgia,?\s*(?:USA|US)|state of Georgia|Atlanta)\b/i.test(source)) continue;
      if (country === "英國" && /^\s+Business School\b/i.test(source.slice(match.index + match[0].length))) continue;
      if (country === "伊朗" && /\bfrom the\s*$/i.test(source.slice(Math.max(0, match.index - 12), match.index)) && /^\s+War\b/i.test(source.slice(match.index + match[0].length))) continue;
      if (country === "烏克蘭" && /^\s+over\b/i.test(source.slice(match.index + match[0].length))) continue;
      if (country === "烏克蘭" && /\bfuture of\s*$/i.test(source.slice(Math.max(0, match.index - 14), match.index))) continue;
      if (/^from\s+$/i.test(source.slice(Math.max(0, match.index - 8), match.index))) continue;
      // 公司、媒體、賽事名稱裡的地名（Wellington IT、Bristol-Myers Squibb、FRANCE 24、Sydney Marathon）不是事件地點。
      const following = source.slice(match.index + match[0].length);
      if (/^\s+(?:IT|Infrastructure|Partners|Holdings|Airlines|Airways|Insurance|Securities|Investments|24|Marathon|Open|Grand Prix|Masters)\b/.test(following) ||
        /^-[A-Z][a-z]+\s+[A-Z]/.test(following)) continue;
      matches.push({ country, lat, lng, index: match.index, length: match[0].length });
    }
  }
  matches.sort((a, b) => a.index - b.index || b.length - a.length);
  // 兩國用連字號串在一起（China–India、US-China）是航線或雙邊議題，不是單一事件地點。
  for (let i = 1; i < matches.length; i++) {
    const [a, b] = [matches[i - 1], matches[i]];
    if (a.country !== b.country && /^\s*[-–—]\s*$/.test(source.slice(a.index + a.length, b.index))) return null;
  }
  // 節目或彙整標題（Europe Tonight:、Morning Briefing:、newsletter）涵蓋多則新聞，不定位。
  if (/^[^:：]{0,40}\b(?:Tonight|Morning|Briefing|Newsletter|Digest|Roundup)\s*[:：]/i.test(source)) return null;
  for (const match of source.matchAll(/\bChinese\b/gi)) {
    if (!/\bChinese\b.{0,55}\b(?:company|platform|business)\b/i.test(source)) continue;
    const [country, lat, lng] = COUNTRY_LOCATIONS.find(([name]) => name === "中國");
    matches.push({ country, lat, lng, index: match.index, length: match[0].length });
  }
  const explicit = matches.filter((match) => {
    const before = source.slice(Math.max(0, match.index - 24), match.index);
    return /\b(?:in|at|near|within|off)\s+(?:the\s+)?(?:central|southern|northern|eastern|western|northwestern|southwestern)\s+$/i.test(before) ||
      /\b(?:in|at|near|within|off)\s+(?:the\s+)?$/i.test(before) ||
      /\bin\s+\w+\s+and\s+$/i.test(before) ||
      /(?:在|赴|回|於|位於|來自|前往|抵達|發生於)\s*$/.test(before);
  });
  if (new Set(explicit.map((match) => match.country)).size > 1) return null;
  if (uniqueOnly && explicit.length === 0 && new Set(matches.map((match) => match.country)).size > 1) return null;
  if (explicit.length) return { region: explicit[0].country, lat: explicit[0].lat, lng: explicit[0].lng, explicit: true };
  if (matches[0]?.index === 0 && /^(?:Paris|New York|London|Tokyo|Berlin|Moscow|Beirut|Dublin|Miami)$/i.test(source.slice(0, matches[0].length))) {
    return { region: matches[0].country, lat: matches[0].lat, lng: matches[0].lng, explicit: true };
  }
  if (/\bin\s+the\s+US\s+and\s+Europe\b/i.test(source)) return null;
  if (/\b(?:six|6)\s+(?:countries|カ国)\b/i.test(source)) return null;
  if (/\bglobally\b/i.test(source) && /\b(?:recall|recalls|affected|impact)\b/i.test(source)) return null;
  if (/\b(?:main topic|topic) at .*meeting\b/i.test(source)) return null;
  if (/\bnuclear Indonesia\b/i.test(source)) {
    const [country, lat, lng] = COUNTRY_LOCATIONS.find(([name]) => name === "印尼");
    return { region: country, lat, lng };
  }
  const match = matches[0];
  return match ? { region: match.country, lat: match.lat, lng: match.lng } : null;
}

// 產品或服務的排除地區（excludes US and UK markets、not available in Japan）不是事件地點；只認這種適用範圍片語。
const PLACE_TOKEN = String.raw`(?:the\s+)?[A-Z][\w.]*(?:\s+[A-Z][\w.]*)?`;
const EXCLUDED_PLACE_RE = new RegExp(
  String.raw`\b(?:excludes?|excluding|except(?:\s+for)?)\s+${PLACE_TOKEN}(?:\s*(?:,|and|&|or)\s*${PLACE_TOKEN})*\s+(?:markets?|users?|customers|residents|regions?)\b` +
  String.raw`|\b(?:not\s+(?:available|sold|offered)|unavailable)\s+in\s+${PLACE_TOKEN}(?:\s*(?:,|and|&|or)\s*${PLACE_TOKEN})*`,
  "g",
);
// 虛構作品裡的地名（a fictionalised US city、a fictional Florida）：只去掉緊接在 fictional 後面的地名。
const FICTIONAL_PLACE_RE = new RegExp(String.raw`\bfictional(?:i[sz]ed)?\s+(?:version\s+of\s+)?${PLACE_TOKEN}`, "gi");
// 只認台灣政府機關：英文 Taiwan、台灣企業常出現在發生於外國的新聞（台積電日本廠），不能當台灣脈絡。
const TAIWAN_AGENCY_RE = /行政院|立法院|(?<!生態)環境部|數位部|國科會|衛福部|農業部/;
// 在台灣舉辦的活動（在台北 IMCT 論壇分享）引述外國講者時，也不定位到講者的國家。
const TAIWAN_VENUE_RE = /(?:在|於)(?:台北|臺北|新北|桃園|台中|臺中|台南|臺南|高雄)(?!總部|總公司|辦公室)|\bin\s+(?:Taipei|Kaohsiung|Taichung)\b/;

function countryLocationFromItem(title, summary) {
  const clean = (text) => String(text || "").replace(EXCLUDED_PLACE_RE, " ").replace(FICTIONAL_PLACE_RE, " ");
  title = clean(title);
  summary = clean(summary);
  const location = countryLocationFromCleanItem(title, summary);
  // 台灣機關主辦的活動常引述外國學者：國家只出現在摘要時不定位到外國。
  if (location && !location.explicit && (TAIWAN_AGENCY_RE.test(`${title} ${summary}`) || TAIWAN_VENUE_RE.test(`${title} ${summary}`)) && !countryLocationIn(title)) return null;
  return location;
}

function countryLocationFromCleanItem(title, summary) {
  const combined = [title, summary].filter(Boolean).join(" ");
  if (/\b(?:Nvidia\b.{0,70}\b(?:stock|shares?|risks?)|globally\b.{0,60}\b(?:recall|recalls|affected|impact))\b/i.test(combined) ||
      /\b(?:US|U\.S\.) chip restrictions\b/i.test(combined) ||
      /\bin\s+the\s+US\s+and\s+Europe\b/i.test(combined) ||
      /\b(?:six|6)\s+(?:countries|カ国)\b/i.test(combined) ||
      /\b(?:main topic|topic) at .*meeting\b/i.test(combined) ||
      /\bRussia.{0,70}\bmunitions?\b.{0,80}\bUkraine\b/i.test(combined) ||
      /\b(?:worldwide|across the region|from anywhere)\b/i.test(combined) ||
      /\b(?:China[-–]US|US[-–]China|America and China|Trump.{0,40}(?:Xi|Putin))\b/i.test(combined) ||
      /\b(?:Japan|Indonesia|Kuwait|Bahrain).{0,70}\b(?:six|6)\s*(?:countries|カ国)\b/i.test(combined)) return null;
  const titleLocation = countryLocationIn(title);
  if (titleLocation?.explicit) return titleLocation;
  const summaryLocation = countryLocationIn(summary, { uniqueOnly: true });
  return summaryLocation?.explicit ? summaryLocation : titleLocation || summaryLocation;
}

// 沿用的國際輕量事件依現行規則重算分類、風險與地點（規則更新後不必等舊事件過期）。
export function refreshBulkInternationalEvent(event) {
  if (event?.scope !== "international" || event?.source?.normalizationMethod !== "bulk" ||
      event?.source?.datasetId !== "international-news" || event.curated) return event;
  const hint = event.categoryBasis?.startsWith("hint:") ? event.categoryBasis.slice(5) : undefined;
  const [mapped] = mapBulkInternationalNews([{
    title: event.title, description: event.summary, link: event.source?.recordRef,
    source: event.source?.feedLabel || event.source?.name, hint, pubDate: event.timestamp,
  }]);
  if (!mapped) return event;
  // 舊事件的風險與地點是用完整原文判的，這裡只剩 200 字摘要：風險不重算；摘要找不到地點時保留舊地點，避免每輪來回跳動。
  const location = mapped.lat != null
    ? { region: mapped.region, lat: mapped.lat, lng: mapped.lng, locationPrecision: mapped.locationPrecision, locationNote: mapped.locationNote }
    : {};
  return { ...event, category: mapped.category, categoryBasis: mapped.categoryBasis, ...location };
}

// 國際 RSS 的長尾事件走確定性輕量收錄；LLM 只精修較小候選池。
// id 與 normalizeInternational 相同，讓精修事件可直接取代 bulk 版本。
export function mapBulkInternationalNews(items, { fetchedAt, excludeIds = new Set() } = {}) {
  const seen = new Set();
  const events = [];
  for (const it of items || []) {
    const title = cleanTitle(it.title);
    const titleId = titleKey(title);
    const officialPolice = it.official === true && ["治安", "反詐", "協尋"].includes(it.hint);
    const dedupeKey = officialPolice ? `${titleId}|official-police|${it.source || ""}` : titleId;
    if (!titleId || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const id = eventIdFor("international", it.link) || `intl-${hash(`${it.source || "international"}:${title}`)}`;
    if (excludeIds.has(id)) continue;
    const rawSummary = String(it.description || title).replace(/\s+/g, " ").trim().slice(0, 200) || title;
    const location = countryLocationFromItem(title, rawSummary);
    const feedName = String(it.source || "");
    const feed = INTERNATIONAL_FEED_BY_LABEL.get(feedName);
    const hint = feed?.hint || it.hint;
    const hintedCategory = INTERNATIONAL_HINT_TO_CATEGORY[hint];
    const evidence = title.replace(/\b(?:Is|Are|Was|Were)\b[^?!.]{0,100}\b(?:Ponzi scheme|scam|fraud)\b[^?!.]{0,4}\?\s*No\b/gi, " ");
    const productFilteredEvidence = evidence.replace(/\bFire TV(?: Stick)?\b/gi, " ");
    const disasterEvidence = productFilteredEvidence.replace(
      /\bBlizzard\b/g,
      /\b(?:Microsoft|Adobe|Windows|PC|game|apps?)\b/i.test(evidence) ? " " : "Blizzard",
    );
    const rawEvidenceCategory = INTERNATIONAL_CATEGORY_EVIDENCE.find(([re, category]) =>
      re.test(category === "災害" ? disasterEvidence : evidence))?.[1];
    const scienceStudy = rawEvidenceCategory === "災害" && SCIENCE_STUDY_RE.test(title) &&
      !CLEAR_HEALTH_EVENT_RE.test(title);
    const evidenceCategory = scienceStudy ? undefined : rawEvidenceCategory;
    const trustedDisasterFeed = feed?.topic === "disaster" && hintedCategory === "災害";
    const category = scienceStudy ? hintedCategory || "其他"
      : evidenceCategory || (hintedCategory === "災害" && !trustedDisasterFeed ? "其他" : hintedCategory) || "其他";
    const detectedRisk = riskFromTitle(title, hint, rawSummary);
    const riskLevel = detectedRisk === "low" && evidenceCategory === category && ["地緣政治", "災害", "金融"].includes(category)
      ? "medium"
      : detectedRisk;
    const summary = trustedDisasterFeed && !evidenceCategory
      ? `${feedName === "USGS Quakes M4.5 week" ? "地震事件" : "災害警報"}：${rawSummary}`.slice(0, 200)
      : rawSummary;
    const source = deriveNewsProvenance(
      { ...it, datasetId: it.datasetId || "international-news", link: it.link || id },
      { fetchedAt },
    );
    events.push({
      id,
      title,
      region: location?.region || "國際",
      ...(location ? { lat: location.lat, lng: location.lng } : {}),
      timestamp: toIso(it.pubDate),
      category,
      categoryBasis: scienceStudy ? `hint:${hint || "其他"}`
        : evidenceCategory ? `evidence:${evidenceCategory}` : hintedCategory === "災害" && !trustedDisasterFeed ? "rule:no-disaster-evidence" : hint ? `hint:${hint}` : "default",
      scope: "international",
      riskLevel,
      summary,
      locationPrecision: location ? "country" : "unknown",
      locationNote: location ? "依標題或摘要中的國家／城市名稱規則推定，使用國家代表座標" : "RSS 未提供可驗證的事件座標",
      source: {
        ...source,
        normalizationMethod: "bulk",
        query: `${source.query}（輕量收錄）`,
      },
    });
  }
  return events;
}
