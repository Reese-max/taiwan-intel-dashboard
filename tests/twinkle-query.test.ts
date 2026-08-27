import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("retired Twinkle integration", () => {
  it("has no client modules or active runtime/config references", () => {
    const root = process.cwd();
    for (const path of [
      join(root, "scripts", "lib", "mcp-client.mjs"),
      join(root, "scripts", "lib", "twinkle-query.mjs"),
      join(root, "server", "twinkle.mjs"),
    ]) expect(existsSync(path)).toBe(false);

    const activeFiles = [
      "package.json",
      ".env.example",
      ".github/workflows/update-and-deploy.yml",
      ".github/workflows/deploy.yml",
      "scripts/fetch-live.mjs",
      "server/index.mjs",
    ];
    const retiredPattern = /TWINKLE_(?:MCP|HUB)|twinkle-hub|mcp-client|twinkle-query/i;
    for (const file of activeFiles) {
      expect(readFileSync(join(root, file), "utf8"), file).not.toMatch(retiredPattern);
    }
  });
});
