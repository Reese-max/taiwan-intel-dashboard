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

  it("GN URL 的 feedStatus 標記 gn true，非 GN feed 不輸出 gn", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(xml, { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRssItems({
      feeds: [
        { label: "GN 測試", url: "https://news.google.com/rss/search?q=test" },
        feed,
      ],
      perFeed: 5,
      timeoutMs: 100,
      retryDelayMs: 0,
    });

    expect(result.feedStatus[0]).toMatchObject({ label: "GN 測試", ok: true, count: 1, gn: true });
    expect(result.feedStatus[1]).toMatchObject({ label: feed.label, ok: true, count: 1 });
    expect(result.feedStatus[1].gn).toBeUndefined();
  });

  it("政府網域 feed 保留官方屬性與地方轄區", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(xml, { status: 200 })));

    const result = await fetchRssItems({
      feeds: [{
        label: "臺中市警局官網",
        url: "https://news.google.com/rss/search?q=site%3Apolice.taichung.gov.tw",
        hint: "治安",
      }],
      perFeed: 5,
      timeoutMs: 100,
      retryDelayMs: 0,
    });

    expect(result.items[0]).toMatchObject({ official: true, jurisdiction: "臺中市" });
  });

  it("套用來源指定時區到未帶時區的發布時間", async () => {
    const localTimeXml = xml.replace(
      "Sun, 05 Jul 2026 00:00:00 GMT",
      "2026-07-17 10:06",
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(localTimeXml, { status: 200 })));

    const result = await fetchRssItems({
      feeds: [{ ...feed, naiveDateOffset: "+08:00" }],
      perFeed: 5,
      timeoutMs: 100,
      retryDelayMs: 0,
    });

    expect(result.items[0].pubDate).toBe("2026-07-17T10:06+08:00");
    expect(new Date(result.items[0].pubDate).toISOString()).toBe("2026-07-17T02:06:00.000Z");
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

describe("fetch-rss fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("主 URL 成功時不打 fallback，feedStatus 不含 fallback", async () => {
    const fallbackUrl = "https://news.google.com/rss/search?q=site%3Arti.org.tw";
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(xml, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRssItems({ feeds: [{ ...feed, fallbackUrl }], perFeed: 5, timeoutMs: 100, retryDelayMs: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.feedStatus[0]).toMatchObject({ label: feed.label, ok: true, count: 1 });
    expect(result.feedStatus[0].fallback).toBeUndefined();
  });

  it("主 URL 403 不重試後改打 fallback，並保留 GN sourceUrl 與 primaryError", async () => {
    const fallbackUrl = "https://news.google.com/rss/search?q=site%3Arti.org.tw";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
      .mockResolvedValueOnce(new Response(xml, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRssItems({ feeds: [{ ...feed, fallbackUrl }], perFeed: 5, timeoutMs: 100, retryDelayMs: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.feedStatus[0]).toMatchObject({ ok: true, fallback: true, primaryError: "HTTP 403", gn: true });
    expect(result.items[0].sourceUrl).toBe(fallbackUrl);
  });

  it("主 URL 403 且 fallback 502 重試一次仍失敗時回報兩段錯誤", async () => {
    const fallbackUrl = "https://news.google.com/rss/search?q=site%3Arti.org.tw";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRssItems({ feeds: [{ ...feed, fallbackUrl }], perFeed: 5, timeoutMs: 100, retryDelayMs: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.feedStatus[0].ok).toBe(false);
    expect(result.feedStatus[0].error).toContain("HTTP 403");
    expect(result.feedStatus[0].error).toContain("HTTP 502");
  });

  it("主 URL 403 且無 fallbackUrl 時維持現行行為", async () => {
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
