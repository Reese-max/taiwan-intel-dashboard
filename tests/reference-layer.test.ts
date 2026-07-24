import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { isReferenceEvent } from "../scripts/lib/event-contract.mjs";

const ev = (datasetId: string | undefined) => ({
  id: "x",
  title: "t",
  scope: "domestic",
  source: datasetId ? { name: "s", datasetId } : { name: "s" },
});

describe("isReferenceEvent（清單型資料與事件分家）", () => {
  it("設施清單/歷史統計來源 → reference（不進事件統計）", () => {
    expect(isReferenceEvent(ev("155895"))).toBe(true); // 屏東路口錄監
    expect(isReferenceEvent(ev("151006"))).toBe(true); // 金門防空避難設施
    expect(isReferenceEvent(ev("12197"))).toBe(true); // 歷史交通事故
    expect(isReferenceEvent(ev("13166"))).toBe(true); // 犯罪統計週報
  });

  it("真實事件來源 → 非 reference", () => {
    expect(isReferenceEvent(ev("177136"))).toBe(false); // 114年傷亡道路交通事故
    expect(isReferenceEvent(ev("11307"))).toBe(false); // 集會遊行資訊
    expect(isReferenceEvent(ev("taipei-crime"))).toBe(false); // 犯罪點位（實際案件）
    expect(isReferenceEvent(ev(undefined))).toBe(false); // 無 datasetId（新聞事件）
    expect(isReferenceEvent(null)).toBe(false);
  });
});
