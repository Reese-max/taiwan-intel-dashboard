// build 協調器（#47）：準備 build 輸入 → build-network → build-static → 清掉合成暫存。
//
// 有正式資料時 prepare 直接回 public/data，本檔只是依序執行既有兩支腳本，行為與過去相同。
// 乾淨 checkout 時改用 tmpdir 的合成輸入，repo 的 public/data 全程不被寫入。
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareCleanCheckoutBuild } from "./prepare-build-data.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_STEPS = ["build-network.mjs", "build-static.mjs"];

export function buildSite({ root = ROOT, prepareOptions, spawn = spawnSync, log = console.log } = {}) {
  const prepared = prepareCleanCheckoutBuild(prepareOptions);
  // BUILD_SYNTHETIC_INPUT：明確標記輸入為合成資料，讓 build-network 不得把合成產物
  // 鏡射進可部署的 dist/data（dist/ 與 public/data 都只能出現本輪輸入的內容）。
  const env = prepared.seeded
    ? { ...process.env, BUILD_DATA_DIR: prepared.dataDir, BUILD_SYNTHETIC_INPUT: "1" }
    : process.env;
  if (prepared.seeded) {
    log(
      `public/data 沒有事件快照 → 改用暫存合成輸入建置（${prepared.dataDir}，結束後自動刪除；public/data 不會被寫入）`,
    );
  }
  try {
    for (const step of BUILD_STEPS) {
      const result = spawn(process.execPath, [join(root, "scripts", step)], { stdio: "inherit", env });
      if (result.error) throw result.error;
      // 前段失敗就不再跑下一段，失敗碼原樣回傳（npm script 才能紅）
      if (result.status !== 0) return result.status ?? 1;
    }
    return 0;
  } finally {
    prepared.cleanup?.();
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
