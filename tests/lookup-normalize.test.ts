import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("retired lookup normalization server", () => {
  it("cannot be reached from the static-only server", () => {
    const root = process.cwd();
    const server = readFileSync(join(root, "server", "index.mjs"), "utf8");

    expect(existsSync(join(root, "server", "normalize.mjs"))).toBe(false);
    expect(server).not.toContain('./normalize.mjs');
    expect(server).not.toContain('/api/');
  });
});
