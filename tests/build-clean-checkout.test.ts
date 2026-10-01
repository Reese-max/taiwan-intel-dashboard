import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { prepareCleanCheckoutBuild } from "../scripts/prepare-build-data.mjs";
// @ts-expect-error — JS ESM module without types
import { buildSite } from "../scripts/build-site.mjs";

const repoRoot = process.cwd();

const makeWorkspace = () => {
  const root = mkdtempSync(join(tmpdir(), "build-data-"));
  const dataDir = join(root, "public", "data");
  const fixturePath = join(root, "tests", "fixtures", "govintel-domestic.json");
  mkdirSync(join(root, "tests", "fixtures"), { recursive: true });
  writeFileSync(fixturePath, JSON.stringify([{ id: "fixture-news", title: "合成事件" }], null, 2) + "\n");
  return {
    dataDir,
    fixturePath,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
};

const listDataDir = (dataDir: string) => (existsSync(dataDir) ? readdirSync(dataDir).sort() : null);

const writeSnapshot = (dataDir: string, name: string, id: string) => {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, name), JSON.stringify([{ id, title: id }], null, 2) + "\n");
};

const scriptedRunner = (statuses: number[]) => {
  const calls: Array<{ script: string; buildDataDir: string | undefined }> = [];
  const spawn = (_command: string, args: string[], options: { env: Record<string, string | undefined> }) => {
    const script = args[args.length - 1].split("/").pop() as string;
    calls.push({ script, buildDataDir: options.env.BUILD_DATA_DIR });
    return { status: statuses[calls.length - 1] ?? 0 };
  };
  return { calls, spawn };
};

describe("clean checkout build data", () => {
  it("正式事件快照成對存在 → 沿用 public/data，不建立任何暫存輸入", () => {
    const { dataDir, fixturePath, dispose } = makeWorkspace();
    try {
      writeSnapshot(dataDir, "domestic.json", "real-domestic");
      writeSnapshot(dataDir, "international.json", "real-international");

      const prepared = prepareCleanCheckoutBuild({ dataDir, fixturePath });

      expect(prepared.seeded).toBe(false);
      expect(prepared.dataDir).toBe(dataDir);
      expect(prepared.cleanup).toBeUndefined();
      expect(listDataDir(dataDir)).toEqual(["domestic.json", "international.json"]);
    } finally {
      dispose();
    }
  });

  it("只缺一份事件快照 → fail closed，不以合成資料頂替正式資料", () => {
    for (const present of ["domestic.json", "international.json"]) {
      const { dataDir, fixturePath, dispose } = makeWorkspace();
      try {
        writeSnapshot(dataDir, present, "real-only");

        expect(() => prepareCleanCheckoutBuild({ dataDir, fixturePath })).toThrow(/成對存在/);
        expect(listDataDir(dataDir)).toEqual([present]);
      } finally {
        dispose();
      }
    }
  });

  it("資料目錄只有狀態檔、沒有事件快照 → fail closed（不覆蓋既有狀態）", () => {
    const { dataDir, fixturePath, dispose } = makeWorkspace();
    try {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(join(dataDir, "provenance.json"), "{}\n");

      expect(() => prepareCleanCheckoutBuild({ dataDir, fixturePath })).toThrow(/contains files/);
      expect(listDataDir(dataDir)).toEqual(["provenance.json"]);
    } finally {
      dispose();
    }
  });

  it("乾淨 checkout → 合成輸入落在 repo 外的暫存目錄，cleanup 後不留痕", () => {
    const { dataDir, fixturePath, dispose } = makeWorkspace();
    const prepared = prepareCleanCheckoutBuild({ dataDir, fixturePath });
    try {
      expect(prepared.seeded).toBe(true);
      expect(prepared.dataDir).not.toBe(dataDir);
      expect(prepared.dataDir.startsWith(resolve(tmpdir()))).toBe(true);
      expect(JSON.parse(readFileSync(join(prepared.dataDir, "domestic.json"), "utf8"))).toEqual([
        { id: "fixture-news", title: "合成事件" },
      ]);
      expect(JSON.parse(readFileSync(join(prepared.dataDir, "international.json"), "utf8"))).toEqual([]);
      // repo 資料層全程未被寫入：合成事件不會留在工作樹被後續 refresh 帶回正式快照
      expect(listDataDir(dataDir)).toBeNull();
    } finally {
      prepared.cleanup?.();
      dispose();
    }
    expect(existsSync(prepared.dataDir as string)).toBe(false);
  });
});

describe("build site orchestration", () => {
  it("無正式資料 → 兩個 build 腳本都拿到暫存 BUILD_DATA_DIR，結束後清掉暫存", () => {
    const { dataDir, fixturePath, dispose } = makeWorkspace();
    const { calls, spawn } = scriptedRunner([0, 0]);
    const lines: string[] = [];
    try {
      const code = buildSite({
        root: repoRoot,
        prepareOptions: { dataDir, fixturePath },
        spawn,
        log: (line: string) => lines.push(line),
      });

      expect(code).toBe(0);
      expect(calls.map((call) => call.script)).toEqual(["build-network.mjs", "build-static.mjs"]);
      const staging = calls[0].buildDataDir as string;
      expect(staging).toBe(calls[1].buildDataDir);
      expect(existsSync(staging)).toBe(false);
      expect(listDataDir(dataDir)).toBeNull();
      expect(lines.join("\n")).toMatch(/合成/);
    } finally {
      dispose();
    }
  });

  it("正式資料存在 → 不注入 BUILD_DATA_DIR，子行程沿用 public/data", () => {
    const { dataDir, fixturePath, dispose } = makeWorkspace();
    const { calls, spawn } = scriptedRunner([0, 0]);
    try {
      writeSnapshot(dataDir, "domestic.json", "real-domestic");
      writeSnapshot(dataDir, "international.json", "real-international");

      const code = buildSite({ root: repoRoot, prepareOptions: { dataDir, fixturePath }, spawn, log: () => {} });

      expect(code).toBe(0);
      expect(calls.map((call) => call.buildDataDir)).toEqual([undefined, undefined]);
    } finally {
      dispose();
    }
  });

  it("前段 build 失敗 → 不跑下一段，仍清掉暫存並回傳失敗碼", () => {
    const { dataDir, fixturePath, dispose } = makeWorkspace();
    const { calls, spawn } = scriptedRunner([1]);
    try {
      const code = buildSite({ root: repoRoot, prepareOptions: { dataDir, fixturePath }, spawn, log: () => {} });

      expect(code).toBe(1);
      expect(calls.map((call) => call.script)).toEqual(["build-network.mjs"]);
      expect(existsSync(calls[0].buildDataDir as string)).toBe(false);
    } finally {
      dispose();
    }
  });
});

describe("build scripts data directory", () => {
  it("build-network 以 BUILD_DATA_DIR 為輸入輸出目錄，且不寫入 public/data", () => {
    const { dataDir, dispose } = makeWorkspace();
    const prepared = prepareCleanCheckoutBuild({ dataDir });
    const repoData = join(repoRoot, "public", "data");
    const before = listDataDir(repoData);
    try {
      const result = spawnSync(process.execPath, [join(repoRoot, "scripts", "build-network.mjs")], {
        encoding: "utf8",
        env: { ...process.env, BUILD_DATA_DIR: prepared.dataDir },
      });

      expect(result.status).toBe(0);
      const network = JSON.parse(readFileSync(join(prepared.dataDir, "network.json"), "utf8"));
      expect(network.domestic.stats.events).toBeGreaterThan(0);
      expect(existsSync(join(prepared.dataDir, "manifest.json"))).toBe(true);
      expect(listDataDir(repoData)).toEqual(before);
    } finally {
      prepared.cleanup?.();
      dispose();
    }
  });

  it("兩個 build 腳本的資料目錄都只經由 BUILD_DATA_DIR 決定，不留硬編碼路徑", () => {
    for (const script of ["build-network.mjs", "build-static.mjs"]) {
      expect(readFileSync(join(repoRoot, "scripts", script), "utf8")).toMatch(/process\.env\.BUILD_DATA_DIR/);
    }
    const staticSource = readFileSync(join(repoRoot, "scripts", "build-static.mjs"), "utf8");
    expect(staticSource).not.toMatch(/(?:readdirSync|readFileSync|minifyOrCopyJson|writeCohortManifest)\(\s*[`"']public\/data/);
    expect(staticSource).toContain("readdirSync(DATA_DIR)");
    expect(staticSource).toContain("writeCohortManifest(DATA_DIR, manifest)");
  });
});
