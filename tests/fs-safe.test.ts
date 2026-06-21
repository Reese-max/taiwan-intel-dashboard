import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyDirContents } from "../scripts/lib/fs-safe.mjs";

describe("safe filesystem cleanup", () => {
  it("empties nested directories without recursive rmSync", () => {
    const root = join(process.cwd(), "tmp-fs-safe-test");
    mkdirSync(join(root, "nested"), { recursive: true });
    writeFileSync(join(root, "a.txt"), "a");
    writeFileSync(join(root, "nested", "b.txt"), "b");

    emptyDirContents(root);

    expect(existsSync(root)).toBe(true);
    expect(existsSync(join(root, "a.txt"))).toBe(false);
    expect(existsSync(join(root, "nested"))).toBe(false);
  });
});
