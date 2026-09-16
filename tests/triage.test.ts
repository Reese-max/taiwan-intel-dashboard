import { describe, expect, it } from "vitest";
import {
  buildTriage,
  filterTriageEvents,
  loadTriageAcked,
  saveTriageAcked,
  TRIAGE_ACKED_KEY,
} from "../src/utils/triage";
import { renderTriageInbox } from "../src/components/TriageInbox";
import type { IntelEvent, RiskLevel } from "../src/types/event";
import { NetworkIndex } from "../src/data/network";

const event = (id: string, riskLevel: RiskLevel, timestamp: string): IntelEvent => ({
  id,
  title: `事件 ${id}`,
  region: "台北市",
  timestamp,
  category: "治安",
  scope: "domestic",
  riskLevel,
  summary: "摘要",
  source: {
    name: "測試來源",
    type: "manual",
    fetchedAt: "2026-07-05T00:00:00.000Z",
  },
});

describe("buildTriage", () => {
  it("只納入 critical/high 事件，排除 medium/low", () => {
    const result = buildTriage(
      [
        event("low", "low", "2026-07-05T01:00:00.000Z"),
        event("medium", "medium", "2026-07-05T02:00:00.000Z"),
        event("high", "high", "2026-07-05T03:00:00.000Z"),
        event("critical", "critical", "2026-07-05T04:00:00.000Z"),
      ],
      new Set(),
      Date.parse("2026-07-05T05:00:00.000Z"),
    );

    expect(result.total).toBe(2);
    expect(result.items.map((e) => e.id)).toEqual(["critical", "high"]);
  });

  it("排序為 critical 優先，同級再 timestamp 新到舊", () => {
    const result = buildTriage(
      [
        event("high-new", "high", "2026-07-05T04:00:00.000Z"),
        event("critical-old", "critical", "2026-07-05T01:00:00.000Z"),
        event("high-old", "high", "2026-07-05T02:00:00.000Z"),
        event("critical-new", "critical", "2026-07-05T03:00:00.000Z"),
      ],
      [],
      Date.parse("2026-07-05T05:00:00.000Z"),
    );

    expect(result.items.map((e) => e.id)).toEqual(["critical-new", "critical-old", "high-new", "high-old"]);
  });

  it("依 ackedIds 標記 unread，Set 與 array 皆可", () => {
    const withSet = buildTriage(
      [event("a", "critical", "2026-07-05T01:00:00.000Z")],
      new Set(["a"]),
      Date.parse("2026-07-05T05:00:00.000Z"),
    );
    const withArray = buildTriage(
      [event("b", "high", "2026-07-05T01:00:00.000Z")],
      ["not-b"],
      Date.parse("2026-07-05T05:00:00.000Z"),
    );

    expect(withSet.items[0].unread).toBe(false);
    expect(withSet.unreadCount).toBe(0);
    expect(withArray.items[0].unread).toBe(true);
    expect(withArray.unreadCount).toBe(1);
  });

  it("套用 cap 並計算 capped 未顯示數", () => {
    const result = buildTriage(
      [
        event("c1", "critical", "2026-07-05T03:00:00.000Z"),
        event("c2", "critical", "2026-07-05T02:00:00.000Z"),
        event("h1", "high", "2026-07-05T01:00:00.000Z"),
      ],
      ["c2"],
      Date.parse("2026-07-05T05:00:00.000Z"),
      { cap: 2 },
    );

    expect(result.items.map((e) => e.id)).toEqual(["c1", "c2"]);
    expect(result.total).toBe(3);
    expect(result.capped).toBe(1);
    expect(result.unreadCount).toBe(2);
  });

  it("空輸入回傳空結果", () => {
    const result = buildTriage([], [], Date.parse("2026-07-05T05:00:00.000Z"));

    expect(result).toEqual({ items: [], unreadCount: 0, total: 0, capped: 0 });
  });

  it("非法 timestamp 不 crash，且同風險排序落在合法 timestamp 後", () => {
    const result = buildTriage(
      [
        event("bad", "high", "not-a-date"),
        event("good", "high", "2026-07-05T01:00:00.000Z"),
        event("critical", "critical", "bad-date-too"),
      ],
      [],
      Date.parse("2026-07-05T05:00:00.000Z"),
    );

    expect(result.items.map((e) => e.id)).toEqual(["critical", "good", "bad"]);
  });
});

describe("filterTriageEvents", () => {
  it("沿用主列表的分類與關鍵字篩選", () => {
    const events = [
      { ...event("security", "high", "2026-07-05T03:00:00.000Z"), category: "資安", title: "GhostBlade" },
      { ...event("crime", "critical", "2026-07-05T04:00:00.000Z"), category: "治安", title: "無關事件" },
    ];

    expect(filterTriageEvents(events, { scope: "domestic", category: "資安", query: "GhostBlade" }, new NetworkIndex(null)).map((item) => item.id)).toEqual(["security"]);
  });
});

describe("Issue #31 — 本地儲存與邊界提示契約", () => {
  function createMockStorage(initData?: Record<string, string>, throwOnSet?: boolean): Storage {
    const data: Record<string, string> = { ...initData };
    return {
      getItem: (key: string) => data[key] ?? null,
      setItem: (key: string, value: string) => {
        if (throwOnSet) throw new Error("QuotaExceededError: storage is full");
        data[key] = value;
      },
      removeItem: (key: string) => { delete data[key]; },
      clear: () => { Object.keys(data).forEach((k) => delete data[k]); },
      key: (i: number) => Object.keys(data)[i] ?? null,
      get length() { return Object.keys(data).length; },
    };
  }

  it("loadTriageAcked 正常解析有效 JSON 陣列，過濾非字串與空字串", () => {
    const storage = createMockStorage({
      [TRIAGE_ACKED_KEY]: JSON.stringify(["evt-1", "evt-2", 123, null, "", "   "]),
    });
    const result = loadTriageAcked(storage);
    expect(result.has("evt-1")).toBe(true);
    expect(result.has("evt-2")).toBe(true);
    expect(result.size).toBe(2);
  });

  it("loadTriageAcked 遇到空值、毀損 JSON 或非陣列物件時容錯回傳空集合，不崩潰", () => {
    const emptyStorage = createMockStorage();
    expect(loadTriageAcked(emptyStorage).size).toBe(0);

    const corruptStorage = createMockStorage({ [TRIAGE_ACKED_KEY]: "{ invalid json" });
    expect(loadTriageAcked(corruptStorage).size).toBe(0);

    const objectStorage = createMockStorage({ [TRIAGE_ACKED_KEY]: JSON.stringify({ a: 1 }) });
    expect(loadTriageAcked(objectStorage).size).toBe(0);
  });

  it("saveTriageAcked 正常保存時回傳 ok: true", () => {
    const storage = createMockStorage();
    const res = saveTriageAcked(new Set(["evt-1", "evt-2"]), storage);
    expect(res.ok).toBe(true);
    expect(JSON.parse(storage.getItem(TRIAGE_ACKED_KEY)!)).toEqual(["evt-1", "evt-2"]);
  });

  it("saveTriageAcked 容量不足或存取被拒時回傳 ok: false 與錯誤訊息，不丟出未捕獲例外", () => {
    const storage = createMockStorage({}, true);
    const res = saveTriageAcked(new Set(["evt-1"]), storage);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("QuotaExceededError");
  });

  function mockContainer(dataset: Record<string, string> = {}): HTMLElement {
    return {
      innerHTML: "",
      dataset: { ...dataset },
      querySelector: () => null,
      querySelectorAll: () => [],
    } as unknown as HTMLElement;
  }

  it("renderTriageInbox 呈現此瀏覽器儲存提示、已讀不等於處置提示，以及高風險待閱標題", () => {
    const container = mockContainer();
    renderTriageInbox(container, [event("h1", "high", "2026-07-05T01:00:00.000Z")], {
      acked: new Set(),
      onFocus: () => {},
      onAck: () => {},
      onAckAll: () => {},
    });

    expect(container.innerHTML).toContain("高風險待閱");
    expect(container.innerHTML).toContain("已讀記錄僅儲存在此瀏覽器");
    expect(container.innerHTML).toContain("不跨裝置同步");
    expect(container.innerHTML).toContain("已讀不代表已查證、已處置或完成交班");
  });

  it("renderTriageInbox 當 storageOk 為 false 時呈現暫存警示提示", () => {
    const container = mockContainer();
    renderTriageInbox(container, [event("h1", "high", "2026-07-05T01:00:00.000Z")], {
      acked: new Set(),
      storageOk: false,
      onFocus: () => {},
      onAck: () => {},
      onAckAll: () => {},
    });

    expect(container.innerHTML).toContain("triage-storage-warning");
    expect(container.innerHTML).toContain("本次已讀狀態僅暫存於此頁，重新開啟後可能不保留");
  });
});

describe("Issue #32 — 未讀優先與篩選實驗契約", () => {
  function mockContainer(dataset: Record<string, string> = {}): HTMLElement {
    return {
      innerHTML: "",
      dataset: { ...dataset },
      querySelector: () => null,
      querySelectorAll: () => [],
    } as unknown as HTMLElement;
  }

  const events = [
    event("crit-read", "critical", "2026-07-05T04:00:00.000Z"),
    event("crit-unread", "critical", "2026-07-05T03:00:00.000Z"),
    event("high-unread", "high", "2026-07-05T05:00:00.000Z"),
    event("high-read", "high", "2026-07-05T02:00:00.000Z"),
  ];
  const acked = new Set(["crit-read", "high-read"]);

  it("default 模式：依照風險（critical > high）及時間新到舊，不隨已讀更動順序", () => {
    const res = buildTriage(events, acked, Date.now(), { mode: "default" });
    expect(res.items.map((e) => e.id)).toEqual(["crit-read", "crit-unread", "high-unread", "high-read"]);
    expect(res.total).toBe(4);
    expect(res.unreadCount).toBe(2);
  });

  it("unread-first 模式：同風險下未讀優先，但低風險未讀決不超越高風險已讀", () => {
    const res = buildTriage(events, acked, Date.now(), { mode: "unread-first" });
    // critical 區塊：crit-unread 優先於 crit-read；high 區塊：high-unread 優先於 high-read
    // crit-read（高風險已讀）依然優先於 high-unread（次風險未讀）
    expect(res.items.map((e) => e.id)).toEqual(["crit-unread", "crit-read", "high-unread", "high-read"]);
    expect(res.total).toBe(4);
    expect(res.unreadCount).toBe(2);
  });

  it("unread-only 模式：只展示未讀事件，但 total 仍保留完整高風險數", () => {
    const res = buildTriage(events, acked, Date.now(), { mode: "unread-only" });
    expect(res.items.map((e) => e.id)).toEqual(["crit-unread", "high-unread"]);
    expect(res.total).toBe(4);
    expect(res.unreadCount).toBe(2);
  });

  it("unread-only 模式套用 cap 時正確反映 capped 未顯示數", () => {
    const res = buildTriage(events, acked, Date.now(), { mode: "unread-only", cap: 1 });
    expect(res.items.map((e) => e.id)).toEqual(["crit-unread"]);
    expect(res.capped).toBe(1);
    expect(res.unreadCount).toBe(2);
  });

  it("renderTriageInbox 提供標準／未讀優先／只看未讀操作切換，全已讀時有引導文案", () => {
    const container = mockContainer();
    renderTriageInbox(container, events, {
      acked,
      sortMode: "unread-only",
      onFocus: () => {},
      onAck: () => {},
      onAckAll: () => {},
    });

    expect(container.innerHTML).toContain("triage-filter-group");
    expect(container.innerHTML).toContain("標準");
    expect(container.innerHTML).toContain("未讀優先");
    expect(container.innerHTML).toContain("只看未讀");
    expect(container.innerHTML).toContain('class="triage-filter-btn is-active" data-mode="unread-only"');

    // 當所有事件皆已讀且為 unread-only 模式
    const allAcked = new Set(events.map((e) => e.id));
    const containerAllAcked = mockContainer();
    renderTriageInbox(containerAllAcked, events, {
      acked: allAcked,
      sortMode: "unread-only",
      onFocus: () => {},
      onAck: () => {},
      onAckAll: () => {},
    });
    expect(containerAllAcked.innerHTML).toContain("目前無未讀的高風險事件（可切換「標準」檢視已讀）");
  });
});
