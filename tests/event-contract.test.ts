import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { validateEventContract, clampImplausibleTimestamps } from "../scripts/lib/event-contract.mjs";

const makeEvent = () => ({
  id: "evt-001",
  title: "測試事件",
  region: "台北市",
  timestamp: "2026-01-01T00:00:00Z",
  category: "測試類",
  summary: "這是一筆測試摘要。",
  scope: "domestic",
  riskLevel: "low",
  source: {
    name: "測試來源",
    fetchedAt: "2026-01-01T00:00:00Z",
  },
});

describe("validateEventContract", () => {
  it("完整合法事件全部進 valid", () => {
    const event = makeEvent();
    const out = validateEventContract([event]);

    expect(out.valid).toEqual([event]);
    expect(out.valid[0]).toBe(event);
    expect(out.invalid).toEqual([]);
  });

  it.each([
    ["缺 id", () => {
      const e = makeEvent();
      delete e.id;
      return { event: e, expectedId: "(no-id)", expectedReason: "缺 id" };
    }],
    ["缺 title", () => {
      const e = makeEvent();
      delete e.title;
      return { event: e, expectedId: "evt-001", expectedReason: "缺 title" };
    }],
    ["缺 region", () => {
      const e = makeEvent();
      delete e.region;
      return { event: e, expectedId: "evt-001", expectedReason: "缺 region" };
    }],
    ["缺 timestamp", () => {
      const e = makeEvent();
      delete e.timestamp;
      return { event: e, expectedId: "evt-001", expectedReason: "缺 timestamp" };
    }],
    ["缺 category", () => {
      const e = makeEvent();
      delete e.category;
      return { event: e, expectedId: "evt-001", expectedReason: "缺 category" };
    }],
    ["缺 summary", () => {
      const e = makeEvent();
      delete e.summary;
      return { event: e, expectedId: "evt-001", expectedReason: "缺 summary" };
    }],
    ["缺 scope", () => {
      const e = makeEvent();
      delete e.scope;
      return { event: e, expectedId: "evt-001", expectedReason: "缺 scope" };
    }],
    ["缺 riskLevel", () => {
      const e = makeEvent();
      delete e.riskLevel;
      return { event: e, expectedId: "evt-001", expectedReason: "缺 riskLevel" };
    }],
    ["缺 source", () => {
      const e = makeEvent();
      delete e.source;
      return { event: e, expectedId: "evt-001", expectedReason: "缺 source" };
    }],
    ["缺 source.name", () => {
      const e = makeEvent();
      delete e.source.name;
      return { event: e, expectedId: "evt-001", expectedReason: "缺 source.name" };
    }],
    ["缺 source.fetchedAt", () => {
      const e = makeEvent();
      delete e.source.fetchedAt;
      return { event: e, expectedId: "evt-001", expectedReason: "缺 source.fetchedAt" };
    }],
  ])("缺少欄位：%s", (_, builder) => {
    const { event, expectedId, expectedReason } = builder();
    const out = validateEventContract([event]);
    expect(out.valid).toEqual([]);
    expect(out.invalid).toEqual([{ id: expectedId, reason: expectedReason }]);
  });

  it.each([
    ["riskLevel 非法", () => {
      const e = makeEvent();
      e.riskLevel = "urgent";
      return { event: e, reason: "riskLevel 非法:urgent" };
    }],
    ["scope 非法", () => {
      const e = makeEvent();
      e.scope = "global";
      return { event: e, reason: "scope 非法:global" };
    }],
  ])("值域檢查：%s", (_, builder) => {
    const { event, reason } = builder();
    const out = validateEventContract([event]);
    expect(out.valid).toEqual([]);
    expect(out.invalid).toEqual([{ id: event.id, reason }]);
  });

  it("混合輸入要正確 partition：只保留合格事件、保留不合格原因", () => {
    const valid1 = makeEvent();
    const invalid1 = (() => {
      const e = makeEvent();
      e.region = "";
      return e;
    })();
    const valid2 = { ...makeEvent(), id: "evt-002", title: "第二筆事件" };
    const invalid2 = (() => {
      const e = makeEvent();
      e.id = "evt-003";
      e.source.name = "";
      return e;
    })();

    const out = validateEventContract([valid1, invalid1, valid2, invalid2]);
    expect(out.valid).toEqual([valid1, valid2]);
    expect(out.invalid).toEqual([
      { id: "evt-001", reason: "缺 region" },
      { id: "evt-003", reason: "缺 source.name" },
    ]);
  });
});

describe("clampImplausibleTimestamps", () => {
  const NOW = Date.parse("2026-07-05T00:00:00Z");
  const mk = (ts: string, fetchedAt = "2026-07-05T00:00:00Z") => ({
    ...makeEvent(),
    timestamp: ts,
    source: { name: "測試來源", fetchedAt },
  });

  it("遠未來時間戳（民國155→2066 類）夾到 fetchedAt 並標記", () => {
    const bad = mk("2066-02-22T00:00:00Z");
    const { events, clamped } = clampImplausibleTimestamps([bad], { now: NOW });
    expect(clamped).toBe(1);
    expect(events[0].timestamp).toBe("2026-07-05T00:00:00Z");
    expect(events[0].timestampClamped).toBe(true);
  });

  it("近未來（排程集會，門檻內）與歷史過去、無效時間戳皆不動", () => {
    const near = mk("2026-08-01T00:00:00Z"); // 約1個月後
    const past = mk("2019-05-01T00:00:00Z"); // 歷史 gov 開放資料
    const nan = mk("not-a-date");
    const { events, clamped } = clampImplausibleTimestamps([near, past, nan], { now: NOW });
    expect(clamped).toBe(0);
    expect(events[0]).toBe(near);
    expect(events[1]).toBe(past);
    expect(events[2]).toBe(nan);
  });

  it("遠未來但無 fetchedAt 時夾到 now", () => {
    const bad = { ...makeEvent(), timestamp: "2066-01-01T00:00:00Z", source: { name: "x" } };
    const { events } = clampImplausibleTimestamps([bad], { now: NOW });
    expect(events[0].timestamp).toBe(new Date(NOW).toISOString());
  });
});
