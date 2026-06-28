import { describe, expect, it } from "vitest";
import { computeProvStat } from "../src/components/KpiStrip";

// 回歸測試：provenance.json 每筆來源帶 scope，KPI「活躍資料源／官方來源占比」須依 scope 過濾，
// 否則國際頁會誤顯國內主導的全域數字（實際案例：國際頁顯示 144/161 與 30% 官方，
// 但國際來源全為 news-rss、官方占比應為 0%）。
const manifest = {
  generatedAt: "2026-06-27T05:37:00+08:00",
  sources: [
    // 國內：3 筆，其中 2 官方（gov-open-data / cwa），全部活躍
    { type: "gov-open-data", scope: "domestic" as const, fetchedAt: "2026-06-27T05:00:00+08:00" },
    { type: "cwa", scope: "domestic" as const, fetchedAt: "2026-06-27T05:00:00+08:00" },
    { type: "news-rss", scope: "domestic" as const, fetchedAt: "2026-06-27T05:00:00+08:00" },
    // 國際：2 筆，皆 news-rss（0 官方），其中 1 筆過期（兩天前）不算活躍
    { type: "news-rss", scope: "international" as const, fetchedAt: "2026-06-27T05:00:00+08:00" },
    { type: "news-rss", scope: "international" as const, fetchedAt: "2026-06-25T00:00:00+08:00" },
  ],
};

describe("computeProvStat", () => {
  it("國內：只計國內來源，官方占比正確", () => {
    const stat = computeProvStat(manifest, "domestic")!;
    expect(stat.total).toBe(3);
    expect(stat.active).toBe(3);
    expect(stat.officialPct).toBe(67); // 2/3 → 67%
  });

  it("國際：只計國際來源，官方占比為 0%、過期來源不算活躍", () => {
    const stat = computeProvStat(manifest, "international")!;
    expect(stat.total).toBe(2);
    expect(stat.active).toBe(1); // 過期那筆排除
    expect(stat.officialPct).toBe(0);
  });

  it("manifest 為 null 時回 null，不丟錯", () => {
    expect(computeProvStat(null, "domestic")).toBeNull();
  });

  it("該 scope 無來源時 total=0、officialPct=0（不除以零）", () => {
    const empty = { generatedAt: manifest.generatedAt, sources: [] };
    const stat = computeProvStat(empty, "international")!;
    expect(stat).toEqual({ total: 0, active: 0, officialPct: 0 });
  });
});
