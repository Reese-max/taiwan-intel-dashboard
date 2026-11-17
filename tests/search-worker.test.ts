import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import worker from "../static/_worker.js";

const rss = `<rss><channel>
  <item><title><![CDATA[<b>電信</b> &amp; &#x35;G &quot;修復&quot; - 中央社 & 地方]]></title><link>https://example.com/news?a=1&amp;b=2</link><pubDate>Tue, 17 Nov 2026 00:00:00 GMT</pubDate><source url="https://example.com">中央社 &amp; 地方</source></item>
  <item><title>惡意連結</title><link>javascript:alert(1)</link><pubDate>Tue, 17 Nov 2026 00:00:00 GMT</pubDate></item>
  <item><title>其他協定</title><link>ftp://example.com/news</link></item>
</channel></rss>`;
const request = (params = "q=電信&days=7", method = "GET") => new Request(`https://site.test/api/search?${params}`, { method });
const env = { ASSETS: { fetch: vi.fn(async () => new Response("找不到頁面", { status: 404 })) } };
let upstream: ReturnType<typeof vi.fn>;
let cache: { match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
beforeEach(() => {
  upstream = vi.fn(async () => new Response(rss));
  cache = { match: vi.fn(async () => undefined), put: vi.fn(async () => {}) };
  vi.stubGlobal("fetch", upstream);
  vi.stubGlobal("caches", { default: cache });
  env.ASSETS.fetch.mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Google News 站外搜尋端點", () => {
  it("進階模式只攔截搜尋路由", () => {
    expect(JSON.parse(readFileSync("static/_routes.json", "utf8"))).toEqual({ version: 1, include: ["/api/search"], exclude: [] });
  });
  it("解析 RSS、解碼字元與 HTML、去掉標題尾的來源名，排除非 HTTP 連結", async () => {
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ query: "電信", days: 7, upstream: "ok", items: [{
      title: '電信 & 5G "修復"', link: "https://example.com/news?a=1&b=2",
      pubDate: "2026-11-17T00:00:00.000Z", source: "中央社 & 地方",
    }] });
    const url = new URL(String(upstream.mock.calls[0][0]));
    expect(url.origin).toBe("https://news.google.com");
    expect(url.searchParams.get("q")).toBe("電信 when:7d");
    expect(url.searchParams.get("ceid")).toBe("TW:zh-Hant");
    expect(upstream.mock.calls[0][1].redirect).toBe("manual");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(cache.put).toHaveBeenCalledOnce();
    expect(cache.put.mock.calls[0][1].headers.get("cache-control")).toBe("public, max-age=600");
  });

  it.each(["q=&days=7", `q=${"字".repeat(121)}&days=7`, `q=字${"+".repeat(120)}字&days=7`, "q=字%00&days=7", "q=字%0A&days=7", "q=字&days=99", "q=字&days=07", "q=字"])("拒絕無效輸入 %s", async params => {
    expect((await worker.fetch(request(params), env)).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("拒絕 POST，舊路由由靜態資產處理", async () => {
    const response = await worker.fetch(request(undefined, "POST"), env);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect((await worker.fetch(new Request("https://site.test/api/health"), env)).status).toBe(404);
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(upstream).not.toHaveBeenCalled();
  });

  it("上游 429、連線錯誤或非 RSS 仍回傳可降級的 200", async () => {
    const cases: [() => Response, string][] = [
      [() => new Response("限流", { status: 429 }), "HTTP 429"],
      [() => { throw new Error("連線中斷"); }, "連線中斷"],
      [() => new Response("<html>錯誤頁</html>"), "上游不是 RSS"],
      [() => new Response(null, { status: 302, headers: { location: "https://consent.google.com/ml?x=1" } }), "redirect 302 consent.google.com"],
    ];
    for (const [failure, detail] of cases) {
      upstream.mockImplementationOnce(failure);
      const response = await worker.fetch(request(), env);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ upstream: "error", items: [], upstreamDetail: detail });
    }
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("逾時八秒後中止上游請求", async () => {
    vi.useFakeTimers();
    upstream.mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("逾時")));
    }));
    const pending = worker.fetch(request(), env);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await (await pending).json()).toMatchObject({ upstream: "error", items: [] });
  });

  it("正規化快取鍵、命中快取仍回傳五分鐘瀏覽器快取標頭", async () => {
    cache.match.mockResolvedValueOnce(new Response(JSON.stringify({ items: [], upstream: "ok" }), { headers: { "Cache-Control": "public, max-age=600" } }));
    const response = await worker.fetch(request("days=7&q=%20電信%20&unused=x"), env);
    expect(new URL(cache.match.mock.calls[0][0].url).search).toBe("?q=%E9%9B%BB%E4%BF%A1&days=7");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("快取服務失敗時仍可取得搜尋結果", async () => {
    cache.match.mockRejectedValueOnce(new Error("快取讀取失敗"));
    cache.put.mockRejectedValueOnce(new Error("快取寫入失敗"));
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ upstream: "ok", items: [expect.anything()] });
  });

  it("最多回傳三十筆，無效日期不會讓整批失敗", async () => {
    upstream.mockResolvedValueOnce(new Response(`<rss><channel>${Array.from({ length: 35 }, (_, i) => `<item><title>新聞 ${i}</title><link>https://example.com/${i}</link><pubDate>無效日期</pubDate></item>`).join("")}</channel></rss>`));
    const result = await (await worker.fetch(request(), env)).json();
    expect(result.items).toHaveLength(30);
    expect(result.items[0].pubDate).toBeNull();
  });
});
