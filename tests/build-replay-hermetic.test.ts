import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — JS ESM modules without types
import { buildNetwork } from "../scripts/build-network.mjs";
import {
  BUILD_REPLAY_FIXTURE,
  HOSTED_CI_ENV,
  canUseBuildReplayFixture,
  cleanupBuildReplayFixture,
  purgeStaleBuildReplayFixture,
  writeBuildReplayFixture,
} from "../scripts/lib/build-replay-fixture.mjs";
// @ts-expect-error — JS ESM module without types
import { validateNetworkContract } from "../scripts/lib/network-contract.mjs";

// 監管 clean replay 必須能在沒有 pipeline-state 快照的 detached worktree 建置，
// 但絕不能把假事件寫進託管／正式建置，也不能覆蓋或摻入真實資料。
function tempDataDir(prefix: string): { root: string; dataDir: string } {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  return { root, dataDir: join(root, "data") };
}

const REPLAY_ENV = { CI: "true" };

describe("build replay fixture（hermetic clean replay）", () => {
  it("只在沒有任何託管 CI 標記時允許，且以「變數存在」判斷（空字串也算託管）", () => {
    expect(canUseBuildReplayFixture(REPLAY_ENV)).toBe(true);
    // Cloudflare Pages / Workers Builds / GitHub Actions 一律拒絕。
    expect(canUseBuildReplayFixture({ CI: "true", GITHUB_ACTIONS: "" })).toBe(false);
    expect(canUseBuildReplayFixture({ CI: "true", CF_PAGES: "1" })).toBe(false);
    expect(canUseBuildReplayFixture({ CI: "true", WORKERS_CI: "1" })).toBe(false);
    expect(canUseBuildReplayFixture({ CI: "true", GITLAB_CI: "true" })).toBe(false);
    expect(canUseBuildReplayFixture({ CI: "true", JENKINS_URL: "https://ci.invalid" })).toBe(false);
    expect(canUseBuildReplayFixture({ CI: "true", CI_NAME: "codeship" })).toBe(false);
    expect(canUseBuildReplayFixture({ CI: "true", APPVEYOR: "True" })).toBe(false);
    // 一般本機執行（沒有 CI 標記）維持既有 fail-closed 行為。
    expect(canUseBuildReplayFixture({})).toBe(false);
    expect(canUseBuildReplayFixture({ CI: "false" })).toBe(false);
    expect(canUseBuildReplayFixture({ CI: "1" })).toBe(false);
  });

  it("託管標記清單涵蓋已知託管建置環境（清單被刪減時這裡會紅）", () => {
    for (const marker of [
      "GITHUB_ACTIONS",
      "CF_PAGES",
      "CF_BUILD_ID",
      "WORKERS_CI",
      "GITLAB_CI",
      "CIRCLECI",
      "TRAVIS",
      "APPVEYOR",
      "DRONE",
      "JENKINS_URL",
      "TEAMCITY_VERSION",
      "CODEBUILD_BUILD_ID",
      "BITBUCKET_BUILD_NUMBER",
      "BUILDKITE",
      "VERCEL",
      "NETLIFY",
    ]) {
      expect(HOSTED_CI_ENV).toContain(marker);
    }
  });

  it("明確 opt-in 才可在沒有 CI 標記時啟用，非 \"1\" 一律停用", () => {
    expect(canUseBuildReplayFixture({ BUILD_REPLAY_FIXTURE: "1" })).toBe(true);
    expect(canUseBuildReplayFixture({ BUILD_REPLAY_FIXTURE: "0" })).toBe(false);
    expect(canUseBuildReplayFixture({ BUILD_REPLAY_FIXTURE: "" })).toBe(false);
    expect(canUseBuildReplayFixture({ BUILD_REPLAY_FIXTURE: "true" })).toBe(false);
    expect(canUseBuildReplayFixture({ BUILD_REPLAY_FIXTURE: "1", CI: "true" })).toBe(true);
    // 託管環境連明確 opt-in 都無效。
    expect(canUseBuildReplayFixture({ BUILD_REPLAY_FIXTURE: "1", GITHUB_ACTIONS: "true" })).toBe(false);
  });

  it("fixture 產生的情報網符合 network 契約（isNewsLikeEvent 不會把它濾掉）", () => {
    const network = buildNetwork(
      BUILD_REPLAY_FIXTURE.domestic,
      BUILD_REPLAY_FIXTURE.international,
      "2026-01-01T00:00:00.000Z",
      { snapshotId: "build-replay-fixture" },
    );
    expect(validateNetworkContract(network)).toEqual([]);
    expect(network.domestic.stats.events).toBe(1);
    expect(network.international.stats.events).toBe(1);
    expect(network.excluded).toEqual({ domestic: 0, international: 0 });
  });

  it("兩 scope 的事件欄位足以建置（id/scope/source 齊全）", () => {
    expect(Object.keys(BUILD_REPLAY_FIXTURE).sort()).toEqual(["domestic", "international"]);
    for (const scope of ["domestic", "international"] as const) {
      const events = BUILD_REPLAY_FIXTURE[scope];
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.id).toBeTruthy();
        expect(event.title).toBeTruthy();
        expect(event.scope).toBe(scope);
        expect(event.source?.type).toBe("news-rss");
        expect(event.source?.recordRef).toBeTruthy();
      }
    }
  });

  it("沒有真實快照時才寫入 fixture", () => {
    const { root, dataDir } = tempDataDir("build-replay-seed");
    try {
      expect(writeBuildReplayFixture(REPLAY_ENV, dataDir)).toBe(true);
      expect(existsSync(join(dataDir, "domestic.json"))).toBe(true);
      expect(existsSync(join(dataDir, "international.json"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("任一真實事件檔存在就整組拒絕（不產生真實 + 假資料混合快照）", () => {
    for (const present of ["domestic.json", "international.json"] as const) {
      const { root, dataDir } = tempDataDir("build-replay-preserve");
      try {
        writeBuildReplayFixture(REPLAY_ENV, dataDir);
        rmSync(join(dataDir, present));
        const real = [
          {
            id: `real-${present}`,
            scope: present.replace(".json", ""),
            source: { type: "news-rss", recordRef: "https://example.invalid/real" },
          },
        ];
        writeFileSync(join(dataDir, present), JSON.stringify(real));

        expect(writeBuildReplayFixture(REPLAY_ENV, dataDir)).toBe(false);
        const survivors = existsSync(dataDir) ? JSON.parse(readFileSync(join(dataDir, present), "utf8")) : null;
        expect(survivors).toEqual(real);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("託管 CI 或非 replay 環境完全不寫檔（fail-closed）", () => {
    for (const env of [{ CI: "true", GITHUB_ACTIONS: "true" }, { CI: "true", CF_PAGES: "1" }, {}]) {
      const { root, dataDir } = tempDataDir("build-replay-denied");
      try {
        expect(writeBuildReplayFixture(env, dataDir)).toBe(false);
        expect(existsSync(dataDir)).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("寫檔中途失敗時回滾已寫入的 fixture，不留半套假快照", () => {
    const { root, dataDir } = tempDataDir("build-replay-partial");
    try {
      // 第二個 key 落在不存在的子目錄，確定在第一個檔案寫入後才失敗。
      const fixture = { domestic: BUILD_REPLAY_FIXTURE.domestic, "missing/dir": BUILD_REPLAY_FIXTURE.international };
      expect(() => writeBuildReplayFixture(REPLAY_ENV, dataDir, fixture)).toThrow();
      expect(existsSync(join(dataDir, "domestic.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("整組都是 fixture 時，連帶清掉衍生的 network.json / manifest.json", () => {
    const { root, dataDir } = tempDataDir("build-replay-derived");
    try {
      writeBuildReplayFixture(REPLAY_ENV, dataDir);
      writeFileSync(join(dataDir, "network.json"), JSON.stringify({ snapshotId: "cohort-fixture" }));
      writeFileSync(join(dataDir, "manifest.json"), JSON.stringify({ snapshotId: "cohort-fixture" }));

      const result = cleanupBuildReplayFixture(dataDir);
      expect(result.fixtureDriven).toBe(true);
      expect(result.removed.sort()).toEqual(
        [join(dataDir, "domestic.json"), join(dataDir, "international.json"), join(dataDir, "manifest.json"), join(dataDir, "network.json")].sort(),
      );
      expect(existsSync(join(dataDir, "network.json"))).toBe(false);
      expect(existsSync(join(dataDir, "manifest.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("purge：建置前清掉殘留 fixture（真實資料不動），避免後續 build 把它當既有狀態", () => {
    const { root, dataDir } = tempDataDir("build-replay-purge");
    try {
      writeBuildReplayFixture(REPLAY_ENV, dataDir);
      writeFileSync(join(dataDir, "network.json"), JSON.stringify({ snapshotId: "cohort-fixture" }));
      const removed = purgeStaleBuildReplayFixture(dataDir);
      expect(removed.sort()).toEqual([join(dataDir, "domestic.json"), join(dataDir, "international.json")]);
      // 殘留清掉後才可以再次 seed；network.json 是衍生物，不影響事件快照判定。
      expect(writeBuildReplayFixture(REPLAY_ENV, dataDir)).toBe(true);
      // 有真實資料時 purge 不動它。
      const real = [{ id: "real", scope: "domestic", source: { type: "news-rss", recordRef: "https://example.invalid/real" } }];
      writeFileSync(join(dataDir, "domestic.json"), JSON.stringify(real));
      writeFileSync(join(dataDir, "international.json"), JSON.stringify(real));
      purgeStaleBuildReplayFixture(dataDir);
      expect(JSON.parse(readFileSync(join(dataDir, "domestic.json"), "utf8"))).toEqual(real);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cleanup 只刪內容仍等於 fixture 的檔案，真實資料保留", () => {
    const { root, dataDir } = tempDataDir("build-replay-cleanup");
    try {
      writeBuildReplayFixture(REPLAY_ENV, dataDir);
      const real = [{ id: "real-domestic", scope: "domestic", source: { type: "news-rss", recordRef: "https://example.invalid/real" } }];
      writeFileSync(join(dataDir, "domestic.json"), JSON.stringify(real));

      // 只清掉仍是 fixture 的那一個；已被真實資料覆寫的保留，且不動衍生物。
      writeFileSync(join(dataDir, "network.json"), JSON.stringify({ fixtureDriven: true }));
      const result = cleanupBuildReplayFixture(dataDir);
      expect(result.removed).toEqual([join(dataDir, "international.json")]);
      expect(result.fixtureDriven).toBe(false);
      expect(JSON.parse(readFileSync(join(dataDir, "domestic.json"), "utf8"))).toEqual(real);
      expect(existsSync(join(dataDir, "network.json"))).toBe(true);
      // 已清除後再清一次是 no-op。
      expect(cleanupBuildReplayFixture(dataDir).removed).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("建置腳本確實接上 fixture（防止 hook 被無聲移除）", () => {
  const script = (name: string) => readFileSync(new URL(`../scripts/${name}`, import.meta.url), "utf8");

  it("build-network：建置前 purge 殘留、seed fixture、失敗路徑 cleanup", () => {
    const source = script("build-network.mjs");
    expect(source).toContain("purgeStaleBuildReplayFixture(DATA_DIR)");
    expect(source).toContain("writeBuildReplayFixture(process.env, DATA_DIR)");
    // 失敗時也要清，而且必須在回報錯誤之前（否則下一次 build 會把 fixture 當既有狀態）。
    const catchIndex = source.indexOf("catch (error)");
    expect(catchIndex).toBeGreaterThan(-1);
    const cleanupIndex = source.indexOf("cleanupBuildReplayFixture(DATA_DIR)", catchIndex);
    expect(cleanupIndex).toBeGreaterThan(catchIndex);
    expect(cleanupIndex).toBeLessThan(source.indexOf("process.exitCode", catchIndex));
  });

  it("build-static：清除掛在 exit，且在讀取 public/data 之前就掛上", () => {
    const source = script("build-static.mjs");
    const hookIndex = source.indexOf('process.once("exit"');
    expect(hookIndex).toBeGreaterThan(-1);
    expect(source.indexOf("cleanupBuildReplayFixture()", hookIndex)).toBeGreaterThan(hookIndex);
    // 掛在 exit 上代表一定發生在 public/data 讀取、寫入 dist/data 之後；這裡再釘住
    // 「註冊發生在任何資料處理之前」，避免把清理誤寫成 build 前執行。
    expect(hookIndex).toBeLessThan(source.indexOf('readdirSync("public/data")'));
  });

  it("module 路徑可解析（scripts/lib 存在該檔）", () => {
    expect(existsSync(fileURLToPath(new URL("../scripts/lib/build-replay-fixture.mjs", import.meta.url)))).toBe(true);
  });
});
