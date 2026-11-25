// 國內新聞 LLM 複核：規則判為相關、但標題沒有明確案件字眼的新聞，交給 LLM 判斷是否真為事件。
// 失敗一律保留規則結果（fail-open）；判斷結果依標題鍵跨輪快取，每輪只問新進新聞。
import { chatVia, profileCfg, sleep } from "./llm-client.mjs";
import { hasStrongCaseTitle, isForeignNewsCandidate } from "./news-bulk.mjs";
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

// 2026-11-25 負責人決定：國內層不收完全發生在國外、與台灣無直接關係的事件；候選由 isForeignNewsCandidate 挑出。
const FOREIGN_PROMPT = `你是台灣治安情資儀表板「國內」頁的新聞篩選員。以下每則新聞標題都提到外國地名，你要判斷事件是否屬於台灣國內。
屬於台灣（保留）：事件發生在台灣；或直接涉及台灣——台灣人或在台外國人（移工、旅客、外籍配偶）、台灣的機關、店家、學校、法院、警消、防疫或邊境措施、在台販售的商品；台灣人在國外涉案或受害也保留。
不屬於台灣（剔除）：完全發生在國外、當事人與台灣無關的事件。
例：「日本福岡商場旁男子遇刺亡」剔除；「墨西哥逮捕FBI十大通緝毒梟」剔除；「日本籍男子西門町砍人」保留；「日本腦炎今年首例致死」保留（台灣疫情）；「韓國烤肉店深夜氣爆」保留（台灣店家）；「泰國蝦養殖場股東糾紛」保留（台灣養殖場）；「北海道鮮乳遭竊 超商店員報警」保留（台灣商店）；「綁票取贖私吞逃越南 3共犯判刑」保留（台灣案件、嫌犯逃往國外）；「候選人遭押70天 胞弟轟新加坡羈押最長8天」保留（台灣司法，外國只作比較）。
拿不準時一律保留。只輸出 JSON：{"drop":[要剔除的編號]}，沒有要剔除就輸出 {"drop":[]}。`;
export const FOREIGN_VERDICT_PREFIX = "foreign:";

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

// 只接受 {"drop":[...]} 物件或整段就是陣列；模型在 JSON 後接帶括號的說明時仍可解析（2026-11-25 正式站一批失敗），
// 但不從說明文字裡抓不相干的括號段落當答案（誤刪風險，跨家族審查重現）。找不到就丟錯，呼叫端照規則保留。
export function parseDropList(text) {
  const t = String(text || "").replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1").trim();
  try {
    const whole = JSON.parse(t);
    if (Array.isArray(whole)) return whole;
    if (Array.isArray(whole?.drop)) return whole.drop;
  } catch { /* 不是整段 JSON，往下找 */ }
  for (let i = t.indexOf("{"); i !== -1; i = t.indexOf("{", i + 1)) {
    const segment = balancedJsonSegment(t, i);
    if (!segment) continue;
    try {
      const obj = JSON.parse(segment);
      if (Array.isArray(obj?.drop)) return obj.drop;
    } catch { /* 不是合法 JSON，換下一個起點 */ }
  }
  // 「要剔除：[5,6]」這種沒有物件的回應：全文只有一段陣列時才採用。
  if (!t.includes("{")) {
    const start = t.indexOf("[");
    const segment = start === -1 ? null : balancedJsonSegment(t, start);
    if (segment && t.indexOf("[", start + segment.length) === -1) {
      try {
        const arr = JSON.parse(segment);
        if (Array.isArray(arr)) return arr;
      } catch { /* 落到下方錯誤 */ }
    }
  }
  throw new Error(`LLM 回應缺 drop 陣列：${t.slice(0, 120)}`);
}

function balancedJsonSegment(t, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return null;
}

async function reviewBatch(batch, chatFn, prompt = SYSTEM_PROMPT) {
  const lines = batch.map((it, i) => {
    const desc = String(it.description || "").replace(/\s+/g, " ").slice(0, 80);
    return `${i + 1}. ${String(it.title || "").trim()}${desc ? `｜${desc}` : ""}`;
  });
  const text = await chatFn(
    [{ role: "system", content: prompt }, { role: "user", content: lines.join("\n") }],
    { maxTokens: 400, temperature: 0 },
  );
  const ids = new Set(parseDropList(text).map(Number));
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
  const stats = { candidates: 0, cached: 0, reviewed: 0, dropped: 0, moderated: 0, calls: 0, failedBatches: 0, skippedBatches: 0,
    foreignCandidates: 0, foreignDropped: 0 };
  const dropped = new Set();
  // 兩組各自的提示詞與快取鍵：一般相關性（標題無明確案件字眼）、外國候選（明確案件標題也要問）。
  const groups = { relevance: { prompt: SYSTEM_PROMPT, fresh: new Map() }, foreign: { prompt: FOREIGN_PROMPT, fresh: new Map() } };
  const consider = (group, key, it) => {
    stats[group === "foreign" ? "foreignCandidates" : "candidates"]++;
    const cached = verdicts.get(key);
    if (cached) {
      stats.cached++;
      if (!cached.keep) {
        dropped.add(it);
        if (group === "foreign") stats.foreignDropped++;
      }
      return;
    }
    const { fresh } = groups[group];
    if (!fresh.has(key)) fresh.set(key, []);
    fresh.get(key).push(it);
  };
  for (const it of items) {
    const key = titleKey(it?.title);
    if (!key) continue;
    if (isForeignNewsCandidate(it)) consider("foreign", `${FOREIGN_VERDICT_PREFIX}${key}`, it);
    if (it?.official === true || hasStrongCaseTitle(it?.title)) continue;
    consider("relevance", key, it);
  }
  const batches = [];
  for (const [group, { fresh }] of Object.entries(groups)) {
    const keys = [...fresh.keys()];
    for (let i = 0; i < keys.length; i += batchSize) batches.push({ group, keys: keys.slice(i, i + batchSize) });
  }
  const deadline = Date.now() + budgetMs;
  const at = new Date(now).toISOString();
  // 回傳每個標題鍵是否保留。模型對邊界新聞的判斷每次不同：正序、倒序各問一次，兩次都要剔除才剔除；
  // 第一次沒有要剔的就不問第二次（省一半呼叫）。
  // MiniMax 內容審查（HTTP 422 new_sensitive）會擋下整批：對半拆開重問，單則仍被擋就保留並記住，不再重送。
  const judge = async (group, batchKeys) => {
    const { prompt, fresh } = groups[group];
    const ask = (list) => { stats.calls++; return reviewBatch(list, chatFn, prompt); };
    const batchItems = batchKeys.map((k) => fresh.get(k)[0]);
    try {
      const forward = await ask(batchItems);
      if (!forward.size) return batchKeys.map(() => true);
      const backward = await ask([...batchItems].reverse());
      return batchKeys.map((_, i) => !(forward.has(i + 1) && backward.has(batchKeys.length - i)));
    } catch (e) {
      if (!/new_sensitive/.test(String(e?.message || e))) throw e;
      if (batchKeys.length === 1) { stats.moderated++; return [true]; }
      const mid = Math.ceil(batchKeys.length / 2);
      return [...await judge(group, batchKeys.slice(0, mid)), ...await judge(group, batchKeys.slice(mid))];
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
          keeps = await judge(batch.group, batch.keys);
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
      batch.keys.forEach((key, i) => {
        verdicts.set(key, { keep: keeps[i], at });
        stats.reviewed++;
        if (keeps[i]) return;
        for (const it of groups[batch.group].fresh.get(key)) {
          dropped.add(it);
          if (batch.group === "foreign") stats.foreignDropped++; // 以則數計，與 candidates、dropped 一致
        }
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  stats.dropped = dropped.size;
  return { dropped, stats };
}
