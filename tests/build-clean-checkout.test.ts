import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, mkdirSync: vi.fn(fs.mkdirSync), copyFileSync: vi.fn(fs.copyFileSync) };
});

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

  it.each(["domestic.json", "international.json"])("preserves %s published after the absence checks", async (name) => {
    const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const rootDir = mkdtempSync(join(tmpdir(), "build-data-race-"));
    const dataDir = join(rootDir, "data");
    const fixturePath = join(rootDir, "fixture.json");
    const snapshotPath = join(dataDir, name);
    const snapshot = '[{"id":"real-pipeline-event"}]\n';
    try {
      writeFileSync(fixturePath, '[{"id":"fixture-event"}]\n');
      vi.mocked(mkdirSync).mockImplementationOnce((path, options) => {
        const result = fs.mkdirSync(path, options);
        // A concurrent refresh publishes after the seed's absence checks.
        writeFileSync(snapshotPath, snapshot);
        return result;
      });

      let error: unknown;
      try {
        ensureBuildData(dataDir, fixturePath);
      } catch (caught) {
        error = caught;
      }
      expect(readFileSync(snapshotPath, "utf8")).toBe(snapshot);
      expect(error).toMatchObject({ code: "EEXIST" });
      if (name === "international.json") expect(existsSync(join(dataDir, "domestic.json"))).toBe(false);
    } finally {
      vi.mocked(mkdirSync).mockImplementation(fs.mkdirSync);
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("unwinds its stub when a publisher overwrites domestic between the exclusive writes", async () => {
    const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const rootDir = mkdtempSync(join(tmpdir(), "build-data-midseed-"));
    const dataDir = join(rootDir, "data");
    const fixturePath = join(rootDir, "fixture.json");
    const domesticPath = join(dataDir, "domestic.json");
    const realSnapshot = '[{"id":"real-pipeline-event"}]\n';
    try {
      writeFileSync(fixturePath, '[{"id":"fixture-event"}]\n');
      vi.mocked(copyFileSync).mockImplementationOnce((src, dest, mode) => {
        fs.copyFileSync(src, dest, mode);
        // A publisher that doesn't use EXCL overwrites domestic right after our
        // copy; the stub international must not pair with their real snapshot.
        fs.writeFileSync(domesticPath, realSnapshot);
      });

      expect(() => ensureBuildData(dataDir, fixturePath)).toThrow(/changed during seeding/);
      expect(readFileSync(domesticPath, "utf8")).toBe(realSnapshot);
      expect(existsSync(join(dataDir, "international.json"))).toBe(false);
    } finally {
      vi.mocked(copyFileSync).mockImplementation(fs.copyFileSync);
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
