// LLM（OpenAI 相容端點）通訊基礎建設：請求 profile、並發閘、重試、JSON 解析。

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
export function profileCfg(profile) {
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
  // fallback：primary 失敗時的備援端點（設 LLM_FALLBACK_* 才啟用；未設 → 落到下方 primary，
  // chat() 以 name 判斷未配置）。防單一供應商全面異常（實測 MiniMax 曾偶發全批失敗）。
  const fallbackOn = process.env.LLM_FALLBACK_API_KEY || process.env.LLM_FALLBACK_BASE_URL;
  if (profile === "fallback" && fallbackOn) {
    return {
      name: "fallback",
      base: process.env.LLM_FALLBACK_BASE_URL || process.env.LLM_BASE_URL || process.env.NVIDIA_BASE_URL,
      key: process.env.LLM_FALLBACK_API_KEY || process.env.LLM_API_KEY || process.env.NVIDIA_API_KEY,
      model: process.env.LLM_FALLBACK_MODEL || llmModel(),
      maxConc: Math.max(1, Number(process.env.LLM_FALLBACK_MAX_CONCURRENCY) || 2),
      timeout: Math.max(1000, Number(process.env.LLM_FALLBACK_TIMEOUT_MS) || 90000),
      retries: Math.max(0, Number(process.env.LLM_FALLBACK_MAX_RETRIES ?? 1)),
    };
  }
  // primary（也是 summary / fallback 未配置時的 fallback）
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
export function makeGate(max) {
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

export const llmGates = {};
export const gateFor = (c) => (llmGates[c.name] ||= makeGate(c.maxConc));

// 對單一端點發請求（含並發閘 / 逾時 / 重試）。回空字串＝推理被截斷無有效輸出。
export async function chatVia(c, messages, maxTokens, temperature) {
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
export async function chat(messages, { maxTokens = 1024, temperature = 0.3, profile = "primary" } = {}) {
  const c = profileCfg(profile);
  const primary = profileCfg("primary");
  const hasFallback = profile === "summary" && c.name !== primary.name;
  // primary 的備援：LLM_FALLBACK_* 有配置才啟用（profileCfg 未配置時回 primary，以 name 判斷）。
  const fb = profile === "primary" ? profileCfg("fallback") : null;
  const hasPrimaryFallback = !!fb && fb.name === "fallback";
  const viaFallback = async (why) => {
    console.warn(`primary LLM ${why}，改走 fallback 端點（${fb.model || fb.base}）`);
    return chatVia(fb, messages, maxTokens, temperature);
  };
  try {
    const out = await chatVia(c, messages, maxTokens, temperature);
    if (!out && hasFallback) return await chatVia(primary, messages, maxTokens, temperature);
    if (!out && hasPrimaryFallback) return await viaFallback("空輸出（推理截斷）");
    return out;
  } catch (e) {
    if (hasFallback) return await chatVia(primary, messages, maxTokens, temperature);
    if (hasPrimaryFallback) return await viaFallback(`失敗（${String(e?.message || e).slice(0, 120)}）`);
    throw e;
  }
}

// 從回應中萃取 JSON（容忍 ```json 圍欄與前後雜訊）
export function extractJson(text) {
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

export { sleep };
