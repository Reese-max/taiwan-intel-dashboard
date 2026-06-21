// 全量新聞輕量收錄（免 LLM）：把抓回來的 RSS 原文全部轉成 IntelEvent。
// 分類用來源主題(hint)、風險用標題關鍵字、座標用標題短名縣市偵測。
// 與 LLM 精修層(nvidia.normalizeDomesticNews)互補：LLM 精修最近一批，其餘走這裡，達成「全量下載」。
import { COUNTY_CENTER } from "./coords.mjs";

// 標題正規化鍵（與 nvidia 相同）：去媒體尾綴 + 去非中英數 → 跨來源/跨查詢去重。
export function titleKey(title) {
  return String(title || "")
    .replace(/\s*[-|｜–—]\s*[^-|｜–—]{1,20}$/, "")
    .replace(/[^一-鿿A-Za-z0-9]/g, "")
    .toLowerCase()
    .slice(0, 40);
}

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

const HINT_TO_CAT = { 治安: "治安", 交通: "交通", 反詐: "反詐", 災防: "災防", 資安: "治安" };
// 先依標題關鍵字判類，無命中再回退來源主題(hint)，預設治安（來源本就警政取向）。
const CAT_RULES = [
  [/詐騙|詐欺|車手|假投資|人頭帳戶|釣魚|解除分期|盜刷|博弈|洗錢|假交友|假檢警/, "反詐"],
  [/車禍|酒駕|毒駕|肇事|肇逃|超速|闖紅燈|追撞|翻車|撞死|撞傷|國道|機車|貨車|騎士/, "交通"],
  [/火警|火災|氣爆|爆炸|地震|颱風|豪雨|水災|淹水|山難|溺|搜救|消防|坍|土石|救護|受困/, "災防"],
];
function categoryFromItem(title, hint) {
  const s = String(title || "");
  for (const [re, c] of CAT_RULES) if (re.test(s)) return c;
  return HINT_TO_CAT[hint] || "治安";
}

const HIGH = /命案|兇殺|凶殺|殺人|砍人|砍殺|砍傷|持刀|刺死|刺傷|分屍|棄屍|槍擊|開槍|中彈|性侵|擄人|勒贖|劫|致死|身亡|死亡|喪命|溺斃|縱火|爆炸|氣爆|滅門/;
const MED = /詐騙|詐欺|毒品|緝毒|販毒|竊|搶|強盜|酒駕|毒駕|肇逃|肇事|傷害|鬥毆|車禍|起訴|收押|羈押|逮捕|查獲|落網|火警|火災|墜|溺|走私|偷渡|賄|貪/;
function riskFromTitle(title) {
  const s = String(title || "");
  if (HIGH.test(s)) return "high";
  if (MED.test(s)) return "medium";
  return "low";
}

// 警政相關性關鍵字（標題＋摘要任一命中才收）。濾掉政府/綜合 feed 的非犯罪內容（政策、活動、排名、衛教…）。
const POLICE_RE = /詐|車手|毒品|緝毒|販毒|製毒|安非他命|海洛因|大麻|愷他命|竊|偷|扒|搶|強盜|劫|侵占|命案|兇殺|凶殺|殺人|砍|刺|鬥毆|毆|傷害|施暴|槍|彈藥|爆裂|爆炸|氣爆|性侵|性騷|猥褻|偷拍|性影像|妨害|家暴|虐|跟蹤|跟騷|騷擾|恐嚇|脅迫|擄|勒贖|綁架|賭|博弈|簽賭|娼|應召|嫖|幫派|黑道|圍事|角頭|走私|偷渡|人口販運|人蛇|洗錢|貪污|收賄|圖利|掏空|背信|內線|偽造|偽鈔|變造|假冒|冒用|盜刷|盜用|個資|駭客|勒索病毒|起訴|偵辦|偵查|搜索|約談|羈押|收押|交保|通緝|落網|到案|逮捕|查獲|破獲|查緝|查扣|移送|判刑|判決|定讞|求刑|犯|嫌|警方|員警|警察|刑事|刑警|檢方|檢警|地檢|調查局|海巡|移民署|消防|救護|搜救|溺|墜|罹難|傷亡|死傷|身亡|致死|喪命|奪命|縱火|火警|火災|肇事|肇逃|酒駕|毒駕|車禍|事故|失蹤|協尋|走失|失聯|襲警|拒檢|拒捕|臨檪|臨檢|攔查|路檢|掃蕩|掃黑|肅竊|取締|落水|中毒|外洩|不法|違法|非法|犯罪|刑案|治安|報案|110|165/;

export function isPoliceRelevant(title, description) {
  return POLICE_RE.test(String(title || "") + " " + String(description || ""));
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
    if (!isPoliceRelevant(it.title, it.description)) continue; // 濾掉非警政內容
    const k = titleKey(it.title);
    if (!k || seen.has(k) || excludeKeys.has(k)) continue;
    seen.add(k);
    const loc = detectCounty(it.title);
    events.push({
      id: `twnews-${hash(it.link || it.title)}`,
      title: cleanTitle(it.title),
      region: loc.region,
      lat: loc.lat,
      lng: loc.lng,
      timestamp: toIso(it.pubDate),
      category: categoryFromItem(it.title, it.hint),
      scope: "domestic",
      riskLevel: riskFromTitle(it.title),
      summary: (it.description || "").slice(0, 200),
      source: {
        name: it.source,
        type: "news-rss",
        datasetId: "tw-news",
        recordRef: it.link || k,
        url: it.link || "",
        fetchedAt,
        query: `RSS ${it.sourceUrl || ""}（全量收錄）`,
      },
    });
  }
  return events;
}
