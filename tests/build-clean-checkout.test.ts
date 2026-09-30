import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { ensureBuildData } from "../scripts/prepare-build-data.mjs";

describe("clean checkout build data", () => {
  it("seeds committed synthetic snapshots only when both inputs are absent", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "build-data-"));
    const dataDir = join(rootDir, "data");
    const fixturePath = join(rootDir, "fixture.json");
    try {
      const fixture = [{ id: "fixture-event" }];
      writeFileSync(fixturePath, JSON.stringify(fixture));

      expect(ensureBuildData(dataDir, fixturePath)).toBe(true);
      expect(JSON.parse(readFileSync(join(dataDir, "domestic.json"), "utf8"))).toEqual(fixture);
      expect(JSON.parse(readFileSync(join(dataDir, "international.json"), "utf8"))).toEqual([]);

      expect(ensureBuildData(dataDir, fixturePath)).toBe(false);
      expect(existsSync(join(dataDir, "domestic.json"))).toBe(true);

      const partialDir = join(rootDir, "partial");
      mkdirSync(partialDir);
      writeFileSync(join(partialDir, "provenance.json"), "{}");
      expect(() => ensureBuildData(partialDir, fixturePath)).toThrow(/data directory contains files/);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
