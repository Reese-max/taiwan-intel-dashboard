import { describe, expect, it } from "vitest";
import { resetEventListScroll } from "../src/components/EventList";

import { describe, expect, it, vi } from "vitest";
import { PAGE_SIZE, renderEventList, resetEventListScroll } from "../src/components/EventList";
import type { IntelEvent } from "../src/types/event";

function makeFakeEvent(id: string): IntelEvent {
  return {
    id,
    title: `測試事件 ${id}`,
    summary: `摘要 ${id}`,
    category: "治安",
    scope: "domestic",
    riskLevel: "medium",
    timestamp: "2026-06-20T10:00:00+08:00",
    source: {
      name: "警政新聞",
      type: "news-rss",
      fetchedAt: "2026-06-20T10:00:00+08:00",
    },
  };
}

class FakeDomElement {
  tagName: string;
  className = "";
  type = "";
  innerHTML = "";
  textContent = "";
  children: FakeDomElement[] = [];
  listeners: Record<string, ((ev: unknown) => void)[]> = {};
  insertedHtml: { position: string; html: string }[] = [];
  removed = false;

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  addEventListener(event: string, fn: (ev: unknown) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  removeEventListener(event: string, fn: (ev: unknown) => void): void {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((f) => f !== fn);
    }
  }

  append(...nodes: (FakeDomElement | string)[]): void {
    for (const node of nodes) {
      if (typeof node === "string") {
        const textNode = new FakeDomElement("#text");
        textNode.textContent = node;
        this.children.push(textNode);
      } else {
        this.children.push(node);
      }
    }
  }

  appendChild(node: FakeDomElement): FakeDomElement {
    this.children.push(node);
    return node;
  }

  insertAdjacentHTML(position: string, html: string): void {
    this.insertedHtml.push({ position, html });
  }

  remove(): void {
    this.removed = true;
    this.children = [];
  }

  trigger(event: string, ev: unknown = {}): void {
    for (const listener of this.listeners[event] ?? []) {
      listener(ev);
    }
  }
}

describe("renderEventList 增量與虛擬化渲染", () => {
  it("無事件時顯示空訊息且不建頁尾", () => {
    const container = new FakeDomElement("div");
    renderEventList(container as unknown as HTMLElement, []);

    expect(container.innerHTML).toContain("無符合條件的情報");
    expect(container.children).toHaveLength(0);
  });

  it("自訂 emptyMessage 優先", () => {
    const container = new FakeDomElement("div");
    renderEventList(container as unknown as HTMLElement, [], { emptyMessage: "自訂空字串" });

    expect(container.innerHTML).toContain("自訂空字串");
  });

  it("事件筆數小於等於 pageSize 時初次全數渲染，不掛頁尾與載入更多按鈕", () => {
    const container = new FakeDomElement("div");
    const events = [makeFakeEvent("1"), makeFakeEvent("2")];
    renderEventList(container as unknown as HTMLElement, events, { pageSize: 5 });

    expect(container.innerHTML).toContain("測試事件 1");
    expect(container.innerHTML).toContain("測試事件 2");
    expect(container.children).toHaveLength(0);
  });

  it("事件筆數多於 batchSize 時只在 DOM 渲染第一批，其餘透過手動按鈕分批載入", () => {
    const stubDocument = {
      createElement: (tag: string) => new FakeDomElement(tag),
    };
    vi.stubGlobal("document", stubDocument);

    try {
      const container = new FakeDomElement("div");
      const events = Array.from({ length: 5 }, (_, i) => makeFakeEvent(`evt-${i + 1}`));

      // 批量 2，總數 5：初次進 DOM 2 筆，剩餘 3 筆
      renderEventList(container as unknown as HTMLElement, events, { pageSize: 2 });

      expect(container.innerHTML).toContain("測試事件 evt-1");
      expect(container.innerHTML).toContain("測試事件 evt-2");
      expect(container.innerHTML).not.toContain("測試事件 evt-3");

      // 頁尾結構：footer 內有 btn 與 status
      expect(container.children).toHaveLength(1);
      const footer = container.children[0];
      expect(footer.className).toBe("list-more");
      const btn = footer.children[0];
      const status = footer.children[1];
      expect(btn.textContent).toBe("載入更多（還有 3）");
      expect(status.textContent).toBe("已顯示 2 / 5 筆");

      // 點擊載入更多第 1 次：載入 evt-3 與 evt-4
      btn.trigger("click");
      expect(footer.insertedHtml).toHaveLength(1);
      expect(footer.insertedHtml[0].html).toContain("測試事件 evt-3");
      expect(footer.insertedHtml[0].html).toContain("測試事件 evt-4");
      expect(footer.insertedHtml[0].html).not.toContain("測試事件 evt-5");
      expect(btn.textContent).toBe("載入更多（還有 1）");
      expect(status.textContent).toBe("已顯示 4 / 5 筆");

      // 點擊載入更多第 2 次：載入 evt-5，達全部筆數，頁尾移除
      btn.trigger("click");
      expect(footer.insertedHtml).toHaveLength(2);
      expect(footer.insertedHtml[1].html).toContain("測試事件 evt-5");
      expect(footer.removed).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("預設匯出 PAGE_SIZE 常數為 50", () => {
    expect(PAGE_SIZE).toBe(50);
  });
});

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
