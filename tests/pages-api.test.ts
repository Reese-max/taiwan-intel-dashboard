import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("retired Cloudflare Pages API", () => {
  it("does not ship the former runtime proxy", () => {
    const root = process.cwd();
    const buildScript = readFileSync(join(root, "scripts", "build-static.mjs"), "utf8");

    for (const path of [
      join(root, "functions", "api", "[[path]].js"),
      join(root, "functions", "_lib", "api.js"),
      join(root, "functions", "_lib", "official.js"),
    ]) expect(existsSync(path)).toBe(false);
    expect(buildScript).not.toContain("functions/");
  });
});
