// LLM（OpenAI 相容端點）整合：摘要 + 新聞正規化。
//  - normalizeInternational：RSS 原文 → 統一 IntelEvent（中文摘要/分類/風險/座標估計）
//  - summarize：國內/國際事件 → 每日情勢摘要段落
// Provider 中性：優先讀 LLM_*，未設則 fallback 回 NVIDIA_*（向後相容）。
// 例如 MiniMax：LLM_BASE_URL=https://api.minimax.io/v1、LLM_MODEL=MiniMax-M2。
// 座標為 LLM 推估（非原始資料），呼叫端需在 provenance 誠實標註。

const CATEGORIES = ["地緣政治", "災害", "資安", "金融", "其他"];
const RISKS = ["low", "medium", "high", "critical"];

// 目前使用的模型名稱（供 provenance 標註）。
export const llmModel = () => process.env.LLM_MODEL || llmModel() || "";

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

// 每日情勢摘要（國內 / 國際各一段）
export async function summarize({ domestic, international }) {
  const brief = async (label, events) => {
    if (!events.length) return "（暫無資料）";
    const lines = events
      .slice(0, 20)
      .map((e) => `- [${e.riskLevel}] ${e.category}｜${e.title}：${e.summary}`)
      .join("\n");
    return chat(
      [
        { role: "system", content: "你是情報儀表板的分析助理，用繁體中文寫精煉的每日情勢摘要。" },
        {
          role: "user",
          content: `以下是${label}今日重點事件：\n${lines}\n\n請寫一段 80-150 字的繁體中文情勢摘要，點出最關鍵的趨勢與風險，不要逐條列出、不要前言。`,
        },
      ],
      { maxTokens: 2048, temperature: 0.4 }
    );
  };
  const [dom, intl] = await Promise.all([brief("國內", domestic), brief("國際", international)]);
  return {
    domestic: dom,
    international: intl,
    model: llmModel(),
    generatedAt: new Date().toISOString(),
  };
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
