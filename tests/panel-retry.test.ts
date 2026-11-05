import { afterEach, describe, expect, it, vi } from "vitest";
import { renderPoliceHealthPanel } from "../src/components/PoliceHealthPanel";
import { renderSourcePanel } from "../src/components/SourcePanel";
import { invalidateProvenanceCache, renderKpiStrip } from "../src/components/KpiStrip";

afterEach(() => { vi.unstubAllGlobals(); invalidateProvenanceCache(); });

const provenance = () => ({ generatedAt: new Date().toISOString(), sources: [] });
function container() {
  let retry: (() => void) | undefined;
  const button = { addEventListener: (_type: string, fn: () => void) => { retry = fn; } };
  const el = { innerHTML: "", querySelector: (selector: string) => {
    const attribute = /^\[(data-reload-health|data-retry-source)\]$/.exec(selector)?.[1];
    return attribute && new RegExp(`<button\\b[^>]*\\s${attribute}(?=[\\s=>])`).test(el.innerHTML) ? button : null;
  }, querySelectorAll: () => [] } as unknown as HTMLElement;
  return { el, retry: () => retry?.() };
}

for (const [name, render] of [["警政健康檢查", renderPoliceHealthPanel], ["來源總覽", renderSourcePanel]] as const) {
  describe(`${name} 失敗與重試`, () => {
    it("重試交給呼叫端提供的 lazy 狀態機，不另發請求", async () => {
      const fetch = vi.fn(async () => new Response("unavailable", { status: 503 }));
      vi.stubGlobal("fetch", fetch);
      const { el, retry } = container();
      const onReload = vi.fn();
      expect(await render(el, onReload)).toBe(false);
      const requests = fetch.mock.calls.length;
      retry();
      expect(onReload).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledTimes(requests);
    });

    it.each(["network", "http", "json"])("%s 失敗回傳 false 並提供可恢復的重試", async (failure) => {
      let fail = true;
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        if (!url.includes("provenance")) return new Response(JSON.stringify({ runs: [] }));
        if (fail && failure === "network") throw new Error("offline");
        if (fail && failure === "http") return new Response("unavailable", { status: 503 });
        if (fail && failure === "json") return new Response("{broken");
        return new Response(JSON.stringify(provenance()));
      }));
      const { el, retry } = container();
      expect(await render(el)).toBe(false);
      expect(el.innerHTML).toContain("請重試");
      expect(el.innerHTML).toContain("<button");
      const attribute = name === "來源總覽" ? "data-retry-source" : "data-reload-health";
      expect(el.querySelector(`[${attribute}]`)).not.toBeNull();
      expect(el.querySelector(`[${attribute}-typo]`)).toBeNull();
      expect(el.querySelector(name === "來源總覽" ? "[data-reload-health]" : "[data-retry-source]")).toBeNull();
      fail = false;
      retry();
      await vi.waitFor(() => expect(el.innerHTML).toContain('class="' + (name === "來源總覽" ? "source-card" : "police-health-card") + '"'));
    });
  });
}

it("成功的健康面板重新載入也交給呼叫端狀態機", async () => {
  const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("provenance") ? provenance() : { runs: [] })));
  vi.stubGlobal("fetch", fetch);
  const { el, retry } = container();
  const onReload = vi.fn();
  expect(await renderPoliceHealthPanel(el, onReload)).toBe(true);
  const requests = fetch.mock.calls.length;
  retry();
  expect(onReload).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(requests);
});

it("健康重新載入只讀取靜態資料，沒有 POST 或終端機操作", async () => {
  const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("provenance") ? provenance() : { runs: [] })));
  vi.stubGlobal("fetch", fetch);
  const { el, retry } = container();
  expect(await renderPoliceHealthPanel(el)).toBe(true);
  expect(el.innerHTML).toContain("重新載入健康資料");
  expect(el.innerHTML).not.toContain("失敗來源重試");
  expect(el.innerHTML).not.toContain("npm run");
  retry();
  await vi.waitFor(() => expect(fetch.mock.calls.filter(([url]) => url.includes("provenance"))).toHaveLength(2));
  expect(fetch.mock.calls.every(([url]) => url.startsWith("./data/"))).toBe(true);
  expect(fetch.mock.calls.some((call) => (call as unknown as [string, RequestInit])[1]?.method === "POST")).toBe(false);
});

it("新快照使 KPI provenance 失效，舊的延遲回應不能覆寫新快取", async () => {
  invalidateProvenanceCache();
  let release!: (res: Response) => void;
  const old = new Promise<Response>((resolve) => { release = resolve; });
  let calls = 0;
  const current = { generatedAt: new Date().toISOString(), sources: [
    { name: "current", scope: "domestic", type: "gov-open-data", fetchedAt: new Date().toISOString() },
  ] };
  vi.stubGlobal("fetch", vi.fn(() => ++calls === 1 ? old : Promise.resolve(new Response(JSON.stringify(current)))));
  const el = { innerHTML: "", querySelector: () => null } as unknown as HTMLElement;
  renderKpiStrip(el, [], "domestic");
  invalidateProvenanceCache();
  renderKpiStrip(el, [], "domestic");
  await vi.waitFor(() => expect(el.innerHTML).toContain("100%"));
  release(new Response(JSON.stringify(provenance())));
  await old;
  await new Promise((resolve) => setTimeout(resolve, 0));
  renderKpiStrip(el, [], "domestic");
  expect(calls).toBe(2);
  expect(el.innerHTML).toContain("100%");
});
