// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { renderFilterBar, syncFilterBar } from "../src/components/FilterBar";
import { renderEventList } from "../src/components/EventList";
import { renderAiBrief, clusterSummariesForScope, type AiSummary } from "../src/components/AiBrief";
import { renderTopClusters } from "../src/components/TopClusters";
import { getState, setState } from "../src/store";
import { loadTriageAcked, saveTriageAcked } from "../src/utils/triage";
import { safeStorage } from "../src/utils/storage";
import { MapView } from "../src/components/MapView";
import type { IntelEvent } from "../src/types/event";

const event = (id = "甲"): IntelEvent => ({ id, title: `測試${id}`, summary: "測試摘要", region: "臺北市",
  scope: "domestic", category: "治安", riskLevel: "high", lat: 25.03, lng: 121.56,
  timestamp: "2026-11-04T00:00:00Z", source: { name: "測試來源", type: "news-rss", fetchedAt: "2026-11-04T00:00:00Z" } });
const summary: AiSummary = { domestic: "國內摘要", international: "國際摘要", generatedAt: "2026-11-04T00:00:00Z", clusterSummaries: { c0: "甲事件的摘要" } };
const container = () => { const el = document.createElement("div"); document.body.append(el); return el; };

afterEach(() => {
  vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = "";
  setState({ scope: "domestic", query: undefined, sinceDays: 3, category: undefined, region: undefined });
});

describe("前端使用回歸", () => {
  it("自檢：本輪摘要空白時仍顯示上一輪可用摘要與歷史標示", () => {
    const el = container();
    renderAiBrief(el, { ...summary, domestic: "（暫無資料）", degraded: { domestic: true },
      lastSuccessful: { domestic: "上一輪已查證的情勢摘要", generatedAt: "2026-11-03T00:00:00Z", scopeMetadata: { domestic: { generatedAt: "2026-11-03T00:00:00Z" } } } }, "domestic", [event()]);
    expect(el.textContent).toContain("上一輪已查證的情勢摘要");
    expect(el.textContent).toContain("前期摘要");
    expect(el.textContent).not.toContain("AI 摘要生成失敗");
    expect(el.querySelector(".ai-brief-stat-backup")).toBeNull();
    expect(el.textContent).toContain("即時摘要暫時不可用");
  });
  it("自檢：國內有計數但國際無資料時，不誤報國際摘要生成失敗", () => {
    const el = container();
    renderAiBrief(el, { ...summary, international: "（暫無資料）", dailyCounts: [1, 2, 3, 4, 5] }, "international", []);
    expect(el.textContent).toContain("暫無事件資料");
    expect(el.textContent).not.toContain("AI 摘要生成失敗");
  });
  it("U1：localStorage getter 拋 SecurityError 時可載入並保留記憶體已讀狀態", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("拒絕儲存", "SecurityError"); });
    expect(() => loadTriageAcked()).not.toThrow();
    expect(() => saveTriageAcked(["記憶體已讀"])).not.toThrow();
    expect(loadTriageAcked().has("記憶體已讀")).toBe(true);
  });
  it("U1：先讀取的設定在儲存空間被封鎖後仍可從記憶體讀回", () => {
    const get = vi.fn(() => "既存設定");
    const storage = { getItem: get, setItem: vi.fn(), removeItem: vi.fn() } as unknown as Storage;
    vi.spyOn(window, "localStorage", "get").mockReturnValue(storage);
    expect(safeStorage.getItem("讀取回退測試")).toBe("既存設定");
    get.mockImplementation(() => { throw new DOMException("拒絕儲存", "SecurityError"); });
    expect(safeStorage.getItem("讀取回退測試")).toBe("既存設定");
  });
  it("R5：每次優先讀取 localStorage，包含初讀 null、外部分頁更新與清除", () => {
    const storage = new Window().localStorage as Storage;
    vi.spyOn(window, "localStorage", "get").mockReturnValue(storage);
    const key = "R5跨頁更新";
    storage.removeItem(key);
    expect(safeStorage.getItem(key)).toBeNull();
    storage.setItem(key, "第一版");
    expect(safeStorage.getItem(key)).toBe("第一版");
    storage.setItem(key, "第二版");
    expect(safeStorage.getItem(key)).toBe("第二版");
    storage.removeItem(key);
    expect(safeStorage.getItem(key)).toBeNull();
  });
  it("U1：getItem／setItem／removeItem 拒絕存取時仍可修改與移除本頁設定", () => {
    const denied = () => { throw new DOMException("儲存額度不足", "QuotaExceededError"); };
    vi.spyOn(window, "localStorage", "get").mockReturnValue({ getItem: denied, setItem: denied, removeItem: denied } as unknown as Storage);
    expect(safeStorage.getItem("方法回退測試")).toBeNull();
    expect(safeStorage.setItem("方法回退測試", "記憶體設定")).toBe(false);
    expect(safeStorage.getItem("方法回退測試")).toBe("記憶體設定");
    safeStorage.removeItem("方法回退測試"); expect(safeStorage.getItem("方法回退測試")).toBeNull();
  });
  it("U4：脫離 DOM 的國內輸入不能改寫國際搜尋", () => {
    vi.useFakeTimers(); const el = container(); renderFilterBar(el, "domestic");
    const input = el.querySelector<HTMLInputElement>("#f-query")!;
    input.value = "國內舊查詢"; input.dispatchEvent(new Event("input"));
    setState({ scope: "international", query: "國際查詢" }); syncFilterBar(el, getState());
    vi.advanceTimersByTime(200);
    expect(getState().query).toBe("國際查詢");
  });
  it("U8：初載與同步皆顯示非預設的 since=14，且不重複 option", () => {
    setState({ sinceDays: 14 }); const el = container(); renderFilterBar(el, "domestic");
    const select = el.querySelector<HTMLSelectElement>("#f-range")!;
    expect(select.value).toBe("14"); expect(select.selectedOptions[0].textContent).toBe("近 14 天");
    syncFilterBar(el, { ...getState(), sinceDays: 7 }); syncFilterBar(el, { ...getState(), sinceDays: 7 });
    expect(select.value).toBe("7"); expect(select.querySelectorAll('[value="7"]')).toHaveLength(1);
  });
  it("U6：相同內容的新陣列保留已展開脈絡與原鍵盤焦點，內容變更仍會更新", () => {
    const el = container(); const events = [event()]; renderEventList(el, events, { viewKey: "相同視圖" });
    const detail = el.querySelector<HTMLDetailsElement>("details")!; detail.open = true;
    const focus = detail.querySelector<HTMLElement>("summary")!; focus.focus();
    renderEventList(el, structuredClone(events), { viewKey: "相同視圖" });
    expect(el.querySelector("details")).toBe(detail); expect(detail.open).toBe(true); expect(document.activeElement).toBe(focus);
    renderEventList(el, [{ ...events[0], title: "更新標題" }], { viewKey: "相同視圖" });
    expect(el.textContent).toContain("更新標題");
    renderEventList(el, events, { viewKey: "另一視圖" }); expect(el.querySelector("details")).not.toBe(detail);
  });
  it("U6：同資料的佐證改變時仍重繪", () => {
    const el = container(); const events = [event()];
    renderEventList(el, events, { viewKey: "相同視圖", relatedCount: () => 1 });
    renderEventList(el, events, { viewKey: "相同視圖", relatedCount: () => 2 });
    expect(el.querySelector(".rel-link")?.textContent).toContain("2");
  });
  it("U6：清單曾被載入錯誤畫面取代，恢復相同資料時仍重繪", () => {
    const el = container(); const events = [event()]; renderEventList(el, events, { viewKey: "相同視圖" });
    el.innerHTML = "情報載入失敗";
    renderEventList(el, events, { viewKey: "相同視圖" });
    expect(el.textContent).toContain("測試甲");
  });
  it("U3：有成員版本的新快照 c0 不得顯示舊摘要，相同成員才顯示", () => {
    const el = container();
    const versioned = { ...summary, clusterVersions: { c0: JSON.stringify(["甲"]) } };
    const forSnapshot = clusterSummariesForScope;
    renderTopClusters(el, [{ id: "c0", members: ["乙"], size: 1, representativeTitle: "乙事件" }], forSnapshot(versioned, "domestic", "2026-11-04T01:00:00Z", [{ id: "c0", members: ["乙"], size: 1 }]));
    expect(el.textContent).not.toContain("甲事件的摘要");
    expect(forSnapshot(versioned, "domestic", summary.generatedAt, [{ id: "c0", members: ["甲"], size: 1 }])).toEqual(summary.clusterSummaries);
    expect(forSnapshot(versioned, "domestic", "", [])).toEqual({});
  });
  it("R4：舊摘要與網路差 11 分鐘仍顯示", () => {
    expect(clusterSummariesForScope(summary, "domestic", "2026-11-03T23:49:00Z", [{ id: "c0", members: ["甲"], size: 1 }])).toEqual(summary.clusterSummaries);
    expect(clusterSummariesForScope(summary, "domestic", "")).toEqual(summary.clusterSummaries);
  });
  it("R4：新格式未提供 clusters 也維持相容", () => {
    expect(clusterSummariesForScope({ ...summary, clusterVersions: { c0: JSON.stringify(["甲"]) } }, "domestic")).toEqual(summary.clusterSummaries);
  });
  it("U3：摘要生成與網路建置時間不同，以群集成員版本辨識同一事件", () => {
    const versioned = { ...summary, clusterVersions: { c0: JSON.stringify(["乙", "甲"]) } };
    const forSnapshot = clusterSummariesForScope;
    expect(forSnapshot(versioned, "domestic", "2026-11-04T01:00:00Z", [{ id: "c0", members: ["甲", "乙"], size: 2 }])).toEqual(summary.clusterSummaries);
    expect(forSnapshot(versioned, "domestic", summary.generatedAt, [{ id: "c0", members: ["丙", "丁"], size: 2 }])).toEqual({});
  });
  it("U9：其餘分類展開後的 textContent 包含完整文字與尾段", () => {
    const el = container(); const full = "這是第二個原始分類摘要。".repeat(10) + "不可遺失的最後一句。";
    renderAiBrief(el, { ...summary, byCategory: { 治安: "第一段", 災防: full } }, "domestic");
    const rest = el.querySelector<HTMLDetailsElement>(".ai-cats-more")!; rest.open = true;
    expect(rest.querySelector(".ai-cat-row")?.textContent).toContain(full);
  });
});

describe("地圖群集實際 Leaflet 互動", () => {
  async function mapAt(zoom: number) {
    vi.useFakeTimers();
    const el = container(); Object.defineProperties(el, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    const view = new MapView(el);
    await view.render([event("甲"), event("乙")]);
    const internals = view as unknown as { map: import("leaflet").Map; layer: import("leaflet").LayerGroup; redraw(): void };
    internals.map.setView([25.03, 121.56], zoom, { animate: false }); internals.redraw();
    return { el, map: internals.map, layer: internals.layer };
  }
  it.each([13, 18, 19])("U5：zoom=%i 的放大按鈕與雙擊均不會拉遠", async (zoom) => {
    const { el, map, layer } = await mapAt(zoom);
    try {
      const marker = layer.getLayers()[0] as import("leaflet").Marker;
      const fly = vi.spyOn(map, "flyTo").mockReturnValue(map);
      marker.fire("dblclick"); expect(fly.mock.calls[0][1]).toBe(Math.min(zoom + 2, 19));
      marker.openPopup(); marker.fire("popupopen"); el.querySelector<HTMLButtonElement>(".map-cluster-zoom")!.click();
      expect(fly.mock.calls.at(-1)![1]).toBe(Math.min(zoom + 2, 19));
    } finally { await Promise.resolve(); map.off(); map.remove(); vi.clearAllTimers(); }
  });
  it("U7：群集可 Tab 聚焦，具有可讀名稱，Enter 開 popup", async () => {
    const { el, map } = await mapAt(14);
    try {
      const marker = el.querySelector<HTMLElement>(".leaflet-marker-icon")!;
      expect(marker.tabIndex).toBe(0); expect(marker.title).toBe("2 筆事件群集");
      expect(marker.getAttribute("aria-label")).toBe("2 筆事件群集");
      marker.focus(); expect(document.activeElement).toBe(marker);
      marker.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", keyCode: 13, bubbles: true }));
      expect(el.querySelector(".leaflet-popup")?.textContent).toContain("此區有 2 則情報");
    } finally { await Promise.resolve(); map.off(); map.remove(); vi.clearAllTimers(); }
  });
  it("R7：Enter 開啟、Escape 關閉後重繪仍聚焦原位置群集，可再次開啟", async () => {
    const { el, map } = await mapAt(14);
    try {
      const marker = el.querySelector<HTMLElement>(".leaflet-marker-icon")!;
      marker.focus();
      marker.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", keyCode: 13, bubbles: true }));
      expect(el.querySelector(".leaflet-popup")).not.toBeNull();
      // happy-dom 不模擬地圖容器的瀏覽器焦點事件；啟用 Leaflet 原生鍵盤 handler。
      map.fire("focus");
      marker.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
      await Promise.resolve();
      expect(el.querySelector(".leaflet-popup")).toBeNull();
      const restored = el.querySelector<HTMLElement>(".leaflet-marker-icon")!;
      expect(restored).not.toBe(marker);
      expect(document.activeElement).toBe(restored);
      restored.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", keyCode: 13, bubbles: true }));
      expect(el.querySelector(".leaflet-popup")).not.toBeNull();
    } finally { await Promise.resolve(); map.off(); map.remove(); vi.clearAllTimers(); }
  });
});
