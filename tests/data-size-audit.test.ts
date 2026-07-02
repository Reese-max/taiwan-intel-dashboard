import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { auditDataSize } from "../scripts/audit-data-size.mjs";

const MB = 1024 * 1024;

describe("auditDataSize（Cloudflare Pages 25MiB 保險絲）", () => {
  it("全部低於門檻 → ok", () => {
    const r = auditDataSize(
      [
        { file: "domestic.json", bytes: 11 * MB },
        { file: "network.json", bytes: 3 * MB },
      ],
      { maxBytes: 20 * MB },
    );
    expect(r.ok).toBe(true);
    expect(r.offenders).toHaveLength(0);
  });

  it("超標檔案 → 列為 offender", () => {
    const r = auditDataSize(
      [
        { file: "domestic.json", bytes: 22 * MB },
        { file: "summary.json", bytes: 1 * MB },
      ],
      { maxBytes: 20 * MB },
    );
    expect(r.ok).toBe(false);
    expect(r.offenders.map((o: { file: string }) => o.file)).toEqual(["domestic.json"]);
  });

  it("空清單 → ok", () => {
    expect(auditDataSize([]).ok).toBe(true);
  });
});
