import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCgaMaritime, fetchTaipowerSupply } from "../scripts/lib/fetch-official.mjs";
import { fetchMofaTravelWarnings } from "../scripts/lib/fetch-mofa.mjs";

const sources = [
  { name: "台電", run: () => fetchTaipowerSupply(), body: JSON.stringify({ records: [{ fore_peak_resv_rate: "15" }] }), timeout: 30000 },
  { name: "海巡", run: () => fetchCgaMaritime(), body: '<a href="ct?xItem=123&amp;ctNode=650">海巡救援落海漁民</a>', timeout: 30000 },
  { name: "外交部", run: () => fetchMofaTravelWarnings(), body: '<rss><channel><item><title>第四級：紅色 - 測試地區</title><link>https://example.test/warning</link></item></channel></rss>', timeout: 12000 },
];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(sources)("$name 暫時性網路錯誤", ({ run, body, timeout }) => {
  it.each([
    Object.assign(new Error("連線重設"), { code: "ECONNRESET" }),
    new TypeError("fetch failed", { cause: Object.assign(new Error("連線逾時"), { code: "UND_ERR_CONNECT_TIMEOUT" }) }),
    Object.assign(new Error("中止"), { name: "AbortError" }),
  ])("第一次失敗後等待兩秒，僅重試一次並成功：%s", async (error) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(new Response(body));
    vi.stubGlobal("fetch", fetchMock);
    const result = run().then((events) => ({ events }), (error) => ({ error }));
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ events: [expect.any(Object)] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([403, 500])("HTTP %s 不重試", async (status) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response("錯誤", { status }));
    vi.stubGlobal("fetch", fetchMock);
    const result = run().catch((error) => error);
    await vi.runAllTimersAsync();
    expect(await result).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("連續逾時包含等待不超過原 timeout 兩倍", async () => {
    vi.useFakeTimers();
    // 原生 AbortSignal.timeout 不使用假時鐘，將它接到相同的測試計時器。
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    const fetchMock = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("逾時"), { name: "AbortError" })), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    let finished = false;
    const result = run().catch((error) => error).finally(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(timeout * 2);
    expect(finished).toBe(true);
    expect(await result).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
