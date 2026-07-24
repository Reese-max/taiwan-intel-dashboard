import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { toTraditional } from "../scripts/lib/llm-client.mjs";

describe("toTraditional（LLM 輸出簡體字轉繁）", () => {
  it("常見簡體洩漏轉為繁體（實例：MiniMax 摘要混簡）", () => {
    expect(toTraditional("微软单月修近200漏洞，专业化趋势")).toBe("微軟單月修近200漏洞，專業化趨勢");
  });

  it("繁體與 ASCII/JSON 結構不受影響", () => {
    const s = '{"title_zh":"臺北市治安事件","risk":"high"}';
    expect(toTraditional(s)).toBe(s);
  });

  it("空值安全", () => {
    expect(toTraditional("")).toBe("");
  });
});
