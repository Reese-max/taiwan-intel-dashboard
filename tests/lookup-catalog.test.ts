import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("retired lookup catalog UI", () => {
  it("is absent from source and the static build entrypoint", () => {
    const root = process.cwd();
    const buildScript = readFileSync(join(root, "scripts", "build-static.mjs"), "utf8");

    expect(existsSync(join(root, "src", "query.ts"))).toBe(false);
    expect(existsSync(join(root, "src", "styles", "query.css"))).toBe(false);
    expect(buildScript).not.toContain("query.html");
    expect(buildScript).not.toContain("src/query.ts");
  });
});
