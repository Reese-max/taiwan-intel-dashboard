import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
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
    root,
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

// 檔案內容指紋：證明測試執行前後 dist/data 與 public/data 逐位元組相同
const fingerprintDir = (dir: string) =>
  listDataDir(dir)?.map((name) => `${name}:${readFileSync(join(dir, name)).toString("base64")}`).join("|") ?? null;

const scriptedRunner = (statuses: number[]) => {
  const calls: Array<{ script: string; env: Record<string, string | undefined> }> = [];
  const spawn = (_command: string, args: string[], options: { env: Record<string, string | undefined> }) => {
    calls.push({ script: basename(args[args.length - 1]), env: options.env });
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

  it("committed fixture 缺失 → fail closed（不用空資料冒充可建置輸入）", () => {
    const { dataDir, fixturePath, dispose } = makeWorkspace();
    try {
      rmSync(fixturePath);

      expect(() => prepareCleanCheckoutBuild({ dataDir, fixturePath })).toThrow(/fixture missing/);
      expect(existsSync(dataDir)).toBe(false);
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

  it("合成輸入寫入失敗 → 不留下半套暫存目錄", () => {
    const { root, dataDir, dispose } = makeWorkspace();
    const prefix = "build-data-leak-probe-";
    const staged = () => readdirSync(tmpdir()).filter((name) => name.startsWith(prefix)).sort();
    try {
      // fixture 指向目錄：存在但無法被 copy 成檔案，模擬寫入中途失敗
      const brokenFixture = join(root, "tests", "fixtures", "fixture-as-dir");
      mkdirSync(brokenFixture);
      const before = staged();

      expect(() => prepareCleanCheckoutBuild({ dataDir, fixturePath: brokenFixture, stagingPrefix: prefix })).toThrow();
      expect(staged()).toEqual(before);
    } finally {
      dispose();
    }
  });
});

describe("build site orchestration", () => {
  it("無正式資料 → 兩個 build 腳本都拿到暫存 BUILD_DATA_DIR 與合成標記，結束後清掉暫存", () => {
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
      const staging = calls[0].env.BUILD_DATA_DIR as string;
      expect(staging).toBe(calls[1].env.BUILD_DATA_DIR);
      expect(calls.map((call) => call.env.BUILD_SYNTHETIC_INPUT)).toEqual(["1", "1"]);
      expect(existsSync(staging)).toBe(false);
      expect(listDataDir(dataDir)).toBeNull();
      expect(lines.join("\n")).toMatch(/合成/);
    } finally {
      dispose();
    }
  });

  it("正式資料存在 → 不注入 BUILD_DATA_DIR／合成標記，子行程沿用 public/data", () => {
    const { dataDir, fixturePath, dispose } = makeWorkspace();
    const { calls, spawn } = scriptedRunner([0, 0]);
    try {
      writeSnapshot(dataDir, "domestic.json", "real-domestic");
      writeSnapshot(dataDir, "international.json", "real-international");

      const code = buildSite({ root: repoRoot, prepareOptions: { dataDir, fixturePath }, spawn, log: () => {} });

      expect(code).toBe(0);
      expect(calls.map((call) => call.env.BUILD_DATA_DIR)).toEqual([undefined, undefined]);
      expect(calls.map((call) => call.env.BUILD_SYNTHETIC_INPUT)).toEqual([undefined, undefined]);
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
      expect(existsSync(calls[0].env.BUILD_DATA_DIR as string)).toBe(false);
    } finally {
      dispose();
    }
  });

  it("後段 build 失敗 → 回傳該段失敗碼（非固定 1），暫存一樣清乾淨", () => {
    const { dataDir, fixturePath, dispose } = makeWorkspace();
    const { calls, spawn } = scriptedRunner([0, 2]);
    try {
      const code = buildSite({ root: repoRoot, prepareOptions: { dataDir, fixturePath }, spawn, log: () => {} });

      expect(code).toBe(2);
      expect(calls.map((call) => call.script)).toEqual(["build-network.mjs", "build-static.mjs"]);
      expect(existsSync(calls[0].env.BUILD_DATA_DIR as string)).toBe(false);
    } finally {
      dispose();
    }
  });

  it("外部殘留的 BUILD_DATA_DIR／BUILD_SYNTHETIC_INPUT 不得蓋過本輪 prepare 的驗證結果", () => {
    const { dataDir, fixturePath, dispose } = makeWorkspace();
    const ambient = mkdtempSync(join(tmpdir(), "build-data-ambient-"));
    const { calls, spawn } = scriptedRunner([0, 0]);
    try {
      writeSnapshot(dataDir, "domestic.json", "real-domestic");
      writeSnapshot(dataDir, "international.json", "real-international");

      const code = buildSite({
        root: repoRoot,
        prepareOptions: { dataDir, fixturePath },
        spawn,
        log: () => {},
        env: { PATH: process.env.PATH, BUILD_DATA_DIR: ambient, BUILD_SYNTHETIC_INPUT: "1" },
      });

      expect(code).toBe(0);
      expect(calls.map((call) => call.env.BUILD_DATA_DIR)).toEqual([undefined, undefined]);
      expect(calls.map((call) => call.env.BUILD_SYNTHETIC_INPUT)).toEqual([undefined, undefined]);
      expect(calls[0].env.PATH).toBe(process.env.PATH);
    } finally {
      rmSync(ambient, { recursive: true, force: true });
      dispose();
    }
  });

  it("npm script 確實走協調器（否則整條修法會被繞過）", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    for (const script of ["build", "build:static"]) {
      expect(pkg.scripts[script]).toContain("node scripts/build-site.mjs");
    }
  });
});

describe("build scripts data directory", () => {
  it("build-network 以 BUILD_DATA_DIR 產出情報網，既不寫 public/data 也不覆蓋 dist/data", () => {
    const { dataDir, dispose } = makeWorkspace();
    const prepared = prepareCleanCheckoutBuild({ dataDir });
    // 在獨立 ROOT 執行：dist/data 事先放一份 sentinel，證明「不鏡射」是真的被驗到
    // （CI 的 npm test 跑在 build 之前，repo 的 dist/data 那時還不存在，用它驗會是空證）。
    const root = mkdtempSync(join(tmpdir(), "build-network-root-"));
    cpSync(join(repoRoot, "scripts"), join(root, "scripts"), { recursive: true });
    const rootDist = join(root, "dist", "data");
    mkdirSync(rootDist, { recursive: true });
    const sentinel = '{"sentinel":"real"}\n';
    writeFileSync(join(rootDist, "network.json"), sentinel);
    writeFileSync(join(rootDist, "manifest.json"), sentinel);
    const expectedDist = (name: string) => `${name}:${Buffer.from(sentinel).toString("base64")}`;
    const repoData = join(repoRoot, "public", "data");
    const repoDist = join(repoRoot, "dist", "data");
    const before = [fingerprintDir(repoData), fingerprintDir(repoDist)];
    try {
      const result = spawnSync(process.execPath, [join(root, "scripts", "build-network.mjs")], {
        encoding: "utf8",
        env: { ...process.env, BUILD_DATA_DIR: prepared.dataDir, BUILD_SYNTHETIC_INPUT: "1" },
      });

      expect(result.status).toBe(0);
      const network = JSON.parse(readFileSync(join(prepared.dataDir, "network.json"), "utf8"));
      expect(network.domestic.stats.events).toBeGreaterThan(0);
      expect(existsSync(join(prepared.dataDir, "manifest.json"))).toBe(true);
      // 合成輸入不得覆蓋既有可部署產物，也不得寫回資料層
      expect(fingerprintDir(rootDist)).toBe([expectedDist("manifest.json"), expectedDist("network.json")].join("|"));
      expect(existsSync(join(root, "public"))).toBe(false);
      expect([fingerprintDir(repoData), fingerprintDir(repoDist)]).toEqual(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
      prepared.cleanup?.();
      dispose();
    }
  });

  it("build-static 以 BUILD_DATA_DIR 為來源，且不寫入 public/data", () => {
    const { dataDir, dispose } = makeWorkspace();
    const prepared = prepareCleanCheckoutBuild({ dataDir });
    // 額外放一份 sentinel，證明 dist 的每個檔案都來自 BUILD_DATA_DIR
    writeFileSync(join(prepared.dataDir, "provenance.json"), '{"sentinel":true}\n');
    // 在獨立 cwd 執行：dist/ 產物落在暫存目錄，不動開發者的 dist/
    const cwd = mkdtempSync(join(tmpdir(), "build-static-cwd-"));
    for (const entry of ["src", "static", "node_modules"]) {
      // win32 用 junction：dir symlink 需要額外權限，會讓 Windows 開發者的 npm test 全紅
      symlinkSync(join(repoRoot, entry), join(cwd, entry), process.platform === "win32" ? "junction" : "dir");
    }
    const repoData = join(repoRoot, "public", "data");
    const before = fingerprintDir(repoData);
    try {
      const result = spawnSync(process.execPath, [join(repoRoot, "scripts", "build-static.mjs")], {
        cwd,
        encoding: "utf8",
        env: { ...process.env, BUILD_DATA_DIR: prepared.dataDir, BUILD_SYNTHETIC_INPUT: "1" },
      });

      expect(result.status).toBe(0);
      expect(JSON.parse(readFileSync(join(cwd, "dist", "data", "provenance.json"), "utf8"))).toEqual({ sentinel: true });
      expect(JSON.parse(readFileSync(join(cwd, "dist", "data", "domestic.json"), "utf8"))).toEqual(
        JSON.parse(readFileSync(join(repoRoot, "tests", "fixtures", "govintel-domestic.json"), "utf8")),
      );
      expect(fingerprintDir(repoData)).toEqual(before);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
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
  });
});
