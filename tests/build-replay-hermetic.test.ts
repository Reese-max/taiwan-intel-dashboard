import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import {
  BUILD_REPLAY_FIXTURE,
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
      }
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
