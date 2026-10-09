import { describe, expect, it } from "vitest";
// @ts-expect-error — JS ESM module without types
import { BUILD_REPLAY_FIXTURE, canUseBuildReplayFixture } from "../scripts/build-network.mjs";

// 監管 clean replay 以 detached worktree 執行 `npm run build`，其中沒有 pipeline-state
// 的 public/data 快照。本機 replay 允許最小 fixture 讓建置保持 hermetic；
// 真正的 GitHub Actions CI 仍禁止用假資料掩蓋 pipeline 產物缺失（fail-closed）。
describe("build replay fixture（hermetic clean replay）", () => {
  it("僅在本機 CI 環境（CI=true 且非 GitHub Actions）允許 fixture", () => {
    expect(canUseBuildReplayFixture({ CI: "true" })).toBe(true);
    expect(canUseBuildReplayFixture({ CI: "true", GITHUB_ACTIONS: "true" })).toBe(false);
    // 本專案部署於 Cloudflare Pages：CF_PAGES 建置同樣不得用假資料充當正式產物。
    expect(canUseBuildReplayFixture({ CI: "true", CF_PAGES: "1" })).toBe(false);
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
});
