import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { carryOver } from "../scripts/lib/carry-over.mjs";

const event = (id: string, datasetId: string, extra: Record<string, unknown> = {}) => ({
  id,
  source: { datasetId },
  ...extra,
});

describe("carryOver", () => {
  it("成功時回傳本輪事件", () => {
    const fresh = [event("fresh", "fresh-dataset")];
    const oldEvents = [event("old", "fresh-dataset")];

    expect(
      carryOver({
        status: { ok: true },
        fresh,
        dropStale: () => false,
        oldEvents,
        match: "fresh-dataset",
      }),
    ).toBe(fresh);
  });

  it("EXCLUSIVE 窄抓 dropStale 時清空", () => {
    expect(
      carryOver({
        status: { skipped: true },
        fresh: [event("fresh", "a")],
        dropStale: () => true,
        oldEvents: [event("old", "a")],
        match: "a",
      }),
    ).toEqual([]);
  });

  it("失敗時依 datasetId 字串沿用舊快照", () => {
    const oldEvents = [event("keep", "a"), event("drop", "b")];

    expect(
      carryOver({
        status: { ok: false },
        fresh: [event("fresh", "a")],
        dropStale: () => false,
        oldEvents,
        match: "a",
      }).map((e: { id: string }) => e.id),
    ).toEqual(["keep"]);
  });

  it("失敗時依 predicate 沿用舊快照", () => {
    const oldEvents = [event("keep", "pcc-tender", { category: "採購" }), event("drop", "pcc-tender", { category: "治安" })];

    expect(
      carryOver({
        status: { ok: false },
        fresh: [],
        dropStale: () => false,
        oldEvents,
        match: (e: { category?: string }) => e.category === "採購",
      }).map((e: { id: string }) => e.id),
    ).toEqual(["keep"]);
  });

  it("oldEvents 空或 undefined 時安全回傳空陣列", () => {
    expect(
      carryOver({
        status: { ok: false },
        fresh: [],
        dropStale: () => false,
        oldEvents: [],
        match: "a",
      }),
    ).toEqual([]);
    expect(
      carryOver({
        status: { ok: false },
        fresh: [],
        dropStale: () => false,
        match: "a",
      }),
    ).toEqual([]);
  });
});
