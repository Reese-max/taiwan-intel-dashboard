import { afterEach, describe, expect, it, vi } from "vitest";
import { renderFilterBar, syncFilterBar, regionCounts } from "../src/components/FilterBar";
import { renderTimeline } from "../src/components/TimelineView";
import { eventDay, filterEvents, explainOutOfFilter } from "../src/data/loader";
import { scopeDataVersion, type CohortManifest } from "../src/data/manifest";
import { NETWORK_FETCH_TIMEOUT_MS, loadNetwork } from "../src/data/network";
import { clusterGridPoint, CLUSTER_CELL_SIZE, CLUSTER_HIT_SIZE, clusterPopupHtml } from "../src/components/MapView";
import { DEFAULT_SINCE_DAYS, getState, setState } from "../src/store";
import type { IntelEvent } from "../src/types/event";

const event = (patch: Partial<IntelEvent> = {}): IntelEvent => ({
  id: "fixture", title: "合成測試事件", summary: "測試", region: "臺北市", category: "治安",
  scope: "domestic", riskLevel: "high", timestamp: new Date().toISOString(),
  source: { name: "合成來源", type: "manual", fetchedAt: new Date().toISOString() }, ...patch,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setState({ scope: "domestic", category: undefined, minRisk: undefined, region: undefined, day: undefined,
    newsAuthority: undefined, sinceDays: 3, query: undefined });
});

describe("篩選與時間軸同步", () => {
  it("地區依目前 scope 實際筆數排序並排除模糊地區", () => {
    expect(regionCounts([event(), event({ region: "臺中市" }), event({ region: " 台中市 " }),
      event({ region: "全國" }), event({ region: "UNKNOWN" }), event({ region: "全球", scope: "international" })], "domestic"))
      .toEqual([["臺中市", 2], ["臺北市", 1]]);
  });

  it("程式變更風險及地區會同步控制項，保留正在輸入的搜尋框與焦點", () => {
    const refs = Object.fromEntries(["f-cat", "f-risk", "f-range", "f-authority", "f-region", "f-query", "region-chip-slot"]
      .map((key) => ["#" + key, { value: "", innerHTML: "", onchange: null as null | (() => void) }]));
    const container = { innerHTML: "", querySelector: (selector: string) => refs[selector] ?? null } as unknown as HTMLElement;
    renderFilterBar(container, "domestic", [event()]);
    const query = refs["#f-query"];
    query.value = "尚未送出的搜尋";
    const doc = { activeElement: query };
    vi.stubGlobal("document", doc);
    setState({ minRisk: "high", region: "臺北市", query: "前次查詢" });
    syncFilterBar(container, getState(), [event()]);
    expect(refs["#f-risk"].value).toBe("high");
    expect(refs["#f-region"].value).toBe("臺北市");
    expect(refs["#region-chip-slot"].innerHTML).toContain("臺北市");
    expect(query.value).toBe("尚未送出的搜尋");
    expect(doc.activeElement).toBe(query);
    refs["#f-region"].value = "";
    refs["#f-region"].onchange?.();
    expect(getState().region).toBeUndefined();
    setState({ minRisk: undefined });
    syncFilterBar(container, getState());
    expect(refs["#f-risk"].value).toBe("");
  });

  it("地區名稱插入 HTML 前跳脫", () => {
    const refs = { value: "", innerHTML: "", onchange: null };
    const el = { innerHTML: "", querySelector: (s: string) => s === "#f-region" ? refs : { value: "" } } as unknown as HTMLElement;
    renderFilterBar(el, "domestic", [event({ region: '<img src=x onerror="bad">' })]);
    expect(refs.innerHTML).not.toContain("<img");
    expect(refs.innerHTML).toContain("&lt;img");
  });

  it("時間軸以原生 button 操作日期，再點一次取消；日期與其餘條件一起篩選", () => {
    const today = eventDay(Date.now());
    const button = { dataset: { day: today }, onclick: undefined as (() => void) | undefined };
    const el = { innerHTML: "", querySelectorAll: () => [button] } as unknown as HTMLElement;
    renderTimeline(el, [event()]);
    expect(el.innerHTML).toContain('<button type="button" class="tl-bar"');
    button.onclick?.();
    expect(getState().day).toBe(today);
    expect(getState().sinceDays).toBeUndefined();
    const previous = event({ id: "yesterday", timestamp: new Date(Date.now() - 86400000).toISOString() });
    expect(filterEvents([event(), previous], { day: today }).map((e) => e.id)).toEqual(["fixture"]);
    expect(explainOutOfFilter(previous, { day: today })).toContain(`日期非「${today}」`);
    button.onclick?.();
    expect(getState().day).toBeUndefined();
    expect(getState().sinceDays).toBe(DEFAULT_SINCE_DAYS);
  });

  it.each([3, 5, undefined])("取消日期還原選取前的時間範圍 %s，切換日期不覆寫紀錄", (sinceDays) => {
    setState({ day: undefined, sinceDays });
    setState({ day: "2026-11-01" });
    expect(getState().sinceDays).toBeUndefined();
    setState({ day: "2026-11-02" });
    expect(getState().sinceDays).toBeUndefined();
    setState({ day: undefined });
    expect(getState().sinceDays).toBe(sinceDays);
  });

  it("網址日期優先於 since，沒有紀錄時取消日期回到預設", () => {
    setState({ day: "2026-11-01", sinceDays: 1 });
    expect(getState().sinceDays).toBeUndefined();
    setState({ day: undefined });
    expect(getState().sinceDays).toBe(DEFAULT_SINCE_DAYS);
  });

  it("時間範圍選單清除日期並保留新範圍；舊台字地區只產生正規化選項", () => {
    setState({ region: "台中市", day: "2026-11-01" });
    const refs = Object.fromEntries(["f-cat", "f-risk", "f-range", "f-authority", "f-region", "f-query", "region-chip-slot"]
      .map((key) => ["#" + key, { value: "", innerHTML: "", onchange: null as null | ((ev: Event) => void) }]));
    const container = { innerHTML: "", querySelector: (selector: string) => refs[selector] ?? null } as unknown as HTMLElement;
    renderFilterBar(container, "domestic", [event({ region: "台中市" }), event({ region: "臺中市" })]);
    expect(refs["#f-region"].innerHTML).toContain('value="臺中市">臺中市（2）');
    expect(refs["#f-region"].innerHTML).not.toContain('value="台中市"');
    expect(refs["#f-region"].value).toBe("臺中市");
    refs["#f-range"].value = "5";
    refs["#f-range"].onchange?.({ target: refs["#f-range"] } as unknown as Event);
    expect(getState().day).toBeUndefined();
    expect(getState().sinceDays).toBe(5);
  });
});

describe("快照與情報網", () => {
  it("同筆數、同首末 ID 的事件仍依 manifest 檔案雜湊升版；network 也納入版本", () => {
    const manifest = { snapshotId: "one", rulesVersion: "rules", scopes: { domestic: { events: "events", network: "net" } },
      files: { events: { sha256: "events-one" }, net: { sha256: "network-one" } } } as unknown as CohortManifest;
    const first = scopeDataVersion(manifest, "domestic");
    expect(scopeDataVersion(structuredClone(manifest), "domestic")).toBe(first);
    const changed = structuredClone(manifest);
    changed.files.events.sha256 = "middle-event-changed";
    expect(scopeDataVersion(changed, "domestic")).not.toBe(first);
    changed.files.events.sha256 = "events-one";
    changed.files.net.sha256 = "network-two";
    expect(scopeDataVersion(changed, "domestic")).not.toBe(first);
    changed.files.net.sha256 = "network-one";
    changed.snapshotId = "two";
    expect(scopeDataVersion(changed, "domestic")).not.toBe(first);
  });

  it("情報網提供 30 秒有界下載，逾時仍顯示原有可重試 error", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")));
    expect(NETWORK_FETCH_TIMEOUT_MS).toBe(30_000);
    const net = await loadNetwork("domestic");
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(net.state).toBe("error");
    expect(net.error).toContain("逾時");
  });
});

describe("地圖聚合", () => {
  it("代表事件是全國時取群內明確地區，全為模糊地區就不顯示入口", () => {
    const html = clusterPopupHtml([event({ region: "全國", riskLevel: "critical" }), event({ region: "臺中市" })]);
    expect(html).toContain('data-filter-region="臺中市"');
    expect(html).not.toContain('data-filter-region="全國"');
    expect(clusterPopupHtml([event({ region: "全國" }), event({ region: "全球" })])).not.toContain("filter-region-btn");
  });

  it("邊界兩側聚合命中區不相交，固定中心與 iconAnchor 使用相同尺寸", () => {
    const a = clusterGridPoint(CLUSTER_CELL_SIZE - 0.01, 1);
    const b = clusterGridPoint(CLUSTER_CELL_SIZE + 0.01, 1);
    expect(a).toEqual([32, 32]);
    expect(b).toEqual([96, 32]);
    expect(b[0] - a[0]).toBeGreaterThan(CLUSTER_HIT_SIZE);
    expect(CLUSTER_HIT_SIZE).toBe(48);
    expect(clusterGridPoint(-0.01, -0.01)).toEqual([-32, -32]);
  });
});
