// 司法院裁判書 bulk 抓取：以多罪名語意查詢撈大量真實刑案判決 → IntelEvent[]。
// 目的：提供高量、真實、警政相關的「每小時新進」資料源（每筆判決 jid 唯一，進 hourly ledger）。
// 法院代碼前兩碼 → 城市中心座標（衍生定位，供地球儀標點）。
import { McpClient } from "./mcp-client.mjs";
import { COUNTY_CENTER } from "./coords.mjs";

// 法院代碼前綴（jid 開頭 2 碼）→ 縣市（取 COUNTY_CENTER 座標）。
const COURT_PREFIX_CITY = {
  TP: "臺北市", SL: "臺北市", PC: "新北市", IL: "宜蘭縣", KL: "基隆市",
  TY: "桃園市", SC: "新竹市", ML: "苗栗縣", TC: "臺中市", CH: "彰化縣",
  NT: "南投縣", UL: "雲林縣", CY: "嘉義市", TN: "臺南市", KS: "高雄市",
  CT: "高雄市", PT: "屏東縣", TT: "臺東縣", HL: "花蓮縣", PH: "澎湖縣",
  KM: "金門縣", LC: "連江縣",
};

// 預設罪名查詢集（涵蓋常見刑案類型，輪替使用以撈出不同 jid）。
export const JUDICIAL_QUERIES = [
  "公共危險 酒後駕車", "竊盜 加重竊盜", "詐欺 假投資", "毒品 運輸販賣",
  "傷害 重傷害", "過失致死 車禍", "妨害性自主", "強盜 搶奪",
  "洗錢防制", "殺人", "槍砲彈藥刀械", "妨害自由 恐嚇",
  "賭博 電子遊戲場", "走私 私運", "妨害公務", "偽造文書",
  "家庭暴力 違反保護令", "妨害名譽", "贓物", "侵占背信",
  "organized crime 組織犯罪", "兒少性剝削", "人口販運", "貪污瀆職",
];

function courtCity(jid) {
  const pre = (jid || "").slice(0, 2).toUpperCase();
  const city = COURT_PREFIX_CITY[pre];
  if (city && COUNTY_CENTER[city]) {
    const [lat, lng] = COUNTY_CENTER[city];
    return { city, lat, lng };
  }
  return { city: "全國", lat: null, lng: null };
}

// jdate "20260331" → ISO+08:00。
function jdateToIso(d) {
  const s = String(d || "");
  if (s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00+08:00`;
}

function riskByCase(c) {
  const title = c.jtitle || "";
  const sentence = c.sentence || "";
  if (/殺人|致死|無期徒刑|性自主|槍砲|強盜|擄人/.test(title) || /無期徒刑|死刑/.test(sentence)) return "critical";
  if (c.outcome_type === "有罪" || /有期徒刑/.test(sentence)) return "warning";
  return "info";
}

// search_judicial 回應集合 → IntelEvent[]（依 jid 去重）。
export function mapJudicialEvents({ cases, fetchedAt }) {
  const seen = new Set();
  const events = [];
  for (const c of cases || []) {
    const jid = c.jid;
    if (!jid || seen.has(jid)) continue;
    seen.add(jid);
    const loc = courtCity(jid);
    const parts = [c.issue, c.sentence && `刑度：${c.sentence}`, c.key_reasoning]
      .filter(Boolean)
      .join("；");
    events.push({
      id: `judicial-${jid}`,
      title: `${c.jtitle || "裁判書"}（${loc.city}）`,
      region: loc.city,
      lat: loc.lat,
      lng: loc.lng,
      timestamp: jdateToIso(c.jdate) || fetchedAt,
      category: "司法判決",
      scope: "domestic",
      riskLevel: riskByCase(c),
      summary: (parts || `${c.jtitle || "刑事裁判"}（${c.court_code || ""}）`).slice(0, 300),
      source: {
        name: "司法院 裁判書開放資料",
        type: "judicial",
        datasetId: "judicial",
        recordRef: jid,
        url: c.jpdf || "",
        fetchedAt,
        query: `search_judicial 多罪名語意檢索`,
      },
    });
  }
  return events;
}

// 輪替挑選本次要查的罪名（依 runSeed 位移，讓不同小時撈到不同案件）。
function pickQueries(queries, count, runSeed) {
  const n = queries.length;
  const start = Math.abs(runSeed) % n;
  const out = [];
  for (let i = 0; i < Math.min(count, n); i++) out.push(queries[(start + i) % n]);
  return out;
}

export async function fetchJudicialBulk({ url, token, perQuery = 30, queryCount = 12, runSeed = 0 }) {
  if (!url || !token) return [];
  const fetchedAt = new Date().toISOString();
  const client = new McpClient(url, token);
  await client.init();
  const queries = pickQueries(JUDICIAL_QUERIES, queryCount, runSeed);
  const all = [];
  for (const q of queries) {
    try {
      const raw = await client.callTool("search_judicial", { query: q, limit: perQuery });
      const parsed = JSON.parse(raw);
      for (const h of parsed.hits || []) all.push(h);
    } catch {
      // 單一查詢失敗不影響其餘
    }
  }
  return mapJudicialEvents({ cases: all, fetchedAt });
}
