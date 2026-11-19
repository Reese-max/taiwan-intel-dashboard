// 國內新聞 LLM 複核：規則判為相關、但標題沒有明確案件字眼的新聞，交給 LLM 判斷是否真為事件。
// 失敗一律保留規則結果（fail-open）；判斷結果依標題鍵跨輪快取，每輪只問新進新聞。
import { chatVia, extractJson, profileCfg, sleep } from "./llm-client.mjs";
import { hasStrongCaseTitle } from "./news-bulk.mjs";
import { titleKey } from "./title-key.mjs";

export const VERDICTS_FILE = "news-llm-verdicts.json";
// 直接打主端點、不走 fallback：fallback 失敗時拋出的是它自己的錯，會蓋掉 MiniMax 的 422 審查訊息，拆批就不會啟動。
const primaryChat = (messages, { maxTokens, temperature }) => chatVia(profileCfg("primary"), messages, maxTokens, temperature);
const VERDICT_TTL_MS = 14 * 86400000;

const SYSTEM_PROMPT = `你是台灣治安情資儀表板的新聞篩選員。每則新聞已被關鍵字規則收進來，你要找出其中「不是實際事件」的誤收。
算事件（保留）：已發生的犯罪、詐騙、司法偵審、選舉犯罪（賄選、變造文書、意圖使人不當選）、性騷擾、家暴、鬥毆與肢體衝突、酒駕毒駕與拒測、中共滲透、跟監與國安案件、走私、交通事故、火災爆炸、天災與公安意外、食安衛生、資安事件、失蹤協尋、警消救援，以及這些事件的後續處理；國外的犯罪、詐騙、資安事件也保留。
只要標題提到可能違法的具體行為、或檢警調查與處分，即使出現在政治或演藝新聞裡也保留。
不算事件（剔除）：只是比喻用字（搶票、搶鏡、搶C位、狂砍27分、砍目標價、殺紅眼）、選戰造勢與政治口水、演藝娛樂、運動賽事、財經股市、商品促銷、醫療衛教、生活資訊、與台灣無關的國外政治經濟新聞。
拿不準時一律保留。只輸出 JSON：{"drop":[要剔除的編號]}，沒有要剔除就輸出 {"drop":[]}。`;

export function readVerdicts(raw, now = Date.now()) {
  const verdicts = new Map();
  for (const [key, v] of Object.entries(raw?.verdicts || {})) {
    const at = Date.parse(v?.at);
    if (typeof v?.keep === "boolean" && Number.isFinite(at) && now - at < VERDICT_TTL_MS) verdicts.set(key, v);
  }
  return verdicts;
}

export function serializeVerdicts(verdicts) {
  return { version: 1, verdicts: Object.fromEntries([...verdicts].sort(([a], [b]) => a.localeCompare(b))) };
}

async function reviewBatch(batch, chatFn) {
  const lines = batch.map((it, i) => {
    const desc = String(it.description || "").replace(/\s+/g, " ").slice(0, 80);
    return `${i + 1}. ${String(it.title || "").trim()}${desc ? `｜${desc}` : ""}`;
  });
  const text = await chatFn(
    [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: lines.join("\n") }],
    { maxTokens: 400, temperature: 0 },
  );
  const parsed = extractJson(String(text || ""));
  const drop = Array.isArray(parsed) ? parsed : parsed?.drop;
  if (!Array.isArray(drop)) throw new Error(`LLM 回應缺 drop 陣列：${String(text).slice(0, 120)}`);
  const ids = new Set(drop.map(Number));
  for (const id of ids) if (!Number.isInteger(id) || id < 1 || id > batch.length) throw new Error(`LLM 回應編號超出範圍：${id}`);
  return ids;
}

// items：已通過規則的原始 RSS 項目。回傳要剔除的項目集合與統計；verdicts 會就地更新。
export async function reviewNewsRelevance(items, {
  verdicts = new Map(),
  chatFn = primaryChat,
  batchSize = 40,
  // 一次一批：複核緊接在國際正規化之後，並發會撞 MiniMax 的每分鐘速率上限（HTTP 429）。
  concurrency = 1,
  budgetMs = 4 * 60e3,
  now = Date.now(),
  sleepFn = sleep,
} = {}) {
  const stats = { candidates: 0, cached: 0, reviewed: 0, dropped: 0, moderated: 0, failedBatches: 0, skippedBatches: 0 };
  const dropped = new Set();
  const fresh = new Map();
  for (const it of items) {
    if (it?.official === true || hasStrongCaseTitle(it?.title)) continue;
    const key = titleKey(it?.title);
    if (!key) continue;
    stats.candidates++;
    const cached = verdicts.get(key);
    if (cached) {
      stats.cached++;
      if (!cached.keep) dropped.add(it);
      continue;
    }
    if (!fresh.has(key)) fresh.set(key, []);
    fresh.get(key).push(it);
  }
  const keys = [...fresh.keys()];
  const batches = [];
  for (let i = 0; i < keys.length; i += batchSize) batches.push(keys.slice(i, i + batchSize));
  const deadline = Date.now() + budgetMs;
  const at = new Date(now).toISOString();
  // 回傳每個標題鍵是否保留。模型對邊界新聞的判斷每次不同：正序、倒序各問一次，兩次都要剔除才剔除。
  // MiniMax 內容審查（HTTP 422 new_sensitive）會擋下整批：對半拆開重問，單則仍被擋就保留並記住，不再重送。
  const judge = async (batchKeys) => {
    const batchItems = batchKeys.map((k) => fresh.get(k)[0]);
    try {
      const [forward, backward] = await Promise.all([
        reviewBatch(batchItems, chatFn),
        reviewBatch([...batchItems].reverse(), chatFn),
      ]);
      return batchKeys.map((_, i) => !(forward.has(i + 1) && backward.has(batchKeys.length - i)));
    } catch (e) {
      if (!/new_sensitive/.test(String(e?.message || e))) throw e;
      if (batchKeys.length === 1) { stats.moderated++; return [true]; }
      const mid = Math.ceil(batchKeys.length / 2);
      return [...await judge(batchKeys.slice(0, mid)), ...await judge(batchKeys.slice(mid))];
    }
  };
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      // 預算用完的批次留給下一輪，本輪照規則結果保留。
      if (Date.now() > deadline) { stats.skippedBatches++; continue; }
      let keeps;
      for (let attempt = 0; !keeps; attempt++) {
        try {
          keeps = await judge(batch);
        } catch (e) {
          // 速率限制以分鐘計：等 30、60 秒再試，仍在時間預算內才等。
          const waitMs = 30e3 * (attempt + 1);
          if (/HTTP 429/.test(String(e?.message || e)) && attempt < 2 && Date.now() + waitMs < deadline) {
            stats.rateLimitWaits = (stats.rateLimitWaits || 0) + 1;
            await sleepFn(waitMs);
            continue;
          }
          stats.failedBatches++;
          console.warn(`國內新聞 LLM 複核批次失敗，本批照規則保留：${String(e?.message || e).slice(0, 200)}`);
          break;
        }
      }
      if (!keeps) continue;
      batch.forEach((key, i) => {
        verdicts.set(key, { keep: keeps[i], at });
        stats.reviewed++;
        if (!keeps[i]) for (const it of fresh.get(key)) dropped.add(it);
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  stats.dropped = dropped.size;
  return { dropped, stats };
}
