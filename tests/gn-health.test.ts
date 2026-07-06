import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { googleNewsHealth } from "../scripts/lib/gn-health.mjs";

const gn = (ok: boolean, count: number) => ({ label: "GN 測試", gn: true, ok, count });

describe("googleNewsHealth", () => {
  it("10 GN feed 全 ok 且 count > 0 時 okRate 為 1 且非系統性異常", () => {
    const status = Array.from({ length: 10 }, () => gn(true, 3));

    expect(googleNewsHealth(status)).toEqual({ gnFeeds: 10, gnOk: 10, okRate: 1, systemic: false });
  });

  it("10 GN feed 只 4 個 ok 且 ok 但 count 0 視同不健康時判定系統性異常", () => {
    const status = [
      ...Array.from({ length: 4 }, () => gn(true, 2)),
      ...Array.from({ length: 3 }, () => gn(true, 0)),
      ...Array.from({ length: 3 }, () => gn(false, 0)),
    ];

    expect(googleNewsHealth(status)).toEqual({ gnFeeds: 10, gnOk: 4, okRate: 0.4, systemic: true });
  });

  it("混入非 GN feed 時不計入分母", () => {
    const status = [
      ...Array.from({ length: 5 }, () => gn(true, 1)),
      { label: "直連 RSS", ok: false, count: 0 },
      { label: "另一個直連 RSS", ok: true, count: 10 },
    ];

    expect(googleNewsHealth(status)).toEqual({ gnFeeds: 5, gnOk: 5, okRate: 1, systemic: false });
  });

  it("GN 樣本少於 5 時即使全掛也不判定系統性異常", () => {
    const status = Array.from({ length: 4 }, () => gn(false, 0));

    expect(googleNewsHealth(status)).toEqual({ gnFeeds: 4, gnOk: 0, okRate: 0, systemic: false });
  });

  it("空輸入與非陣列輸入回傳安全值", () => {
    expect(googleNewsHealth([])).toEqual({ gnFeeds: 0, gnOk: 0, okRate: 1, systemic: false });
    expect(googleNewsHealth(undefined)).toEqual({ gnFeeds: 0, gnOk: 0, okRate: 1, systemic: false });
  });
});
