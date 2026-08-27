import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { DEFAULT_SOURCE_KEYS } from "../scripts/lib/source-plan.mjs";
// @ts-expect-error — JS ESM module without types
import { DOMAIN_COVERAGE } from "../scripts/domain-coverage.mjs";

describe("retired judicial source", () => {
  it("stays disabled until an official direct adapter exists", () => {
    const domain = DOMAIN_COVERAGE.find((item: any) => item.key === "司法／法務");

    expect(DEFAULT_SOURCE_KEYS).not.toContain("judicial");
    expect(domain).toMatchObject({ status: "gap" });
    expect(existsSync(join(process.cwd(), "scripts", "lib", "fetch-judicial.mjs"))).toBe(false);
  });
});
