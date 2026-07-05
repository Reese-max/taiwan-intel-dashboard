import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error — JS ESM module without types
import { fetchRssItems, isRetriableFetchError } from "../scripts/lib/fetch-rss.mjs";

const feed = { label: "測試 RSS", url: "https://example.com/rss.xml" };
const xml = `<?xml version="1.0"?><rss><channel><item><title>測試新聞</title><link>https://example.com/news/1</link><pubDate>Sun, 05 Jul 2026 00:00:00 GMT</pubDate></item></channel></rss>`;

describe("fetch-rss retry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("isRetriableFetchError 只接受暫時性失敗", () => {
    expect(isRetriableFetchError(500)).toBe(true);
    expect(isRetriableFetchError(503)).toBe(true);
    expect(isRetriableFetchError(403)).toBe(false);
    expect(isRetriableFetchError(404)).toBe(false);
    expect(isRetriableFetchError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
    expect(isRetriableFetchError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetriableFetchError(new Error("HTTP 403"))).toBe(false);
  });

  it("HTTP 5xx 第一次失敗時退避重試一次並回傳第二次成功結果", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("upstream unavailable", { status: 502 }))
      .mockResolvedValueOnce(new Response(xml, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRssItems({ feeds: [feed], perFeed: 5, timeoutMs: 100, retryDelayMs: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.feedStatus[0]).toMatchObject({ label: feed.label, ok: true, count: 1 });
    expect(result.items[0]).toMatchObject({ title: "測試新聞", link: "https://example.com/news/1" });
  });

  it("AbortError 第一次失敗時退避重試一次並回傳第二次成功結果", async () => {
    const abortError = Object.assign(new Error("operation aborted"), { name: "AbortError" });
    const fetchMock = vi.fn().mockRejectedValueOnce(abortError).mockResolvedValueOnce(new Response(xml, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRssItems({ feeds: [feed], perFeed: 5, timeoutMs: 100, retryDelayMs: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.feedStatus[0]).toMatchObject({ ok: true, count: 1 });
  });

  it("HTTP 4xx 不重試並保留原失敗結果", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
      .mockResolvedValueOnce(new Response(xml, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRssItems({ feeds: [feed], perFeed: 5, timeoutMs: 100, retryDelayMs: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.feedStatus[0]).toMatchObject({ label: feed.label, ok: false, count: 0, error: "HTTP 403" });
    expect(result.items).toEqual([]);
  });
});
