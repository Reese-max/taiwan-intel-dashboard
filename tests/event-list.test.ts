import { describe, expect, it } from "vitest";
import { resetEventListScroll } from "../src/components/EventList";

describe("resetEventListScroll", () => {
  it("把事件列表的可捲動父層歸零，避免關聯結果停在舊列表底部", () => {
    const parent = { scrollTop: 8124 };
    const container = { parentElement: parent };

    resetEventListScroll(container as unknown as HTMLElement);

    expect(parent.scrollTop).toBe(0);
  });

  it("整頁(window)被捲下去時，把焦點清單區塊捲回視窗，避免結果落在視窗外看不到", () => {
    let scrolledIntoView = false;
    const parent = {
      scrollTop: 5000,
      getBoundingClientRect: () => ({ top: -406 }), // 區塊頂端在視窗上方 406px（捲到外面）
      scrollIntoView: () => {
        scrolledIntoView = true;
      },
    };
    const container = { parentElement: parent };

    resetEventListScroll(container as unknown as HTMLElement);

    expect(parent.scrollTop).toBe(0);
    expect(scrolledIntoView).toBe(true);
  });

  it("清單區塊已在視窗內時不額外捲動整頁，避免打擾正常情況", () => {
    let scrolledIntoView = false;
    const parent = {
      scrollTop: 0,
      getBoundingClientRect: () => ({ top: 172 }), // 區塊頂端在視窗內
      scrollIntoView: () => {
        scrolledIntoView = true;
      },
    };
    const container = { parentElement: parent };

    resetEventListScroll(container as unknown as HTMLElement);

    expect(scrolledIntoView).toBe(false);
  });
});
