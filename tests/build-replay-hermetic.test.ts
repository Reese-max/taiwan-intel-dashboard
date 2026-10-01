import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import {
  BUILD_REPLAY_FIXTURE,
  HOSTED_CI_ENV as IMPL_HOSTED_CI_ENV,
  canUseBuildReplayFixture,
  writeBuildReplayFixture,
} from "../scripts/lib/build-replay-fixture.mjs";
// @ts-expect-error — JS ESM module without types
import { buildNetwork } from "../scripts/build-network.mjs";
// @ts-expect-error — JS ESM module without types
import { validateNetworkContract } from "../scripts/lib/network-contract.mjs";

const HOSTED_CI_ENV = [
  "GITHUB_ACTIONS",
  "CF_PAGES",
  "GITLAB_CI",
  "CIRCLECI",
  "TRAVIS",
  "APPVEYOR",
  "DRONE",
  "JENKINS_URL",
  "JENKINS_HOME",
  "TEAMCITY_VERSION",
  "CODEBUILD_BUILD_ID",
  "BITBUCKET_BUILD_NUMBER",
  "SEMAPHORE",
  "BITRISE_IO",
  "BUDDY",
  "CI_NAME",
  "CI_SYSTEM_NAME",
  "GO_PIPELINE_NAME",
  "bamboo_buildKey",
  "GITEA_ACTIONS",
  "WOODPECKER",
  "CF_BUILD_ID",
  "RENDER",
  "HARNESS_BUILD_ID",
  "VERCEL",
  "NETLIFY",
  "TF_BUILD",
  "BUILDKITE",
];

// 監管 clean replay 以 detached worktree 執行 `npm run build`，其中沒有 pipeline-state
// 的 public/data 快照。本機 replay 允許最小 fixture 讓建置保持 hermetic；
// 真正的託管 CI/CD（GitHub Actions、Cloudflare Pages 等）仍禁止用假資料
// 掩蓋 pipeline 產物缺失（fail-closed）。
describe("build replay fixture（hermetic clean replay）", () => {
  it("僅在本機 CI 環境（CI=true 且非託管建置）允許 fixture", () => {
    expect(canUseBuildReplayFixture({ CI: "true" })).toBe(true);
    // 所有已知託管建置環境一律禁用，避免假資料進入正式產物。
    for (const name of HOSTED_CI_ENV) {
      expect(canUseBuildReplayFixture({ CI: "true", [name]: "true" })).toBe(false);
    }
    expect(canUseBuildReplayFixture({})).toBe(false);
    expect(canUseBuildReplayFixture({ CI: "false" })).toBe(false);
    // CI 必須完全等於 "true"——大小寫或其他真值都不放寬。
    expect(canUseBuildReplayFixture({ CI: "TRUE" })).toBe(false);
    expect(canUseBuildReplayFixture({ CI: "1" })).toBe(false);
  });

  it("託管標記以「存在」判定：空字串／'false' 值一律拒絕，且清單涵蓋其他常見託管 CI", () => {
    // 空字串或 "false" 也可能代表環境曾被設定過——一律視為託管並拒絕。
    expect(canUseBuildReplayFixture({ CI: "true", GITHUB_ACTIONS: "" })).toBe(false);
    expect(canUseBuildReplayFixture({ CI: "true", GITHUB_ACTIONS: "false" })).toBe(false);
    // 防呆：實作端清單必須與測試清單完全一致（雙向捕捉 drift）。
    expect([...IMPL_HOSTED_CI_ENV].sort()).toEqual([...HOSTED_CI_ENV].sort());
  });

  it("BUILD_REPLAY_FIXTURE 一旦被設定，僅精確 '1' 啟用；託管環境連 opt-in 也拒絕", () => {
    // 已設定但只有 "1" 才放行——"0"、空字串、"true"、"yes" 一律停用。
    for (const value of ["0", "", "true", "yes", "2"]) {
      expect(canUseBuildReplayFixture({ CI: "true", BUILD_REPLAY_FIXTURE: value })).toBe(false);
      expect(canUseBuildReplayFixture({ BUILD_REPLAY_FIXTURE: value })).toBe(false);
    }
    // 本機明確啟用（無 CI 也可以）；託管標記存在時 opt-in 無效。
    expect(canUseBuildReplayFixture({ BUILD_REPLAY_FIXTURE: "1" })).toBe(true);
    expect(
      canUseBuildReplayFixture({ CI: "true", BUILD_REPLAY_FIXTURE: "1", GITHUB_ACTIONS: "true" }),
    ).toBe(false);
  });

  it("fixture 提供兩 scope 的最小可建置事件，欄位足以通過關聯建置", () => {
    for (const scope of ["domestic", "international"] as const) {
      const events = BUILD_REPLAY_FIXTURE[scope];
      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        expect(e.id).toBeTruthy();
        expect(e.scope).toBe(scope);
        expect(e.source?.type).toBe("news-rss");
        expect(e.source?.recordRef).toBeTruthy();
      }
    }
  });

  it("writeBuildReplayFixture：本機 CI + 目錄缺失時寫入兩份快照；已存在則不覆蓋", () => {
    const dir = mkdtempSync(join(tmpdir(), "build-replay-"));
    try {
      const dataDir = join(dir, "public", "data");
      expect(writeBuildReplayFixture({ CI: "true" }, dataDir)).toBe(true);
      for (const name of ["domestic.json", "international.json"]) {
        const p = join(dataDir, name);
        expect(existsSync(p)).toBe(true);
        const events = JSON.parse(readFileSync(p, "utf8"));
        expect(Array.isArray(events)).toBe(true);
        expect(events.length).toBeGreaterThan(0);
      }
      // 已存在資料目錄 → 不重寫、不覆蓋既有快照。
      writeFileSync(join(dataDir, "domestic.json"), "[]");
      expect(writeBuildReplayFixture({ CI: "true" }, dataDir)).toBe(false);
      expect(readFileSync(join(dataDir, "domestic.json"), "utf8")).toBe("[]");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("非本機 CI / 託管環境一律 fail closed，不寫入任何檔案", () => {
    const dir = mkdtempSync(join(tmpdir(), "build-replay-deny-"));
    try {
      const dataDir = join(dir, "data");
      expect(writeBuildReplayFixture({}, dataDir)).toBe(false);
      for (const name of HOSTED_CI_ENV) {
        expect(writeBuildReplayFixture({ CI: "true", [name]: "true" }, dataDir)).toBe(false);
        // 託管標記即使是空字串（曾被設定）也不得放行。
        expect(writeBuildReplayFixture({ CI: "true", [name]: "" }, dataDir)).toBe(false);
      }
      // 明確停用時即使本機 CI 也不寫入。
      expect(writeBuildReplayFixture({ CI: "true", BUILD_REPLAY_FIXTURE: "0" }, dataDir)).toBe(false);
      expect(existsSync(dataDir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fixture 經 buildNetwork + 產物契約驗證無誤（契約漂移時測試即紅，不會靜默破壞 replay）", () => {
    const net = buildNetwork(
      BUILD_REPLAY_FIXTURE.domestic,
      BUILD_REPLAY_FIXTURE.international,
      "2026-01-01T00:00:00.000Z",
      { snapshotId: "build-replay-test" },
    );
    expect(validateNetworkContract(net)).toEqual([]);
  });
});
