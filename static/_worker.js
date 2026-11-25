const DAYS = new Set(["1", "2", "3", "7", "30"]);
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };

function plainText(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, key) => {
      if (!key.startsWith("#")) return ENTITIES[key.toLowerCase()] ?? entity;
      const code = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
    }).replace(/<[^>]*>/g, "").trim();
}

function parseRss(xml) {
  if (!/<rss\b/i.test(xml) || !/<channel\b/i.test(xml)) throw new Error("上游不是 RSS");
  const items = [];
  for (const [, body] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const tag = name => plainText(body.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] ?? "");
    const source = tag("source");
    // Google News 會在標題尾加「 - 來源」；去掉才能和站內標題比對重複。
    const fullTitle = tag("title");
    const title = source && fullTitle.endsWith(` - ${source}`) ? fullTitle.slice(0, -(source.length + 3)).trim() : fullTitle;
    let link;
    try {
      link = new URL(tag("link"));
      if (!["http:", "https:"].includes(link.protocol)) continue;
    } catch { continue; }
    if (!title) continue;
    const date = Date.parse(tag("pubDate"));
    items.push({ title, link: link.href, pubDate: Number.isFinite(date) ? new Date(date).toISOString() : null, source });
    if (items.length === 30) break;
  }
  return items;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/search") return env.ASSETS.fetch(request);
    if (request.method !== "GET") return json({ error: "僅接受 GET" }, 405, { Allow: "GET" });
    const raw = url.searchParams.get("q") ?? "";
    const query = raw.trim().replace(/\s+/gu, " ");
    const daysText = url.searchParams.get("days");
    if (!query || [...raw.trim()].length > 120 || /[\p{Cc}\p{Cf}]/u.test(raw) || !DAYS.has(daysText)) {
      return json({ error: "查詢須為 1–120 字且不得含控制字元；天數須為 1、2、3、7 或 30" }, 400);
    }
    const days = Number(daysText);
    const key = new Request(`${url.origin}/api/search?${new URLSearchParams({ q: query, days: daysText })}`);
    const cache = globalThis.caches?.default;
    try {
      const cached = await cache?.match(key);
      if (cached) {
        const response = new Response(cached.body, cached);
        response.headers.set("Cache-Control", "public, max-age=300");
        return response;
      }
    } catch { /* 快取不可用時仍可查詢上游。 */ }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let items = [];
    let upstream = "ok";
    let upstreamDetail;
    try {
      // Google 依 Cloudflare 出口 IP 回 429／503（2026-11-25 實測）；改經自有主機固定轉發，轉發端只組 Google News RSS 搜尋網址。
      const params = new URLSearchParams({ q: query, days: daysText });
      const response = await fetch(`https://video-mcp-a1.tail930e77.ts.net/gnews?${params}`, { signal: controller.signal, redirect: "manual" });
      // 不跟隨轉址（上游寫死防 SSRF）；只回報狀態碼與轉址主機供診斷。
      if (response.status >= 300 && response.status < 400) {
        let host = "";
        try { host = new URL(response.headers.get("location") || "").hostname; } catch { /* 無效 location */ }
        throw new Error(`redirect ${response.status}${host ? ` ${host}` : ""}`);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      items = parseRss(await response.text());
    } catch (error) {
      upstream = "error";
      upstreamDetail = error?.name === "AbortError" ? "timeout" : String(error?.message || "error").slice(0, 80);
    } finally {
      clearTimeout(timer);
    }
    const response = json({ query, days, fetchedAt: new Date().toISOString(), items, upstream, ...(upstreamDetail ? { upstreamDetail } : {}) }, 200, { "Cache-Control": "public, max-age=300" });
    if (upstream === "ok" && cache) {
      const cached = response.clone();
      cached.headers.set("Cache-Control", "public, max-age=600");
      try { await cache.put(key, cached); } catch { /* 快取寫入失敗不影響搜尋結果。 */ }
    }
    return response;
  },
};
