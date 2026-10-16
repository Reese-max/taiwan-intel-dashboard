import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOSTED_CI_ENV, writeBuildReplayFixture } from "../scripts/lib/build-replay-fixture.mjs";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, mkdirSync: vi.fn(actual.mkdirSync), writeFileSync: vi.fn(actual.writeFileSync) };
});

const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const dirs: string[] = [];

function makeDataDir() {
  const dir = fs.mkdtempSync(join(tmpdir(), "build-replay-safety-"));
  dirs.push(dir);
  return join(dir, "public", "data");
}

afterEach(() => {
  vi.mocked(fs.mkdirSync).mockImplementation(realFs.mkdirSync);
  vi.mocked(fs.writeFileSync).mockImplementation(realFs.writeFileSync);
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("build replay fixture safety", () => {
  it("CLI seeds a clean replay, then rejects persisted fixtures in denied environments before changing outputs", () => {
    const dataDir = makeDataDir();
    const root = dirname(dirname(dataDir));
    fs.cpSync("scripts", join(root, "scripts"), { recursive: true });
    const env = { ...process.env };
    for (const name of [...HOSTED_CI_ENV, "CI", "BUILD_REPLAY_FIXTURE"]) delete env[name];
    const run = (script: string, overrides: Record<string, string>) => spawnSync(
      process.execPath, [join(root, "scripts", `${script}.mjs`)],
      { cwd: root, env: { ...env, ...overrides }, encoding: "utf8", timeout: 10_000 },
    );

    for (const denied of [{}, { CI: "true", GITHUB_ACTIONS: "true" }]) {
      expect(run("build-network", denied).status).toBe(1);
      expect(fs.existsSync(dataDir)).toBe(false);
    }
    const replay = run("build-network", { CI: "true" });
    expect(replay.stderr).toBe("");
    expect(replay.status).toBe(0);
    const networkPath = join(dataDir, "network.json");
    const before = fs.readFileSync(networkPath, "utf8");
    const network = JSON.parse(before);
    expect(network.domestic.stats.events).toBe(1);
    expect(network.international.stats.events).toBe(1);
    expect(JSON.parse(fs.readFileSync(join(dataDir, "manifest.json"), "utf8")).snapshotId).toBe(network.snapshotId);
    fs.mkdirSync(join(root, "dist"));
    const sentinel = join(root, "dist", "keep.txt");
    fs.writeFileSync(sentinel, "existing build");

    for (const denied of [{}, { CI: "true", BUILD_REPLAY_FIXTURE: "0" }, { CI: "true", GITHUB_ACTIONS: "true" }]) {
      for (const script of ["build-network", "build-static"]) {
        const result = run(script, denied);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("build replay fixture is not allowed");
        expect(fs.readFileSync(networkPath, "utf8")).toBe(before);
        expect(fs.readFileSync(sentinel, "utf8")).toBe("existing build");
      }
    }

    for (const scope of ["domestic", "international"]) {
      const file = join(dataDir, `${scope}.json`);
      const events = JSON.parse(fs.readFileSync(file, "utf8"));
      events[0].source.name = "restored-source";
      fs.writeFileSync(file, JSON.stringify(events));
    }
    expect(run("build-network", { CI: "true", GITHUB_ACTIONS: "true" }).status).toBe(0);
  });

  it("rejects a restore appearing after the existence check without mixing in fixtures", () => {
    const dataDir = makeDataDir();
    vi.mocked(fs.mkdirSync).mockImplementationOnce((...args) => {
      realFs.mkdirSync(dataDir, { recursive: true });
      realFs.writeFileSync(join(dataDir, "summary.json"), "real summary");
      return realFs.mkdirSync(...args);
    });
    expect(() => writeBuildReplayFixture({ CI: "true" }, dataDir)).toThrow();
    expect(fs.readdirSync(dataDir)).toEqual(["summary.json"]);
    expect(fs.readFileSync(join(dataDir, "summary.json"), "utf8")).toBe("real summary");
    expect(fs.readdirSync(dirname(dataDir))).toEqual(["data"]);
  });

  it("does not delete real snapshots restored while fixture writes are in progress", () => {
    const dataDir = makeDataDir();
    vi.mocked(fs.writeFileSync).mockImplementationOnce((...args) => {
      realFs.writeFileSync(...args);
      realFs.mkdirSync(dataDir, { recursive: true });
      realFs.writeFileSync(join(dataDir, "domestic.json"), "real domestic");
      realFs.writeFileSync(join(dataDir, "international.json"), "real international");
    });
    expect(() => writeBuildReplayFixture({ CI: "true" }, dataDir)).toThrow();
    expect(fs.existsSync(join(dataDir, "domestic.json"))).toBe(true);
    expect(fs.readFileSync(join(dataDir, "domestic.json"), "utf8")).toBe("real domestic");
    expect(fs.readFileSync(join(dataDir, "international.json"), "utf8")).toBe("real international");
    expect(fs.readdirSync(dirname(dataDir))).toEqual(["data"]);
  });

  it("cleans a partially written file after a write error without publishing an incomplete data directory", () => {
    const dataDir = makeDataDir();
    vi.mocked(fs.writeFileSync)
      .mockImplementationOnce(realFs.writeFileSync)
      .mockImplementationOnce((file) => {
        realFs.writeFileSync(file, "{");
        throw new Error("ENOSPC");
      });
    expect(() => writeBuildReplayFixture({ CI: "true" }, dataDir)).toThrow("ENOSPC");
    expect(fs.existsSync(dataDir)).toBe(false);
    expect(fs.readdirSync(dirname(dataDir))).toEqual([]);
  });
});
