import { describe, expect, it } from "vitest";
import { selectInternationalWithOfficialPoliceFloor } from "../scripts/lib/nvidia.mjs";

// 2026-08-03 復原迴歸防護：feed 名冊擴至 465 個後，分類多元挑選把 general 稀釋到
// 門檻（min-general-events=50）之下（實證 34/50）。general 保底不得再被長尾主題洗掉。

function ev(id: string, feedLabel: string, category: string) {
  return {
    id,
    title: id,
    category,
    source: { feedLabel, name: feedLabel },
  };
}

const GENERAL_LABELS = new Set(["BBC World", "CNN World", "Guardian World"]);

function pool(generalCount: number, tailCount: number) {
  const events = [];
  for (let i = 0; i < generalCount; i++) {
    events.push(ev(`g${i}`, [...GENERAL_LABELS][i % GENERAL_LABELS.size], "國際"));
  }
  for (let i = 0; i < tailCount; i++) {
    // 長尾：大量不同類別，模擬多元挑選會偏向的高分散池
    events.push(ev(`t${i}`, `Tail Feed ${i % 40}`, `類別${i % 20}`));
  }
  return events;
}

describe("selectInternationalWithOfficialPoliceFloor：general 保底", () => {
  it("general 候選足夠時，結果至少含 minGeneral 筆 general 事件", () => {
    const events = pool(80, 400);
    const picked = selectInternationalWithOfficialPoliceFloor(events, [], 250, {
      generalFeedLabels: GENERAL_LABELS,
      minGeneral: 50,
    });
    const general = picked.filter((e: any) => GENERAL_LABELS.has(e.source.feedLabel));
    expect(picked.length).toBeLessThanOrEqual(250);
    expect(general.length).toBeGreaterThanOrEqual(50);
  });

  it("general 候選不足時，全數入選且不拋錯", () => {
    const events = pool(12, 300);
    const picked = selectInternationalWithOfficialPoliceFloor(events, [], 250, {
      generalFeedLabels: GENERAL_LABELS,
      minGeneral: 50,
    });
    const general = picked.filter((e: any) => GENERAL_LABELS.has(e.source.feedLabel));
    expect(general.length).toBe(12);
  });

  it("保底不得超過 max 上限", () => {
    const events = pool(80, 10);
    const picked = selectInternationalWithOfficialPoliceFloor(events, [], 30, {
      generalFeedLabels: GENERAL_LABELS,
      minGeneral: 50,
    });
    expect(picked.length).toBeLessThanOrEqual(30);
  });

  it("未帶 opts 時維持原行為（不因新參數改變輸出形狀）", () => {
    const events = pool(5, 60);
    const picked = selectInternationalWithOfficialPoliceFloor(events, [], 40);
    expect(picked.length).toBeLessThanOrEqual(40);
    expect(new Set(picked.map((e: any) => e.id)).size).toBe(picked.length);
  });
});
