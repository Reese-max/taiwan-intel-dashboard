import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — JS ESM module without types
import {
  BUILD_REPLAY_FIXTURE,
  canUseBuildReplayFixture,
  seedBuildReplayFixture,
} from "../scripts/lib/build-replay-fixture.mjs";

// pipeline-state 的 public/data 快照不在 main；detached clean replay（npm test /
// npm run build）因此沒有真實資料可讀。fixture 只在「本機 replay 且沒有任何託管
// CI 標記」時啟用，託管建置仍必須 fail-closed，不能用假資料掩蓋產物缺失。
function tempDataDir(prefix: string): { root: string; dataDir: string } {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  return { root, dataDir: join(root, "data") };
}

describe("build replay fixture（hermetic clean replay）", () => {
  it("僅在本機 replay 環境允許：CI=true 且沒有任何託管 CI 標記", () => {
    expect(canUseBuildReplayFixture({ CI: "true" })).toBe(true);
    expect(canUseBuildReplayFixture({ CI: "true", GITHUB_ACTIONS: "true" })).toBe(false);
    // 本專案部署於 Cloudflare Pages；CF_PAGES 建置同樣不得用假資料當正式產物。
    expect(canUseBuildReplayFixture({ CI: "true", CF_PAGES: "1" })).toBe(false);
    expect(canUseBuildReplayFixture({ CI: "true", GITLAB_CI: "true" })).toBe(false);
    expect(canUseBuildReplayFixture({ CI: "true", JENKINS_URL: "https://ci.invalid" })).toBe(false);
    // 一般本機執行（沒有 CI 標記）維持既有 fail-closed 行為。
    expect(canUseBuildReplayFixture({})).toBe(false);
    expect(canUseBuildReplayFixture({ CI: "false" })).toBe(false);
    expect(canUseBuildReplayFixture({ CI: "1" })).toBe(false);
  });

  it("fixture 提供兩 scope 的最小可建置事件，欄位足以通過關聯建置", () => {
    expect(Object.keys(BUILD_REPLAY_FIXTURE).sort()).toEqual(["domestic", "international"]);
    for (const scope of ["domestic", "international"] as const) {
      const events = BUILD_REPLAY_FIXTURE[scope];
      expect(Array.isArray(events)).toBe(true);
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

  it("只補缺少的檔案，絕不覆蓋既有 pipeline-state 快照", () => {
    const { root, dataDir } = tempDataDir("build-replay-preserve");
    try {
      expect(seedBuildReplayFixture({ dataDir, env: { CI: "true" } }).seeded).toBe(true);
      expect(existsSync(join(dataDir, "domestic.json"))).toBe(true);
      expect(existsSync(join(dataDir, "international.json"))).toBe(true);

      const real = [
        { id: "real-domestic", scope: "domestic", source: { type: "news-rss", recordRef: "https://example.invalid/real" } },
      ];
      writeFileSync(join(dataDir, "domestic.json"), JSON.stringify(real));

      const second = seedBuildReplayFixture({ dataDir, env: { CI: "true" } });
      expect(second.seeded).toBe(false);
      expect(second.reason).toBe("data-present");
      expect(JSON.parse(readFileSync(join(dataDir, "domestic.json"), "utf8"))).toEqual(real);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("託管 CI 或非 replay 環境完全不寫檔（fail-closed）", () => {
    for (const env of [{ CI: "true", GITHUB_ACTIONS: "true" }, { CI: "true", CF_PAGES: "1" }, {}]) {
      const { root, dataDir } = tempDataDir("build-replay-denied");
      try {
        const result = seedBuildReplayFixture({ dataDir, env });
        expect(result.seeded).toBe(false);
        expect(result.reason).toBe("fixture-not-allowed");
        expect(existsSync(dataDir)).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("寫檔失敗時清掉自己寫入的檔案，不留下半套假快照", () => {
    const { root, dataDir } = tempDataDir("build-replay-partial");
    try {
      const written: string[] = [];
      const writeFile = (file: string) => {
        if (written.length === 1) throw new Error("disk full");
        written.push(file);
      };
      expect(() => seedBuildReplayFixture({ dataDir, env: { CI: "true" }, writeFile })).toThrow("disk full");
      expect(written).toHaveLength(1);
      expect(existsSync(written[0])).toBe(false);
      expect(existsSync(join(dataDir, "international.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
