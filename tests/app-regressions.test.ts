// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import type { IntelEvent } from "../src/types/event";
import type { CohortManifest } from "../src/data/manifest";
import type { NetworkIndex } from "../src/data/network";

const h = vi.hoisted(() => ({
  events: [] as IntelEvent[], net: null as NetworkIndex | null, manifest: null as CohortManifest | null,
  summary: null as Record<string, unknown> | null,
  failInternational: false, renders: [] as { events: IntelEvent[]; scope: string }[],
}));
const removeListeners: (() => void)[] = [];
vi.mock("../src/components/MapView", () => ({
  isMapDisplayable: (e: IntelEvent) => e.lat != null && e.lng != null,
  MapView: class {
    async render(events: IntelEvent[], scope: string) { h.renders.push({ events, scope }); }
    async closePopup() {} async resize() {} async reveal() {} async locateEvent() { return true; }
  },
}));
vi.mock("../src/data/loader", async (original) => ({
  ...await original<typeof import("../src/data/loader")>(),
  loadEvents: vi.fn(async (scope: string) => {
    if (scope === "international" && h.failInternational) throw Error("測試國際載入失敗");
    return scope === "domestic" ? h.events : [];
  }),
  loadFirstPaintHeadEvents: async () => null, loadFirstPaintMapEvents: async () => null,
}));
vi.mock("../src/data/network", async (original) => ({
  ...await original<typeof import("../src/data/network")>(), loadNetwork: async () => h.net,
}));
vi.mock("../src/data/manifest", async (original) => ({
  ...await original<typeof import("../src/data/manifest")>(),
  loadManifest: async () => h.manifest, createManifestLoader: () => async () => h.manifest,
}));

async function snapshot(version: string, generatedAt: string) {
  const { NetworkIndex } = await import("../src/data/network");
  h.events = [{ id: version, title: `${version}事件`, summary: "測試資料", scope: "domestic", category: "治安", region: "臺北市",
    lat: 25.03, lng: 121.56, riskLevel: "high", timestamp: new Date().toISOString(),
    source: { name: "測試來源", type: "news-rss", fetchedAt: new Date().toISOString() } }];
  h.events.push({ ...h.events[0], id: version + "2" });
  h.net = new NetworkIndex({ nodes: [], edges: [{ a: version, b: version + "2", type: "same-entity", weight: 0.8, why: "測試關聯" }], stats: {}, clusters: [{ id: "c0", size: 2, members: [version, version + "2"], representativeTitle: `${version}情報群` }] }, { generatedAt, snapshotId: version });
  h.manifest = { manifestVersion: 1, snapshotId: version, generatedAt, rulesVersion: "測試版", files: {}, scopes: {
    domestic: { events: "domestic.json", network: "network.json", map: "domestic.map.json" },
    international: { events: "international.json", network: "network.json", map: "international.map.json" },
  } };
}
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation((type, listener, options) => {
      add(type, listener, options);
      removeListeners.push(() => target.removeEventListener(type, listener, options));
    });
  }
  vi.spyOn(window, "localStorage", "get").mockReturnValue(new Window().localStorage as Storage);
  document.body.innerHTML = '<div id="app"></div>'; window.location.hash = ""; window.localStorage.clear();
  h.failInternational = false; h.renders = [];
  await snapshot("甲", "2026-11-04T00:00:00Z");
  h.summary = { domestic: "國內摘要", international: "國際摘要", generatedAt: "2026-11-04T00:00:00Z", clusterSummaries: { c0: "甲事件的舊群摘要" }, clusterVersions: { c0: JSON.stringify(["甲", "甲2"]) } };
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => String(url).includes("summary.json") && h.summary
    ? new Response(JSON.stringify(h.summary)) : new Response("不可用", { status: 404 })));
});
afterEach(() => { removeListeners.splice(0).forEach((remove) => remove()); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

describe("主程式整合回歸", () => {
  it("U1：封鎖 storage getter 後仍初始化、顯示資料且可關閉使用提示", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("拒絕儲存", "SecurityError"); });
    await import("../src/main");
    await vi.waitFor(() => expect(document.querySelector("#eventlist")?.textContent).toContain("甲事件"));
    const tip = document.querySelector<HTMLElement>("#usage-tip")!;
    expect(tip.hidden).toBe(false); document.querySelector<HTMLButtonElement>("#close-tip")!.click(); expect(tip.hidden).toBe(true);
    document.querySelector<HTMLButtonElement>("#compact-layout-toggle")!.click();
    expect(document.body.classList.contains("layout-compact")).toBe(true);
    expect(document.querySelector("#triageinbox .triage-storage-warning")?.textContent).toContain("儲存受限");
  });
  it("R5：getter 可讀但 setItem 從啟動就失敗時，首屏顯示儲存受限", async () => {
    const storage = new Window().localStorage as Storage;
    vi.spyOn(storage, "setItem").mockImplementation(() => { throw new DOMException("儲存額度不足", "QuotaExceededError"); });
    vi.spyOn(window, "localStorage", "get").mockReturnValue(storage);
    await import("../src/main");
    await vi.waitFor(() => expect(document.querySelector("#eventlist")?.textContent).toContain("甲事件"));
    expect(document.querySelector("#triageinbox .triage-storage-warning")?.textContent).toContain("儲存受限");
  });
  it("R6：國際失敗後離線切回國內，保留已成功的 provenance 快取", async () => {
    const provenance = { generatedAt: new Date().toISOString(), sources: [
      { name: "官方測試", scope: "domestic", type: "gov-open-data", fetchedAt: new Date().toISOString() },
    ] };
    let offline = false;
    const fetch = vi.fn(async (url: unknown) => {
      if (offline) throw Error("offline");
      return new Response(JSON.stringify(String(url).includes("summary.json") ? h.summary : provenance));
    });
    vi.stubGlobal("fetch", fetch);
    await import("../src/main");
    await vi.waitFor(() => expect(document.querySelector("#kpistrip")?.textContent).toContain("100%"));
    const requests = fetch.mock.calls.filter(([url]) => String(url).includes("provenance.json")).length;
    offline = true; h.failInternational = true;
    document.querySelector<HTMLButtonElement>('[data-scope="international"]')!.click();
    await vi.waitFor(() => expect(document.querySelector("#eventlist")?.textContent).toContain("情報載入失敗"));
    document.querySelector<HTMLButtonElement>('[data-scope="domestic"]')!.click();
    await vi.waitFor(() => expect(document.querySelector("#eventlist")?.textContent).toContain("甲事件"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector("#kpistrip")?.textContent).toContain("100%");
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("provenance.json"))).toHaveLength(requests);
  });
  it("R6：取消進行中 KPI 渲染，延遲 provenance 不覆蓋錯誤畫面且可供切回國內使用", async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    let requests = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
      if (String(url).includes("summary.json")) return new Response(JSON.stringify(h.summary));
      if (++requests > 1) throw Error("offline");
      return pending;
    }));
    await import("../src/main");
    await vi.waitFor(() => expect(document.querySelector("#eventlist")?.textContent).toContain("甲事件"));
    h.failInternational = true;
    document.querySelector<HTMLButtonElement>('[data-scope="international"]')!.click();
    await vi.waitFor(() => expect(document.querySelector("#kpistrip")?.textContent).toContain("情報載入失敗"));
    release(new Response(JSON.stringify({ generatedAt: new Date().toISOString(), sources: [
      { name: "官方測試", scope: "domestic", type: "gov-open-data", fetchedAt: new Date().toISOString() },
    ] })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector("#kpistrip")?.textContent).toContain("情報載入失敗");
    document.querySelector<HTMLButtonElement>('[data-scope="domestic"]')!.click();
    await vi.waitFor(() => expect(document.querySelector("#kpistrip")?.textContent).toContain("100%"));
    expect(requests).toBe(1);
  });
  it("U2：國際載入失敗清除國內的地圖、指標與側欄，切回國內能恢復", async () => {
    await import("../src/main");
    await vi.waitFor(() => expect(document.querySelector("#topclusters")?.textContent).toContain("甲情報群"));
    h.failInternational = true; document.querySelector<HTMLButtonElement>('[data-scope="international"]')!.click();
    await vi.waitFor(() => expect(document.querySelector("#eventlist")?.textContent).toContain("情報載入失敗"));
    for (const id of ["kpistrip", "topclusters", "aibrief", "timeline", "triageinbox"]) {
      expect(document.getElementById(id)?.textContent).not.toContain("甲");
    }
    expect(document.querySelector("#kpistrip")?.textContent).toContain("載入失敗");
    expect(h.renders.at(-1)).toEqual({ scope: "international", events: [] });
    document.querySelector<HTMLButtonElement>('[data-scope="domestic"]')!.click();
    await vi.waitFor(() => expect(document.querySelector("#topclusters")?.textContent).toContain("甲情報群"));
    expect(h.renders.at(-1)?.events[0].id).toBe("甲");
    expect(document.querySelector("#eventlist")?.textContent).toContain("甲事件");
  });
  it("U3：輪詢換快照且摘要請求失敗時，TopClusters 與聚焦群都移除舊摘要", async () => {
    await import("../src/main");
    await vi.waitFor(() => expect(document.querySelector("#topclusters")?.textContent).toContain("甲事件的舊群摘要"));
    await snapshot("乙", "2026-11-04T01:00:00Z"); h.summary = null;
    vi.advanceTimersByTime(300_000);
    await vi.waitFor(() => expect(document.querySelector("#topclusters")?.textContent).toContain("乙情報群"));
    expect(document.querySelector("#topclusters")?.textContent).not.toContain("甲事件的舊群摘要");
    document.querySelector<HTMLButtonElement>('[data-cluster="c0"]')!.click();
    await vi.waitFor(() => expect(document.querySelector("#relationgraph")?.textContent).toContain("情報群網絡"));
    expect(document.querySelector("#relationgraph")?.textContent).not.toContain("甲事件的舊群摘要");
  });
  it("U4：200ms 內切換範圍後，舊搜尋不會進入國際 URL", async () => {
    await import("../src/main");
    await vi.waitFor(() => expect(document.querySelector("#eventlist")?.textContent).toContain("甲事件"));
    const input = document.querySelector<HTMLInputElement>("#f-query")!;
    input.value = "國內舊查詢"; input.dispatchEvent(new Event("input"));
    document.querySelector<HTMLButtonElement>('[data-scope="international"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const params = new URLSearchParams(window.location.hash.slice(1));
    expect(params.get("scope")).toBe("international"); expect(params.get("q")).toBeNull();
  });
  it("U8：URL since=14 初載時選單正確顯示近 14 天", async () => {
    window.history.replaceState(null, "", "/#scope=domestic&since=14");
    await import("../src/main");
    await vi.waitFor(() => expect(document.querySelector("#eventlist")?.textContent).toContain("甲事件"));
    const select = document.querySelector<HTMLSelectElement>("#f-range")!;
    expect(select.value).toBe("14"); expect(select.selectedOptions[0].textContent).toBe("近 14 天");
  });
});
