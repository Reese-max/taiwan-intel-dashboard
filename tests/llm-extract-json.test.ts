import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { extractJson } from "../scripts/lib/llm-client.mjs";

describe("extractJson", () => {
  it("既有行為不變：陣列優先、code fence、純物件", () => {
    expect(extractJson('{"drop":[1,2]}')).toEqual([1, 2]);
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('結果：{"a":{"b":2}}')).toEqual({ a: { b: 2 } });
  });

  it("JSON 後面接帶括號的說明文字時，取第一段括號平衡的 JSON（2026-11-25 正式站複核批次失敗）", () => {
    expect(extractJson('{"drop":[1,2,5]}\n\n說明：第[3]則拿不準 {保留}')).toEqual([1, 2, 5]);
    expect(extractJson('{"drop":[]}\n註：[略]')).toEqual({ drop: [] }); // 既有物件路徑即可解析
    // 字串裡的括號不算結構。
    expect(extractJson('{"note":"含 } 與 \\" 的字串","ok":true}\n補充 {y}')).toEqual({ note: '含 } 與 " 的字串', ok: true });
  });

  it("真的不是 JSON 仍丟出錯誤", () => {
    expect(() => extractJson("沒有任何 JSON")).toThrow("無法解析 JSON");
    expect(() => extractJson("{未結束")).toThrow("無法解析 JSON");
  });
});
