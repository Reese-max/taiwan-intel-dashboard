// LLM（OpenAI 相容端點）整合：摘要 + 新聞正規化。
//  - normalizeInternational：RSS 原文 → 統一 IntelEvent（中文摘要/分類/風險/座標估計）
//  - summarize：國內/國際事件 → 每日情勢摘要段落
// Provider 中性：優先讀 LLM_*，未設則 fallback 回 NVIDIA_*（向後相容）。
// 例如 MiniMax：LLM_BASE_URL=https://api.minimax.io/v1、LLM_MODEL=MiniMax-M2。
// 座標為 LLM 推估（非原始資料），呼叫端需在 provenance 誠實標註。

import { deriveNewsProvenance } from "./fetch-rss.mjs";
import { selectDiverseByCategory } from "./intl-accumulate.mjs";

const CATEGORIES = ["地緣政治", "災害", "資安", "金融", "其他"];
const RISKS = ["low", "medium", "high", "critical"];

// 設定指定送出的模型名稱（請求用）。fallback：LLM_MODEL → NVIDIA_MODEL → ""。
export const llmModel = () => process.env.LLM_MODEL || process.env.NVIDIA_MODEL || "";

// 最近一次 LLM 回應實際使用的模型（OpenAI 相容 API 會在回應帶 model 欄位）。
// provenance 用「真實回應模型」誠實標註，無則 fallback 設定值，避免錯標。
let lastRespondedModel = "";
export const respondedModel = () => lastRespondedModel || llmModel();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 雙端點 LLM profile（防護設定全部 env 可調）：
//  - primary：新聞正規化（大量、需可靠）→ 付費端點（LLM_*，預設 MiniMax）。
//  - summary：AI 摘要（少量、可容忍偶發失敗）→ 可選獨立端點（設 SUMMARY_*，如免費 NVIDIA）；
//    未設則 fallback 回 primary（向後相容、零行為改變）。
// 每 profile 各自獨立並發閘 / 逾時 / 重試（互不爭用槽位）。
function profileCfg(profile) {
  // 啟用 summary 端點的條件：設了 SUMMARY_API_KEY / SUMMARY_BASE_URL，或旗標 SUMMARY_LLM
  //（旗標模式複用既有 NVIDIA_* 金鑰/端點/模型，免另設重複 secret）。
  const summaryOn = process.env.SUMMARY_API_KEY || process.env.SUMMARY_BASE_URL || process.env.SUMMARY_LLM;
  if (profile === "summary" && summaryOn) {
    return {
      name: "summary",
      base: process.env.SUMMARY_BASE_URL || process.env.NVIDIA_BASE_URL || process.env.LLM_BASE_URL,
      key: process.env.SUMMARY_API_KEY || process.env.NVIDIA_API_KEY,
      model: process.env.SUMMARY_MODEL || process.env.NVIDIA_MODEL || "",
      maxConc: Math.max(1, Number(process.env.SUMMARY_MAX_CONCURRENCY) || 2),
      // 有 primary fallback 當安全網 → 摘要端點快速失敗即退回（重試掛死的免費層無意義）。
      timeout: Math.max(1000, Number(process.env.SUMMARY_TIMEOUT_MS) || 25000),
      retries: Math.max(0, Number(process.env.SUMMARY_MAX_RETRIES ?? 0)),
    };
  }
  // primary（也是 summary 未配置時的 fallback）
  return {
    name: "primary",
    base: process.env.LLM_BASE_URL || process.env.NVIDIA_BASE_URL,
    key: process.env.LLM_API_KEY || process.env.NVIDIA_API_KEY,
    model: llmModel(),
    maxConc: Math.max(1, Number(process.env.LLM_MAX_CONCURRENCY) || 4),
    timeout: Math.max(1000, Number(process.env.LLM_TIMEOUT_MS) || 90000),
    retries: Math.max(0, Number(process.env.LLM_MAX_RETRIES ?? 2)),
  };
}

// 每 profile 一個並發閘（信號量）。
function makeGate(max) {
  let active = 0;
  const queue = [];
  return {
    acquire: () =>
      new Promise((resolve) => {
        if (active < max) {
          active++;
          resolve();
        } else {
          queue.push(resolve);
        }
      }),
    release: () => {
      const next = queue.shift();
      if (next) next(); // 槽位轉交等待者（active 不變）
      else active--;
    },
  };
}
const llmGates = {};
const gateFor = (c) => (llmGates[c.name] ||= makeGate(c.maxConc));

// 對單一端點發請求（含並發閘 / 逾時 / 重試）。回空字串＝推理被截斷無有效輸出。
async function chatVia(c, messages, maxTokens, temperature) {
  if (!c.key) throw new Error("缺少 API key（LLM_API_KEY / NVIDIA_API_KEY / SUMMARY_API_KEY）");
  const gate = gateFor(c);
  const body = JSON.stringify({ model: c.model, messages, max_tokens: maxTokens, temperature });
  await gate.acquire();
  try {
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), c.timeout);
      try {
        const res = await fetch(`${c.base}/chat/completions`, {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.key}` },
          body,
        });
        // 429 / 5xx 可重試（429 優先依 retry-after 退避）。
        if ((res.status === 429 || res.status >= 500) && attempt < c.retries) {
          const ra = Number(res.headers.get("retry-after"));
          await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt);
          continue;
        }
        if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const json = await res.json();
        // 記下實際回應的模型名（誠實 provenance）；端點未回則維持上次/設定值。
        if (typeof json.model === "string" && json.model) lastRespondedModel = json.model;
        let content = json.choices?.[0]?.message?.content || "";
        // 推理模型（如 MiniMax）會輸出 <think>…</think>，need 剝除避免污染摘要/JSON。
        content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        // 殘留未閉合 <think> ＝ 推理被 max_tokens 截斷、無有效輸出。
        if (/<think>/i.test(content)) return "";
        return content;
      } catch (e) {
        // 逾時（AbortError）或網路錯誤 → 可重試；其餘（含 4xx）直接拋。
        const retriable =
          e.name === "AbortError" || /fetch failed|network|ECONN|ETIMEDOUT|terminated/i.test(e.message || "");
        if (retriable && attempt < c.retries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }
  } finally {
    gate.release();
  }
}

// 編排：summary profile 先試摘要端點（如免費 NVIDIA）；空或失敗則退回 primary（付費 MiniMax）補上，
// 確保摘要永遠完整、又能在 NVIDIA 成功時省成本。其餘 profile 直走對應端點。
async function chat(messages, { maxTokens = 1024, temperature = 0.3, profile = "primary" } = {}) {
  const c = profileCfg(profile);
  const primary = profileCfg("primary");
  const hasFallback = profile === "summary" && c.name !== primary.name;
  try {
    const out = await chatVia(c, messages, maxTokens, temperature);
    if (!out && hasFallback) return await chatVia(primary, messages, maxTokens, temperature);
    return out;
  } catch (e) {
    if (hasFallback) return await chatVia(primary, messages, maxTokens, temperature);
    throw e;
  }
}

// 從回應中萃取 JSON（容忍 ```json 圍欄與前後雜訊）
function extractJson(text) {
  let t = text.replace(/```json\s*([\s\S]*?)```/gi, "$1").replace(/```\s*([\s\S]*?)```/g, "$1").trim();
  const firstArr = t.indexOf("[");
  const lastArr = t.lastIndexOf("]");
  const firstObj = t.indexOf("{");
  const lastObj = t.lastIndexOf("}");
  // 優先抓陣列
  if (firstArr !== -1 && lastArr > firstArr) {
    try { return JSON.parse(t.slice(firstArr, lastArr + 1)); } catch {}
  }
  if (firstObj !== -1 && lastObj > firstObj) {
    try { return JSON.parse(t.slice(firstObj, lastObj + 1)); } catch {}
  }
  throw new Error(`無法解析 JSON：${text.slice(0, 200)}`);
}

const clampRisk = (r) => (RISKS.includes(r) ? r : "medium");
const clampCat = (c) => (CATEGORIES.includes(c) ? c : "其他");

// 危機關鍵字：命中則視為真正的重大事件，calibrateIntlRisk 不對其降級。
const CRISIS_KEYWORDS =
  /戰爭|開戰|侵略|入侵|核[子武彈]|飛彈|轟炸|空襲|恐攻|恐怖攻擊|政變|崩盤|違約|斷交|宣戰|封鎖|大規模|罹難|死亡|地震|海嘯|颶風|疫情爆發|大流行|屠殺|種族清洗/;

// 後處理風險校準（deterministic 安全網）。動機：LLM（推理模型）有 anchoring bias，
// 傾向把國際新聞一律當「重要＝高風險」，即使 prompt 已明列分布目標仍過度評 high
// （實測：金融類 83% 被評 high、224 筆 high 中 70 筆台灣關聯度 <30）。
// 規則：與台灣關聯度低（twRelevance < twRelFloor）且未命中危機關鍵字者，
//   critical → high、high → medium 各降一級；真危機（命中關鍵字）與高關聯事件不動。
// 不升級、不可變（回傳新物件）。export 供單元測試。
export function calibrateIntlRisk(event, { twRelFloor = 30 } = {}) {
  if (!event) return event;
  const text = `${event.title || ""}${event.summary || ""}`;
  if (CRISIS_KEYWORDS.test(text)) return event;
  const tw = typeof event.twRelevance === "number" ? event.twRelevance : 0;
  if (tw >= twRelFloor) return event;
  const downgrade = { critical: "high", high: "medium" };
  const next = downgrade[event.riskLevel];
  return next ? { ...event, riskLevel: next } : event;
}
// 台灣相關度（0-100 整數）。非數字 → undefined（欄位省略，向後相容）。export 供單元測試。
export const clampTwRelevance = (v) => {
  if (v == null || v === "") return undefined;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : undefined;
};
const SENTIMENTS = ["negative", "neutral", "positive", "mixed"];
// 事件情緒傾向枚舉。非枚舉值 → undefined（向後相容）。export 供單元測試。
export const clampSentiment = (v) => (SENTIMENTS.includes(v) ? v : undefined);

// LLM 萃取的語意訊號清洗（供 correlate 做語意關聯）。
function cleanEntities(v) {
  if (!Array.isArray(v)) return undefined;
  const out = [];
  for (const x of v) {
    const s = String(x || "").trim();
    if (s.length >= 2 && s.length <= 14 && !out.includes(s)) out.push(s);
    if (out.length >= 5) break;
  }
  return out.length ? out : undefined;
}
// 威脅行為者/敵對組織具名清洗（駭客組織、詐騙/犯罪集團、恐怖組織、敵國軍警單位等；名稱較長故放寬到 24）。export 供單元測試。
export function cleanActors(v) {
  if (!Array.isArray(v)) return undefined;
  const out = [];
  for (const x of v) {
    const s = String(x || "").trim();
    if (s.length >= 2 && s.length <= 24 && !out.includes(s)) out.push(s);
    if (out.length >= 5) break;
  }
  return out.length ? out : undefined;
}
// 實體關係清洗（餵關係圖）：每項須有非空字串 from/to/type 且各 ≤24；去重；cap 8；非陣列 → undefined。export 供單元測試。
export function cleanRelations(v) {
  if (!Array.isArray(v)) return undefined;
  const out = [];
  const seen = new Set();
  for (const r of v) {
    if (!r || typeof r !== "object") continue;
    const from = String(r.from || "").trim();
    const to = String(r.to || "").trim();
    const type = String(r.type || "").trim();
    if (!from || !to || !type || from.length > 24 || to.length > 24 || type.length > 24) continue;
    const key = `${from}|${to}|${type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to, type });
    if (out.length >= 8) break;
  }
  return out.length ? out : undefined;
}
function cleanTopic(v) {
  const s = String(v || "").trim();
  return s.length >= 4 && s.length <= 30 ? s : undefined;
}

function inferredLocationPrecision(scope, region, lat, lng) {
  if (lat === 0 && lng === 0) return "global";
  if (scope === "domestic") return region && region !== "全國" ? "city" : "country";
  if (String(region || "").includes("全球")) return "global";
  return lat != null && lng != null ? "country" : "unknown";
}

// 單批國際正規化（≤ batchSize 則）。idx 對應到傳入的 batchItems。
// items: [{title, link, description, source, sourceUrl, hint}]
// 回傳 IntelEvent[]（scope=international）
async function normalizeInternationalBatch(items, { max = 8 } = {}) {
  if (!items.length) return [];
  const listing = items
    .map((it, i) => `[${i}] 來源:${it.source}｜標題:${it.title}｜摘要:${(it.description || "").slice(0, 300)}`)
    .join("\n");

  const sys =
    "你是台灣的國際情勢分析助理。從給定的新聞清單中，挑出對台灣/全球最具情報價值的事件，輸出繁體中文 JSON。";
  const user = `以下是多則國際新聞原文（含索引）：
${listing}

請挑出最重要的至多 ${max} 則，輸出 JSON 陣列，每個物件欄位：
- idx: 原索引（整數）
- title_zh: 繁體中文標題（精簡）
- summary_zh: 繁體中文摘要（1-2 句，具體）
- category: 必為其一 ${JSON.stringify(CATEGORIES)}
- riskLevel: 必為其一 ${JSON.stringify(RISKS)}。分級準則（務必拉開分布，切勿把過半事件評為 high/critical）：
    · 「重要性」≠「風險等級」：一則重要的外交或經濟新聞，風險等級可能只是 medium 或 low
    · critical（應屬罕見，通常 <15%）＝迫近或正在發生的大規模致命威脅（戰爭爆發或重大升級、重大恐攻、核子事件、直接衝擊台海的軍事行動）
    · high＝重大但非災難級（區域武裝衝突、重要制裁/外交決裂、被實際利用的重大資安漏洞、衝擊全球供應鏈）
    · medium（多數一般國際動態屬此）＝外交會談、政策/選舉、常規軍演、一般經濟金融、一般社會新聞
    · low＝低衝擊或例行消息
    · high 同樣須節制：只有真正重大者（上述）才 high；一般外交/政策/經濟/社會/科技新聞一律 medium 或 low
    參考分布（每批盡量接近，切勿全部塞 high/critical）：critical 約 5-10%、high 約 20-30%、medium 約 40-50%、low 約 15-25%
- region: 事件主要地點名稱（中文，如「烏克蘭」「荷莫茲海峽」）
- lat, lng: 該地點的概略經緯度（你的最佳估計，浮點數）
- entities: 此事件可跨則比對的具名實體陣列（精簡專名：國家/組織/人物/地點等；最多 5 個；無則 []）
- topic: 此事件的「具體事件/故事線」短描述（10-18 字，能跨來源辨識同一起事件；非分類）
- twRelevance: 對台灣的相關度（0-100 整數；台海/兩岸/盟友/供應鏈/半導體/在台或赴台僑民越相關越高，與台灣幾乎無關則低）
- sentiment: 事件情緒傾向（必為其一 ["negative","neutral","positive","mixed"]）
- threatActors: 涉及的威脅行為者/敵對組織具名陣列（駭客組織、詐騙/犯罪集團、恐怖組織、敵國軍警單位等；最多 5；無則 []）
- relations: 此事件中關鍵實體間的關係陣列，每項物件 {from, to, type}（type 為關係類型如「軍援」「制裁」「衝突」「結盟」「談判」；最多 8；無則 []）

只輸出 JSON 陣列，不要任何說明文字。`;

  const out = await chat(
    [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    { maxTokens: 16384, temperature: 0.2 }
  );
  const arr = extractJson(out);
  const fetchedAt = new Date().toISOString();
  const model = llmModel();

  const events = [];
  for (const o of Array.isArray(arr) ? arr : []) {
    const it = items[o.idx];
    if (!it) continue;
    events.push({
      id: `intl-${slug(it.link, o.idx)}`,
      title: o.title_zh || it.title,
      region: o.region || "國際",
      lat: typeof o.lat === "number" ? o.lat : undefined,
      lng: typeof o.lng === "number" ? o.lng : undefined,
      locationPrecision: inferredLocationPrecision("international", o.region, o.lat, o.lng),
      locationNote: "LLM 依新聞內容推估位置，非原始精準座標",
      timestamp: toIso(it.pubDate),
      category: clampCat(o.category),
      scope: "international",
      riskLevel: clampRisk(o.riskLevel),
      summary: o.summary_zh || it.description?.slice(0, 200) || "",
      aiEntities: cleanEntities(o.entities),
      aiTopic: cleanTopic(o.topic),
      twRelevance: clampTwRelevance(o.twRelevance),
      sentiment: clampSentiment(o.sentiment),
      threatActors: cleanActors(o.threatActors),
      relations: cleanRelations(o.relations),
      source: {
        ...deriveNewsProvenance(it, { fetchedAt, model }),
        datasetId: undefined,
      },
    });
  }
  return events;
}

// 國際正規化（對外）：先標題去重 → 分批並行（每批挑該批最重要的數則）→ 合併去重 → 依風險排序取前 max。
// 動機：擴增到數百個 feed 後，單一 prompt 會塞入數千則（~數十萬 token）→ 爆 context／成本暴增／被截斷。
// 批次化把規模問題拆開，與 normalizeDomesticNews 同模式。max/batchSize/concurrency 皆 env 可調。
// 事件 id 由連結決定（與各 normalize 函式一致）→ 用於跨輪快取比對。
export const eventIdFor = (scope, link) => (link ? `${scope === "domestic" ? "twnews" : "intl"}-${slug(link)}` : null);

// 跨輪快取分流：依「連結決定的 id」把輸入拆成「已正規化可重用（priorById 命中）」與「需送 LLM 的新項」。
// 同一篇（同連結）重用前一輪事件、跳過 LLM；priorById 未提供時全部視為新項（向後相容）。
function partitionByCache(items, scope, priorById) {
  if (!priorById?.size) return { reused: [], fresh: items };
  const reused = [];
  const fresh = [];
  for (const it of items) {
    const key = eventIdFor(scope, it.link);
    const hit = key && priorById.get(key);
    if (hit) reused.push(hit);
    else fresh.push(it);
  }
  return { reused, fresh };
}

// 高風險事件二次深度分析：對 critical/high 事件補一段繁中「影響評估」（implications）。
// prompt 組裝抽成純函式，便於無 LLM 單元測試。
export function buildDeepAnalysisPrompt(event) {
  return [
    { role: "system", content: "你是台灣的國際情勢分析助理，針對單一高風險事件做精煉的影響評估。" },
    {
      role: "user",
      content: `事件：${event.title}
地區：${event.region}｜分類：${event.category}｜風險：${event.riskLevel}
摘要：${event.summary}

請用一段 60-120 字的繁體中文寫「影響評估」，聚焦此事件對台灣與所在區域的後續影響與風險外溢，不要前言、不要重複事件描述。`,
    },
  ];
}

// 對前段 critical/high 事件（上限 max；已有 implications 者跳過，配合跨輪快取）並行補影響評估；單則失敗 graceful 保留原事件。
async function deepAnalyzeHighRisk(events, { max = Math.max(0, Number(process.env.INTL_DEEP_ANALYSIS_MAX) || 5) } = {}) {
  const off = process.env.INTL_DEEP_ANALYSIS === "0" || process.env.INTL_DEEP_ANALYSIS === "false";
  if (off || !events.length) return events;
  const targetIds = new Set();
  for (const ev of events) {
    if (targetIds.size >= max) break;
    if (!ev.implications && (ev.riskLevel === "critical" || ev.riskLevel === "high")) targetIds.add(ev.id);
  }
  if (!targetIds.size) return events;
  const deepened = new Map();
  await Promise.all(
    [...targetIds].map(async (id) => {
      const ev = events.find((e) => e.id === id);
      try {
        const text = (await chat(buildDeepAnalysisPrompt(ev), { maxTokens: 1500, temperature: 0.3, profile: "summary" })) || "";
        const s = text.trim();
        if (s) deepened.set(id, s);
      } catch {
        /* graceful：保留原事件 */
      }
    }),
  );
  return events.map((ev) => (deepened.has(ev.id) ? { ...ev, implications: deepened.get(ev.id) } : ev));
}

export async function normalizeInternational(
  items,
  {
    max = 20,
    batchSize = Math.max(8, Number(process.env.INTL_NORMALIZE_BATCH) || 30),
    concurrency = Math.max(1, Number(process.env.INTL_NORMALIZE_CONCURRENCY) || 4),
    priorById = null,
  } = {}
) {
  if (!items.length) return [];
  // 入口標題去重（多查詢／多源大量重複同一則 → 省 LLM、避免重複輸出）。
  const seenTitle = new Set();
  const deduped = [];
  for (const it of items) {
    const k = newsTitleKey(it.title);
    if (!k || seenTitle.has(k)) continue;
    seenTitle.add(k);
    deduped.push(it);
  }
  // 跨輪快取：命中前一輪者重用、跳過 LLM；只有新項才送 LLM。
  const { reused, fresh } = partitionByCache(deduped, "international", priorById);

  let llmEvents = [];
  if (fresh.length) {
    if (fresh.length <= batchSize) {
      llmEvents = await normalizeInternationalBatch(fresh, { max });
    } else {
      const batches = [];
      for (let i = 0; i < fresh.length; i += batchSize) batches.push(fresh.slice(i, i + batchSize));
      // 每批挑 top（總候選量約 max 的 2 倍，最後再全域排序取 max）。
      const perBatch = Math.max(4, Math.ceil((max * 2) / batches.length));
      // 推理模型偶發截斷／解析失敗 → 單批重試一次，仍失敗才放棄該批（不拖垮整體）。
      const runBatch = (b) =>
        normalizeInternationalBatch(b, { max: perBatch }).catch(() =>
          normalizeInternationalBatch(b, { max: perBatch }).catch(() => [])
        );
      llmEvents = (await mapLimit(batches, concurrency, runBatch)).flat();
    }
  }

  // 合併「重用 + 新正規化」→ 對新正規化事件套後處理風險校準（reused 於原生成輪已校準，
  // 不重複降級以維持 idempotent）→ 依 id 去重 → 分主題多元挑選取前 max。
  // 不再用純風險排序截斷：那會讓 low/medium 在進累積池前被高風險洗光；
  // 最終榜單交由下游 accumulateInternational 再依主題多元挑選。
  const calibratedFresh = llmEvents.map((e) => calibrateIntlRisk(e));
  const seen = new Set();
  const merged = [];
  for (const ev of [...reused, ...calibratedFresh]) {
    if (!ev || seen.has(ev.id)) continue;
    seen.add(ev.id);
    merged.push(ev);
  }
  // 高風險事件二次深度分析（補 implications；env INTL_DEEP_ANALYSIS=0 可關，失敗 graceful）。
  return await deepAnalyzeHighRisk(selectDiverseByCategory(merged, max));
}

// 台灣社會/犯罪新聞分類（domestic）
const TW_CATEGORIES = ["治安", "社會", "交通", "災防", "反詐"];
const clampTwCat = (c) => (TW_CATEGORIES.includes(c) ? c : "社會");

// 單批正規化（≤ batchSize 則）。idx 對應到傳入的 batchItems。
async function normalizeNewsBatch(items) {
  const listing = items
    .map((it, i) => `[${i}] 來源:${it.source}｜標題:${it.title}｜摘要:${(it.description || "").slice(0, 300)}`)
    .join("\n");

  const sys =
    "你是台灣警政情報分析助理。從台灣社會新聞清單中，挑出與治安、犯罪、災害、交通事故、詐騙最相關、對警政有參考價值的事件，輸出繁體中文 JSON。";
  const user = `以下是多則台灣社會新聞原文（含索引）：
${listing}

這些新聞已用警政關鍵字預篩。請盡量保留所有與警政、治安、犯罪、事故、災害、執法、檢調、消防、海巡相關者（寧可多收、不要漏；僅排除純政治口水、娛樂、體育、股市財經行情等明顯無關者），輸出 JSON 陣列，每個物件欄位：
- idx: 原索引（整數）
- title_zh: 繁體中文標題（精簡）
- summary_zh: 繁體中文摘要（1-2 句，具體）
- category: 必為其一 ${JSON.stringify(TW_CATEGORIES)}
- riskLevel: 必為其一 ${JSON.stringify(RISKS)}（依事件嚴重度）
- region: 事件發生的台灣縣市（中文，如「臺北市」「高雄市」；無法判斷填「全國」）
- lat, lng: 該縣市的概略經緯度（你的最佳估計，浮點數；全國填台灣中心 23.8,120.9）
- entities: 此事件可跨則比對的具名實體陣列（精簡專名：人名/化名、機關分局、地檢署、路名/地標、集團/園區名等；最多 5 個；無則 []）
- topic: 此事件的「具體事件/故事線」短描述（10-18 字，能跨來源辨識同一起事件，如「柬埔寨人口販運詐騙集團案」；非分類，是這一則的具體題目）
- sentiment: 事件情緒傾向（必為其一 ["negative","neutral","positive","mixed"]）
- threatActors: 涉及的威脅行為者/犯罪組織具名陣列（詐騙集團、幫派、車手集團、人口販運集團等；最多 5；無則 []）

只輸出 JSON 陣列，不要任何說明文字。`;

  const out = await chat(
    [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    { maxTokens: 16384, temperature: 0.2 }
  );
  const arr = extractJson(out);
  const fetchedAt = new Date().toISOString();
  const model = llmModel();

  const events = [];
  for (const o of Array.isArray(arr) ? arr : []) {
    const it = items[o.idx];
    if (!it) continue;
    events.push({
      id: `twnews-${slug(it.link, o.idx)}`,
      title: o.title_zh || it.title,
      region: o.region || "全國",
      lat: typeof o.lat === "number" ? o.lat : undefined,
      lng: typeof o.lng === "number" ? o.lng : undefined,
      locationPrecision: inferredLocationPrecision("domestic", o.region, o.lat, o.lng),
      locationNote: "LLM 依新聞內容推估位置，非原始精準座標",
      timestamp: toIso(it.pubDate),
      category: clampTwCat(o.category),
      scope: "domestic",
      riskLevel: clampRisk(o.riskLevel),
      summary: o.summary_zh || it.description?.slice(0, 200) || "",
      aiEntities: cleanEntities(o.entities),
      aiTopic: cleanTopic(o.topic),
      sentiment: clampSentiment(o.sentiment),
      threatActors: cleanActors(o.threatActors),
      source: deriveNewsProvenance(it, { fetchedAt, model }),
    });
  }
  return events;
}

// items: [{title, link, description, source, sourceUrl, hint}]
// 分批（每批 batchSize 則並行）正規化再合併去重；避免單次輸出過長被推理模型截斷。
// 限制並行數的 map（避免一次打太多 LLM 請求觸發 429）。
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// 標題正規化鍵：去掉「 - 媒體名／｜媒體名」尾綴與所有非中英數字元，用於跨來源/跨查詢去重。
function newsTitleKey(title) {
  return String(title || "")
    .replace(/\s*[-|｜–—]\s*[^-|｜–—]{1,20}$/, "")
    .replace(/[^一-鿿A-Za-z0-9]/g, "")
    .toLowerCase()
    .slice(0, 40);
}

export async function normalizeDomesticNews(items, { max = 250, batchSize = 12, concurrency = 4, priorById = null } = {}) {
  if (!items.length) return [];
  // 入口先依標題去重（Google News 多查詢＋直連媒體會大量重複同一則）→ 省 LLM、避免重複輸出。
  const seenTitle = new Set();
  const deduped = [];
  for (const it of items) {
    const k = newsTitleKey(it.title);
    if (!k || seenTitle.has(k)) continue;
    seenTitle.add(k);
    deduped.push(it);
  }
  // 跨輪快取：命中前一輪者重用、跳過 LLM；只有新項才送 LLM。
  const { reused, fresh } = partitionByCache(deduped, "domestic", priorById);
  const batches = [];
  for (let i = 0; i < fresh.length; i += batchSize) batches.push(fresh.slice(i, i + batchSize));
  // 推理模型偶發截斷/解析失敗 → 單批重試一次，仍失敗才放棄該批（不拖垮整體）。
  const runBatch = (b) => normalizeNewsBatch(b).catch(() => normalizeNewsBatch(b).catch(() => []));
  const results = await mapLimit(batches, concurrency, runBatch);
  const seen = new Set();
  const merged = [];
  for (const ev of [...reused, ...results.flat()]) {
    if (!ev || seen.has(ev.id)) continue;
    seen.add(ev.id);
    merged.push(ev);
  }
  return merged.slice(0, max);
}

// 情勢摘要：每日國內/國際 + 近24h即時 + 分類別 + 趨勢（單一函式集中產生，全部 graceful）。
const DAY_MS = 86400000;
// 通用 brief：給事件清單與指令，回繁中摘要；失敗回 "" 不中斷。
async function briefEvents(label, events, instruction, maxTokens = 2048) {
  if (!events?.length) return "";
  const lines = events
    .slice(0, 20)
    .map((e) => `- [${e.riskLevel}] ${e.category}｜${e.title}：${e.summary}`)
    .join("\n");
  const ask = async () => {
    try {
      return (
        (await chat(
          [
            { role: "system", content: "你是情報儀表板的分析助理，用繁體中文寫精煉的情勢摘要。" },
            { role: "user", content: `以下是${label}：\n${lines}\n\n${instruction}` },
          ],
          { maxTokens, temperature: 0.4, profile: "summary" }
        )) || ""
      ).trim();
    } catch {
      return "";
    }
  };
  // reasoning model（MiniMax）偶發整段 <think> 吃光 token → 剝除後為空；重試一次。
  return (await ask()) || (await ask());
}

export async function summarize({ domestic = [], international = [], clusters = [] }) {
  const now = Date.now();
  const dailyInstr =
    "請寫一段 80-150 字的繁體中文情勢摘要，點出最關鍵的趨勢與風險，不要逐條列出、不要前言。";

  // 近 24 小時事件（即時脈動）
  const recent = domestic.filter((e) => {
    const t = Date.parse(e.timestamp);
    return Number.isFinite(t) && now - t < DAY_MS;
  });

  const [dom, intl, recent24h] = await Promise.all([
    briefEvents("國內今日重點事件", domestic, dailyInstr),
    briefEvents("國際今日重點事件", international, dailyInstr),
    briefEvents(
      "國內最近 24 小時事件",
      recent,
      "請寫一段 60-100 字的繁體中文即時脈動摘要，聚焦最近 24 小時最值得注意的動態，不要前言。"
    ),
  ]);

  // 分類別摘要（事件量 top 4 類各一句）
  const byCat = {};
  for (const e of domestic) (byCat[e.category] ??= []).push(e);
  const topCats = Object.entries(byCat)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 4);
  const catResults = await Promise.all(
    topCats.map(([cat, evs]) =>
      briefEvents(
        `「${cat}」類事件`,
        evs,
        "請用一句 25-45 字的繁體中文點出此類別目前的重點與態勢，不要前言。",
        1500
      ).then((t) => [cat, (t || "").trim()])
    )
  );
  const byCategory = Object.fromEntries(catResults.filter(([, t]) => t));

  // 趨勢摘要：5 天每日計數（確定性）→ LLM 敘事一句
  const dailyCounts = [];
  for (let i = 4; i >= 0; i--) {
    const from = now - (i + 1) * DAY_MS;
    const to = now - i * DAY_MS;
    dailyCounts.push(
      domestic.filter((e) => {
        const t = Date.parse(e.timestamp);
        return Number.isFinite(t) && t >= from && t < to;
      }).length
    );
  }
  let trend = "";
  if (domestic.length) {
    try {
      trend = await chat(
        [
          { role: "system", content: "你是情報儀表板的趨勢分析助理，用繁體中文寫精煉敘述。" },
          {
            role: "user",
            content: `近 5 日每日事件數（最舊到最新）：${dailyCounts.join(", ")}。請用一句 25-45 字的繁體中文描述整體趨勢（上升／下降／持平與幅度感），不要逐日列出、不要前言。`,
          },
        ],
        { maxTokens: 1500, temperature: 0.3, profile: "summary" }
      );
    } catch {
      trend = "";
    }
  }

  return {
    domestic: dom || "（暫無資料）",
    international: intl || "（暫無資料）",
    recent24h: (recent24h || "").trim(),
    byCategory,
    trend: (trend || "").trim(),
    dailyCounts,
    clusterSummaries: await summarizeClusters(clusters, domestic),
    // 用實際回應的模型名（chat 已記錄），避免標示成不符的設定值。
    model: respondedModel(),
    generatedAt: new Date().toISOString(),
  };
}

// 情報群摘要：top N cluster（依成員數）各產一句「這群在講什麼」。存 summary.json，前端用 cluster id join。
async function summarizeClusters(clusters, domestic, topN = Number(process.env.CLUSTER_SUMMARY_N) || 8) {
  if (!clusters?.length || !domestic?.length) return {};
  const byId = new Map(domestic.map((e) => [e.id, e]));
  const top = [...clusters].sort((a, b) => (b.size ?? 0) - (a.size ?? 0)).slice(0, topN);
  const results = await Promise.all(
    top.map(async (c) => {
      const members = (c.members || [])
        .map((id) => byId.get(id))
        .filter(Boolean)
        .slice(0, 16);
      if (members.length < 2) return [c.id, ""];
      const lines = members.map((e) => `- ${e.category}｜${e.title}`).join("\n");
      try {
        const t = await chat(
          [
            { role: "system", content: "你是情報儀表板的分析助理，用繁體中文一句話概括一組相關事件的共同主題。" },
            {
              role: "user",
              content: `以下是一個情報群（${c.size} 則相關事件）的代表事件：\n${lines}\n\n請用一句 25-45 字的繁體中文點出這群事件共同在講什麼，不要前言、不要逐條列出。`,
            },
          ],
          { maxTokens: 1500, temperature: 0.4, profile: "summary" }
        );
        return [c.id, (t || "").trim()];
      } catch {
        return [c.id, ""];
      }
    })
  );
  return Object.fromEntries(results.filter(([, t]) => t));
}

function slug(link, idx) {
  // 以連結內容 hash 確保唯一，避免不同文章因路徑片段相同而撞 id
  const s = link || `n${idx}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function toIso(pubDate) {
  if (!pubDate) return new Date().toISOString();
  const d = new Date(pubDate);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
