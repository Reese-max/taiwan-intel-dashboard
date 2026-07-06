// 全量新聞輕量收錄（免 LLM）：把抓回來的 RSS 原文全部轉成 IntelEvent。
// 分類用來源主題(hint)、風險用標題關鍵字、座標用標題短名縣市偵測。
// 與 LLM 精修層(nvidia.normalizeDomesticNews)互補：LLM 精修最近一批，其餘走這裡，達成「全量下載」。
import { COUNTY_CENTER } from "./coords.mjs";
import { deriveNewsProvenance } from "./fetch-rss.mjs";
import { titleKey } from "./title-key.mjs";
export { titleKey } from "./title-key.mjs";

export function cleanTitle(title) {
  return String(title || "").replace(/\s*[-|｜–—]\s*[^-|｜–—]{1,20}$/, "").trim() || String(title || "").trim();
}

// 標題短名 → 縣市座標（順序：特定者優先，避免「新北」被「北市」吃掉）。
const COUNTY_MATCH = [
  [/新北/, "新北市"], [/台北|臺北|北市/, "臺北市"], [/桃園/, "桃園市"],
  [/台中|臺中|中市/, "臺中市"], [/台南|臺南|南市/, "臺南市"], [/高雄|高市/, "高雄市"],
  [/基隆/, "基隆市"], [/竹縣/, "新竹縣"], [/新竹|竹市/, "新竹市"], [/苗栗/, "苗栗縣"],
  [/彰化/, "彰化縣"], [/南投/, "南投縣"], [/雲林/, "雲林縣"],
  [/嘉縣/, "嘉義縣"], [/嘉義|嘉市/, "嘉義市"], [/屏東/, "屏東縣"], [/宜蘭/, "宜蘭縣"],
  [/花蓮/, "花蓮縣"], [/台東|臺東/, "臺東縣"], [/澎湖/, "澎湖縣"], [/金門/, "金門縣"],
  [/連江|馬祖/, "連江縣"],
];

function detectCounty(text) {
  const s = String(text || "");
  for (const [re, key] of COUNTY_MATCH) {
    if (re.test(s)) {
      const [lat, lng] = COUNTY_CENTER[key];
      return { region: key, lat, lng };
    }
  }
  return { region: "全國", lat: null, lng: null };
}

const HINT_TO_CAT = { 治安: "治安", 交通: "交通", 反詐: "反詐", 災防: "災防", 資安: "資安", 食安: "食安", 衛生: "衛生", 環境: "環境" };
// 先依標題關鍵字判類，無命中再回退來源主題(hint)，預設治安（來源本就警政取向）。
const CAT_RULES = [
  [/詐騙|詐欺|車手|假投資|人頭帳戶|釣魚|解除分期|盜刷|博弈|洗錢|假交友|假檢警/, "反詐"],
  [/車禍|酒駕|毒駕|肇事|肇逃|超速|闖紅燈|追撞|翻車|撞死|撞傷|國道|機車|貨車|騎士/, "交通"],
  [/火警|火災|氣爆|爆炸|地震|颱風|豪雨|水災|淹水|山難|溺|搜救|消防|坍|土石|救護|受困/, "災防"],
];
export function categoryFromItem(title, hint) {
  const s = String(title || "");
  for (const [re, c] of CAT_RULES) {
    if (re.test(s)) return { category: c, basis: `rule:${c}` };
  }
  if (HINT_TO_CAT[hint]) return { category: HINT_TO_CAT[hint], basis: `hint:${hint}` };
  return { category: "治安", basis: "default" };
}

const HIGH = /命案|兇殺|凶殺|殺人|殺害|砍人|砍殺|砍傷|持刀|刺死|刺傷|分屍|棄屍|槍擊|開槍|中彈|性侵|擄人|勒贖|劫|致死|身亡|死亡|喪命|溺斃|縱火|爆炸|氣爆|滅門/;
const MED = /詐騙|詐欺|毒品|緝毒|販毒|竊|搶|強盜|酒駕|毒駕|肇逃|肇事|傷害|鬥毆|車禍|起訴|收押|羈押|逮捕|查獲|落網|火警|火災|墜|溺|走私|偷渡|賄|貪/;
const HIGH_EN = /\b(murder|homicide|killed|dead|death|fatal|shooting|stabbing|explosion|kidnap\w*|rape|sexual assault|arson)\b/i;
const MED_EN = /\b(fraud|scam|drug|narcotic|arrest\w*|theft|robbery|burglar\w*|smuggl\w*|drunk driving|DUI|crash|fire|indict\w*|prosecut\w*|detain\w*|assault)\b/i;
const CRITICAL =
  /隨機殺人|無差別(?:殺人|砍人)|(?:氣爆|爆炸).*(?:[0-9０-９一二三四五六七八九十百兩]+\s*(?:死|亡)|死|亡|重傷)|(?:[0-9０-９]{2,}|[0-9０-９]{1,3}(?:[,，][0-9０-９]{3})+|[一二三四五六七八九兩幾數]*[十百千萬][一二三四五六七八九兩幾數十百千萬]*)\s*[餘多]?\s*(?:人|名)?\s*(?:死|亡|罹難|喪生|喪命|身亡)|(?:大量|重大|多人)(?:傷亡|死傷|死亡)|多人(?:罹難|喪命|身亡)|滅門|挾持.*人質|大規模.*(?:傷亡|死傷|死亡|爆炸|攻擊|砍人|殺人)/;
const NO_CRITICAL_CASUALTY = /(?:幸)?無(?:人)?傷亡|未(?:造成|傳出)?傷亡|無人(?:受傷|死亡|傷亡)/;
const HIGH_FLOOR = /命案|兇殺|凶殺|殺人|殺害|不治|罹難|奪命|斃命|喪生|喪命|遇害|遇難|悶死|枉死|猝死|暴斃|刺殺|中刀|槍手|持槍|中槍|中彈|[1-9１-９]\s*(?:人|名)?\s*(?:死(?!角)|亡|罹難|喪生|喪命|身亡)|槍擊|開槍|槍械|彈藥|持刀.*(?:致死|死亡|身亡|喪命)|毒品.*(?:重案|大案|工廠|集團|走私|販運|製造)|緝毒.*(?:重案|大案)|販毒|製毒|海洛因|安非他命|愷他命/;
const ROUTINE = /說明會|宣導|記者會|頒獎/;
const CYBER_ROUTINE =
  /宣導|講座|說明會|研習|論壇|課程|競賽|駭客松|體驗營|防護(?:週|月|宣導)|資安月|徵才|開箱|評測|上市(?!櫃|上櫃|公司|企業)|個資保護(?:法)?|資安意識|防詐宣導/;
const CYBER_HIGH =
  /勒索(?:病毒|軟體|攻擊)?|遭勒索|網攻|網路攻擊|(?:遭|被)?駭(?:客)?(?:入侵|攻擊|竊)|入侵.*(?:系統|主機|伺服器)|癱瘓.*(?:系統|服務|網路)|殭屍網路|供應鏈攻擊/;
const CYBER_DATA_BREACH =
  /個資外洩|資料外洩|個(?:人)?資(?:料)?.{0,6}(?:外洩|遭竊)|外洩.{0,6}個資|資料庫外洩|帳號(?:密碼)?外洩/;
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

export function riskFromTitle(title, hint) {
  const s = String(title || "");
  if (CRITICAL.test(s) && !NO_CRITICAL_CASUALTY.test(s)) return "critical";
  if (HIGH_FLOOR.test(s)) return "high";
  const isRoutine = ROUTINE.test(s);
  const isCyberRoutine = isRoutine || CYBER_ROUTINE.test(s);
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
const POLICE_RE = /詐|車手|毒品|緝毒|販毒|製毒|安非他命|海洛因|大麻|愷他命|竊|偷|扒|搶|強盜|劫|侵占|命案|兇殺|凶殺|殺人|砍|刺|鬥毆|毆|傷害|施暴|槍|彈藥|爆裂|爆炸|氣爆|性侵|性騷|猥褻|偷拍|性影像|妨害|家暴|虐|跟蹤|跟騷|騷擾|恐嚇|脅迫|擄|勒贖|綁架|賭|博弈|簽賭|假球|娼|應召|嫖|幫派|黑道|圍事|角頭|走私|偷渡|人口販運|人蛇|洗錢|貪污|收賄|圖利|掏空|背信|內線|偽造|偽鈔|變造|假冒|冒用|盜刷|盜用|個資|駭客|勒索病毒|起訴|偵辦|偵查|搜索|約談|羈押|收押|交保|通緝|落網|到案|逮捕|查獲|破獲|查緝|查扣|移送|判刑|判決|定讞|求刑|犯|嫌|警方|員警|警察|刑事|刑警|檢方|檢警|地檢|調查局|海巡|移民署|消防|救護|搜救|溺|墜|罹難|傷亡|死傷|身亡|致死|喪命|奪命|縱火|火警|火災|肇事|肇逃|酒駕|毒駕|車禍|事故|失蹤|協尋|走失|失聯|襲警|拒檢|拒捕|臨檪|臨檢|攔查|路檢|掃蕩|掃黑|肅竊|取締|落水|中毒|外洩|不法|違法|非法|犯罪|刑案|治安|報案|110|165/;

const NON_EVENT_LANDING_RE = /查詢系統|管理資訊系統|資訊系統|資訊網站|全球資訊網|清冊|資料查詢/;
const SPECIFIC_NON_EVENT_TITLE_RE = /環保稽查處分管制系統/;
const EVENT_ACTION_RE = /駭客|(?:個資|資料)?外洩|攻擊|破獲|查獲|逮捕|落網|起訴|下架|回收|裁罰|偷排|食物中毒|群聚|確診|火警|車禍|命案|殺人|砍人|詐騙|盜用|盜刷|釣魚|冒用|毒品/;
const ENTERTAINMENT_RE = /劇透|劇情|懶人包|追劇|大結局|第\s*[0-9０-９]+(?:\s*[-–—~至到]\s*[0-9０-９]+)?\s*集|第\s*[一二三四五六七八九十百兩]+\s*集|分集劇情/;
// 弱娛樂訊號：受 EVENT_ACTION_RE 保護（盜版片名常是詐騙/盜帳號誘餌，不可無條件剔）
const WEAK_ENTERTAINMENT_RE = /線上看|預告片/;
const AIR_QUALITY_REFERENCE_RE = /(?:空氣品質指數|空氣品質).{0,12}(?:AQI|空氣污染)|\bAQI\b.{0,12}空氣污染/i;
const FOREIGN_PLACE_RE =
  /委內瑞拉|巴基斯坦|俄羅斯|烏克蘭|基輔|莫斯科|緬甸(?!女|籍)|奈及利亞|法國|德國|英國|美國|加拿大|南韓|韓國(?!瑜)|首爾|日本|東京|大阪|印度(?!籍|男|女|妻|法商|移工)|以色列|加薩|巴勒斯坦|敘利亞|大馬士革|黎巴嫩|泰國(?!籍|進口|龍眼|神秘|航空|空服|箱屍)|曼谷|菲律賓|馬尼拉|印尼|雅加達|(?<!橫)越南(?!籍|移工|女|妻|同鄉)|河內|馬來西亞|新加坡|墨西哥|巴西|阿根廷|義大利|西班牙|葡萄牙|荷蘭|比利時|瑞士|瑞典|挪威|波蘭|希臘|土耳其|埃及|沙烏地|阿聯|伊朗|伊拉克|阿富汗|蘇丹|肯亞|南非|澳洲|紐西蘭|烏干達|剛果|衣索比亞|阿爾及利亞|摩洛哥|波斯尼亞|赤道幾內亞|摩爾多瓦|祕魯|秘魯|孟買|象牙海岸|丹佛/;
const TAIWAN_MARKER_RE =
  /台灣|臺灣|中華民國|我國|本國|國內|國人|台商|臺商|僑(?:胞|民|界)|外交部|陸委會|僑委會|駐[^\s]{1,5}(?:代表處|辦事處|使館)|國防部|移民署|刑事局|警政署|內政部|國安局|調查局|檢調|食藥署|海巡署|海關|法務部|行政院|立法院|立院|立委|地檢署|台北|臺北|新北|桃園|台中|臺中|台南|臺南|高雄|基隆|新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|台東|臺東|澎湖|金門|馬祖|連江|林口|二林|中正|兩岸|台男|臺男|台女|臺女|台版|臺版|台廠|臺廠|全台|全臺|台海|臺海|來台|來臺|在台|在臺|赴台|赴臺|返台|返臺|入台|入臺|台日|臺日|台美|臺美|台德|臺德|駐美|駐日|駐外|移工|外籍|新住民|美籍|英籍|澳籍|印尼籍|印度籍|越南籍|緬甸籍|泰籍|港人|印尼語|越南語|泰語|華語|青雲|是方電訊|美超微|黃國昌|四叉貓|郭正亮|奧丁丁|東京著衣/;
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

export function isNonEventNoise(item) {
  const title = String(item?.title || "");
  const source = sourceText(item?.source);
  const text = `${title} ${source}`;
  if (ENTERTAINMENT_RE.test(title)) return true;
  if (SPECIFIC_NON_EVENT_TITLE_RE.test(title)) return true;
  if (EVENT_ACTION_RE.test(title)) return false;
  if (WEAK_ENTERTAINMENT_RE.test(title)) return true;
  if (NON_EVENT_LANDING_RE.test(title)) return true;
  if (/\bIQAir\b/i.test(text)) return true;
  if (AIR_QUALITY_REFERENCE_RE.test(title)) return true;
  return false;
}

const FOREIGN_EXEMPT_CATS = new Set(["資安", "反詐", "食安"]);
export function isForeignNonTaiwan(item) {
  // 反詐（緬甸/柬埔寨詐騙園區、跨境詐騙手法）、食安（外國食材進口）、資安（全球 CVE）對台灣皆高度相關，一律保留。
  if (FOREIGN_EXEMPT_CATS.has(item?.hint) || FOREIGN_EXEMPT_CATS.has(item?.category)) return false;
  const title = String(item?.title || "");
  const text = `${title} ${String(item?.description || "")} ${String(item?.summary || "")}`;
  if (CYBER_FOREIGN_EXEMPT_RE.test(text)) return false;
  // 只在「標題同時命中外國地名與天災/戰爭/大量傷亡語境」才視為純外國事件（高確定性，避免誤刪提及外國的台灣新聞）。
  if (!(FOREIGN_PLACE_RE.test(title) && FOREIGN_EVENT_CONTEXT_RE.test(title))) return false;
  // 全文任一台灣關聯標記 → 保留（如「台灣捐款委內瑞拉震災」「國人在日本罹難」）。
  return !TAIWAN_MARKER_RE.test(text.replace(TAIWAN_NEGATED_CONTEXT_RE, ""));
}

export function isPoliceRelevant(title, description) {
  const text = String(title || "") + " " + String(description || "");
  // 英文警政關鍵字（EN 來源靠此通過；POLICE_RE 為中文導向，對英文內容全 miss）。
  const POLICE_EN_RE =
    /\b(police|arrest\w*|fraud|scam|drug|narcotic|smuggl\w*|murder|homicide|kidnap\w*|robbery|theft|burglar\w*|assault|prosecut\w*|indict\w*|convict\w*|sentenc\w*|detain\w*|custody|wanted|gang|trafficking|launder\w*|bribe\w*|corruption|counterfeit|hack\w*|ransomware|phishing|crash|collision|drunk driving|DUI|blaze|explosion|rescue|drown\w*|manhunt|shooting|stabbing|crime|criminal|missing)\b/i;
  return POLICE_RE.test(text) || POLICE_EN_RE.test(text);
}

// 主題來源專用相關性關鍵字（hint 命中此表 → 以主題正則取代警政漏斗；未列者照舊走 POLICE_RE）。
// 來源漏斗診斷（docs/reports/2026-07-03）：食安/環保/衛生/科技來源過不了警政關鍵字，貢獻歸零。
// 災防漏斗＝災害預警詞 ∪ 警政漏斗（2026-07-06 低貢獻 feed 分診：GN 土石流坍方 35 筆全滅於警政漏斗；
// 純取代制實測誤殺車禍/大火/消防救援等真實事件，故取聯集保證原本可過者零損失）。
const DISASTER_ALERT_RE =
  /土石流|坍方|走山|邊坡|落石|災情|警戒|撤離|疏散|避難|收容|淹水|積水|溢堤|潰堤|洪水|豪雨|暴雨|颱風|地震|餘震|海嘯|野火|停電|斷電|停水|路斷|封路|災害|災損|崩塌|坍塌|倒塌|殉職|受困|山難|海難|迷途|工安|職災|意外/;
const TOPIC_RE = {
  食安: /黑心|食安|餿水油|病死豬|瘦肉精|農藥殘留|逾期|竄改|標示不實|下架|回收|查獲|違規|走私|摻偽|偽藥|禁藥|食物中毒/,
  衛生: /疫情|群聚|確診|疫苗|傳染|染疫|食物中毒|中毒|院內感染|防疫|隔離/,
  環境: /污染|廢水|偷排|裁罰|稽查|廢棄物|棄置|排放|空污|盜採|濫墾|噪音|毒物|外洩/,
  資安: /資安|駭客|個資|外洩|漏洞|勒索|釣魚|盜刷|木馬|殭屍網路|網攻|入侵/,
  災防: new RegExp(`${DISASTER_ALERT_RE.source}|${POLICE_RE.source}`),
};

export function isRelevantNewsItem(item) {
  if (isNonEventNoise(item)) return false;
  if (isForeignNonTaiwan(item)) return false;
  const topicRe = TOPIC_RE[item?.hint];
  if (topicRe) return topicRe.test(String(item?.title || "") + " " + String(item?.description || ""));
  return isPoliceRelevant(item?.title, item?.description);
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
    if (!k || seen.has(k) || excludeKeys.has(k)) continue;
    seen.add(k);
    const loc = detectCounty(it.title);
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
      riskLevel: riskFromTitle(it.title, it.hint),
      summary: (it.description || "").slice(0, 200),
      locationPrecision: loc.lat != null && loc.lng != null ? "city" : "unknown",
      locationNote: loc.lat != null && loc.lng != null ? "依新聞地區推論，非精準事發地址" : undefined,
      source: {
        ...source,
        query: `${source.query}（全量收錄）`,
      },
    });
  }
  return events;
}
