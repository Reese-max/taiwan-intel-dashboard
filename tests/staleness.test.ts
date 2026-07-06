import { describe, expect, it } from "vitest";

import { stalenessHours, stalenessNotice } from "../src/utils/staleness";

const generatedAt = "2026-07-06T00:00:00.000Z";
const generatedMs = Date.parse(generatedAt);

describe("stalenessHours", () => {
  it("新鮮資料回傳小時數（可含小數）", () => {
    expect(stalenessHours(generatedAt, generatedMs + 90 * 60 * 1000)).toBe(1.5);
  });

  it("無效或缺 generatedAt 回傳 null", () => {
    expect(stalenessHours(undefined, generatedMs)).toBeNull();
    expect(stalenessHours("not-a-date", generatedMs)).toBeNull();
  });
});

describe("stalenessNotice", () => {
  it("未超過預設 6 小時門檻時不回傳文案", () => {
    expect(stalenessNotice(generatedAt, generatedMs + 5.5 * 60 * 60 * 1000)).toBeNull();
  });

  it("剛好 6 小時門檻時不回傳文案", () => {
    expect(stalenessNotice(generatedAt, generatedMs + 6 * 60 * 60 * 1000)).toBeNull();
  });

  it("超過門檻時回傳停更文案與本地最後更新時間", () => {
    const now = generatedMs + 7.75 * 60 * 60 * 1000;
    const local = new Date(generatedAt).toLocaleString("zh-TW", { hour12: false });

    expect(stalenessNotice(generatedAt, now)).toBe(`資料已 7 小時未更新（最後更新 ${local}）`);
  });

  it("無效輸入時不回傳文案", () => {
    expect(stalenessNotice(undefined, generatedMs)).toBeNull();
    expect(stalenessNotice("bad-date", generatedMs)).toBeNull();
  });
});
