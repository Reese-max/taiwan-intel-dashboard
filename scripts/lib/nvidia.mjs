// LLM（OpenAI 相容端點）整合：摘要 + 新聞正規化。
//  - normalizeInternational：RSS 原文 → 統一 IntelEvent（中文摘要/分類/風險/座標估計）
//  - summarize：國內/國際事件 → 每日情勢摘要段落
// Provider 中性：優先讀 LLM_*，未設則 fallback 回 NVIDIA_*（向後相容）。
// 例如 MiniMax：LLM_BASE_URL=https://api.minimax.io/v1、LLM_MODEL=MiniMax-M2。
// 座標為 LLM 推估（非原始資料），呼叫端需在 provenance 誠實標註。

const CATEGORIES = ["地緣政治", "災害", "資安", "金融", "其他"];
const RISKS = ["low", "medium", "high", "critical"];

// 設定指定送出的模型名稱（請求用）。fallback：LLM_MODEL → NVIDIA_MODEL → ""。
export const llmModel = () => process.env.LLM_MODEL || process.env.NVIDIA_MODEL || "";

// 最近一次 LLM 回應實際使用的模型（OpenAI 相容 API 會在回應帶 model 欄位）。
// provenance 用「真實回應模型」誠實標註，無則 fallback 設定值，避免錯標。
let lastRespondedModel = "";
export const respondedModel = () => lastRespondedModel || llmModel();

function cfg() {
  const base = process.env.LLM_BASE_URL || process.env.NVIDIA_BASE_URL;
  const key = process.env.LLM_API_KEY || process.env.NVIDIA_API_KEY;
  const model = llmModel();
  if (!key) throw new Error("缺少 LLM_API_KEY / NVIDIA_API_KEY（請於 .env 設定）");
  return { base, key, model };
}

async function chat(messages, { maxTokens = 1024, temperature = 0.3 } = {}) {
  const { base, key, model } = cfg();
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  // 記下實際回應的模型名（誠實 provenance）；端點未回則維持上次/設定值。
  if (typeof json.model === "string" && json.model) lastRespondedModel = json.model;
  let content = json.choices?.[0]?.message?.content || "";
  // 推理模型（如 MiniMax-M2）會輸出 <think>…</think>，need 剝除避免污染摘要/JSON。
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // 殘留未閉合 <think> ＝ 推理被 max_tokens 截斷、無有效輸出。
  if (/<think>/i.test(content)) return "";
  return content;
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
function cleanTopic(v) {
  const s = String(v || "").trim();
  return s.length >= 4 && s.length <= 30 ? s : undefined;
}

// items: [{title, link, description, source, sourceUrl, hint}]
// 回傳 IntelEvent[]（scope=international）
export async function normalizeInternational(items, { max = 10 } = {}) {
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
- riskLevel: 必為其一 ${JSON.stringify(RISKS)}（依事件嚴重度）
- region: 事件主要地點名稱（中文，如「烏克蘭」「荷莫茲海峽」）
- lat, lng: 該地點的概略經緯度（你的最佳估計，浮點數）
- entities: 此事件可跨則比對的具名實體陣列（精簡專名：國家/組織/人物/地點等；最多 5 個；無則 []）
- topic: 此事件的「具體事件/故事線」短描述（10-18 字，能跨來源辨識同一起事件；非分類）

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
      timestamp: toIso(it.pubDate),
      category: clampCat(o.category),
      scope: "international",
      riskLevel: clampRisk(o.riskLevel),
      summary: o.summary_zh || it.description?.slice(0, 200) || "",
      aiEntities: cleanEntities(o.entities),
      aiTopic: cleanTopic(o.topic),
      source: {
        name: it.source,
        type: "news-rss",
        url: it.link,
        fetchedAt,
        query: `RSS ${it.sourceUrl} → LLM(${model}) 正規化`,
      },
    });
  }
  return events;
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
      timestamp: toIso(it.pubDate),
      category: clampTwCat(o.category),
      scope: "domestic",
      riskLevel: clampRisk(o.riskLevel),
      summary: o.summary_zh || it.description?.slice(0, 200) || "",
      aiEntities: cleanEntities(o.entities),
      aiTopic: cleanTopic(o.topic),
      source: {
        name: it.source,
        type: "news-rss",
        datasetId: "tw-news",
        recordRef: it.link,
        url: it.link,
        fetchedAt,
        query: `RSS ${it.sourceUrl} → LLM(${model}) 正規化`,
      },
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

export async function normalizeDomesticNews(items, { max = 250, batchSize = 12, concurrency = 4 } = {}) {
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
  items = deduped;
  const batches = [];
  for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize));
  // 推理模型偶發截斷/解析失敗 → 單批重試一次，仍失敗才放棄該批（不拖垮整體）。
  const runBatch = (b) => normalizeNewsBatch(b).catch(() => normalizeNewsBatch(b).catch(() => []));
  const results = await mapLimit(batches, concurrency, runBatch);
  const seen = new Set();
  const merged = [];
  for (const ev of results.flat()) {
    if (seen.has(ev.id)) continue;
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
          { maxTokens, temperature: 0.4 }
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
        { maxTokens: 1500, temperature: 0.3 }
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
          { maxTokens: 1500, temperature: 0.4 }
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
