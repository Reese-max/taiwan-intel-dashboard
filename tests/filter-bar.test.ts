import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderFilterBar } from "../src/components/FilterBar";
import { getState, setState } from "../src/store";

type FakeElement = {
  value: string;
  onchange?: ((ev: Event) => void) | null;
  oninput?: ((ev: Event) => void) | null;
};

type FakeContainer = {
  innerHTML: string;
  querySelector: (selector: string) => FakeElement | null;
  querySelectorAll: (selector: string) => Array<{ value: string }>;
};

const createContainer = (): { el: FakeContainer; refs: Record<string, FakeElement> } => {
  const refs: Record<string, FakeElement> = {
    "#f-cat": { value: "" },
    "#f-risk": { value: "" },
    "#f-range": { value: "" },
    "#f-query": { value: "" },
  };

  const el: FakeContainer = {
    innerHTML: "",
    querySelector: (selector: string) => refs[selector] || null,
    querySelectorAll: (selector: string) => {
      if (selector === "#f-cat option") {
        const matches = [...el.innerHTML.matchAll(/<option[^>]*value="([^"]*)"/g)];
        return matches.slice(1).map((m) => ({ value: m[1] }));
      }
      return [];
    },
  };

  return { el, refs };
};

const resetState = (): void => {
  setState({
    scope: "domestic",
    category: undefined,
    minRisk: undefined,
    source: undefined,
    sinceDays: 3,
    query: undefined,
  });
};

const ensureWindowTimers = (): (() => void) | undefined => {
  const g = globalThis as typeof globalThis & { window?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } };
  g.window = { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) };
  return () => {
    delete g.window;
  };
};

let restoreWindow: (() => void) | null = null;

beforeEach(() => {
  resetState();
});

afterEach(() => {
  restoreWindow?.();
  restoreWindow = null;
  resetState();
  vi.useRealTimers();
});

describe("FilterBar 國內分類選項", () => {
  it("含新主題分類 食安/衛生/環境/資安", () => {
    const { el } = createContainer();
    renderFilterBar(el as unknown as HTMLElement, "domestic");

    const options = el.querySelectorAll("#f-cat option").map((o) => o.value);
    for (const c of ["國防", "食安", "衛生", "環境", "資安", "治安", "社會", "反詐", "災防", "採購", "協尋", "交通"]) {
      expect(options).toContain(c);
    }
  });

  it("選擇分類時會更新 store 狀態 category", () => {
    const { el } = createContainer();
    renderFilterBar(el as unknown as HTMLElement, "domestic");

    const select = el.querySelector("#f-cat")!;
    select.value = "交通";
    select.onchange?.({ target: select } as unknown as Event);

    expect(getState().category).toBe("交通");
  });

  it("選擇風險門檻時會更新 store 狀態 minRisk", () => {
    const { el } = createContainer();
    renderFilterBar(el as unknown as HTMLElement, "domestic");

    const select = el.querySelector("#f-risk")!;
    select.value = "high";
    select.onchange?.({ target: select } as unknown as Event);

    expect(getState().minRisk).toBe("high");
  });

  it("#f-query 具備 200ms debounce 的 oninput 更新 query", () => {
    vi.useFakeTimers();
    restoreWindow = ensureWindowTimers();
    const { el } = createContainer();
    renderFilterBar(el as unknown as HTMLElement, "domestic");

    const input = el.querySelector("#f-query")!;
    input.value = "  警政  ";
    input.oninput?.({ target: input } as unknown as Event);

    expect(getState().query).toBeUndefined();
    vi.advanceTimersByTime(200);

    expect(getState().query).toBe("警政");
  });
});
