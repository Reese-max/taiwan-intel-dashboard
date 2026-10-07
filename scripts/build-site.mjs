// build 協調器（#47）：準備 build 輸入 → build-network → build-static → 清掉合成暫存。
//
// 有正式資料時 prepare 直接回 public/data，本檔只是依序執行既有兩支腳本，行為與過去相同。
// 乾淨 checkout 的輸入與產物都在 tmpdir，repo 的 public/data 與 dist 全程不被寫入。
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareCleanCheckoutBuild } from "./prepare-build-data.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_STEPS = ["build-network.mjs", "build-static.mjs"];

export function buildSite({ root = ROOT, prepareOptions, spawn = spawnSync, log = console.log, env = process.env } = {}) {
  const prepared = prepareCleanCheckoutBuild(prepareOptions);
  let buildCwd;
  try {
    // 一定用明確的 env：外部殘留的 BUILD_DATA_DIR／BUILD_SYNTHETIC_INPUT 不得蓋過本輪
    // prepare 的驗證結果（否則會拿未驗證的目錄當輸入，甚至跳過 dist 鏡射）。
    const { BUILD_DATA_DIR: _ambientDir, BUILD_SYNTHETIC_INPUT: _ambientFlag, ...inherited } = env;
    // BUILD_SYNTHETIC_INPUT 讓 build-network 不把合成產物鏡射進 checkout/dist/data。
    const childEnv = prepared.seeded
      ? { ...inherited, BUILD_DATA_DIR: prepared.dataDir, BUILD_SYNTHETIC_INPUT: "1" }
      : inherited;
    if (prepared.seeded) {
      // build-static 會清空 cwd/dist 並複製全部資料；合成 build 的輸出也必須隔離，
      // 避免 fixture 進入可部署的 checkout/dist 或覆蓋開發者先前建置的正式快照。
      buildCwd = mkdtempSync(join(tmpdir(), "taiwan-intel-site-"));
      for (const entry of ["src", "static", "node_modules"]) {
        symlinkSync(resolve(root, entry), join(buildCwd, entry), process.platform === "win32" ? "junction" : "dir");
      }
      log(
        `public/data 沒有事件快照 → 改用暫存合成輸入建置（${prepared.dataDir}，輸入與產物結束後自動刪除；public/data 與 dist 不會被寫入）`,
      );
    }
    for (const step of BUILD_STEPS) {
      const result = spawn(process.execPath, [join(root, "scripts", step)], {
        stdio: "inherit",
        env: childEnv,
        ...(buildCwd ? { cwd: buildCwd } : {}),
      });
      if (result.error) throw result.error;
      // 前段失敗就不再跑下一段，失敗碼原樣回傳（npm script 才能紅）
      if (result.status !== 0) return result.status ?? 1;
    }
    return 0;
  } finally {
    try {
      if (buildCwd) rmSync(buildCwd, { recursive: true, force: true });
    } finally {
      prepared.cleanup?.();
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const exitCode = buildSite();
    if (exitCode !== 0) process.exitCode = exitCode;
  } catch (error) {
    console.error(`build 失敗：${error.message}`);
    process.exitCode = 1;
  }
}
