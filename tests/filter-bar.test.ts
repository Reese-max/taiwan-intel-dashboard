import { describe, it, expect } from "vitest";
import { renderFilterBar } from "../src/components/FilterBar";

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

describe("FilterBar 國內分類選項", () => {
  it("含新主題分類 食安/衛生/環境/資安", () => {
    const { el } = createContainer();
    renderFilterBar(el as unknown as HTMLElement, "domestic");

    const options = el.querySelectorAll("#f-cat option").map((o) => o.value);
    for (const c of ["食安", "衛生", "環境", "資安", "治安", "反詐", "災防", "採購", "交通"]) {
      expect(options).toContain(c);
    }
  });
});
