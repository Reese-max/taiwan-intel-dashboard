// 乾淨 checkout（沒有 public/data 事件快照）時，為 build 準備一份隔離的合成輸入（#47）。
//
// 為什麼合成輸入要放在 tmpdir：合成事件若寫進 public/data，就會留在工作樹，成為後續
// `npm run refresh` 的「舊快照」，而 fetch-live 的新聞路徑會把 oldNews 合併回正式
// domestic.json —— 等於讓測試事件進入資料層。放在暫存目錄可讓 build 結束後完全不留痕。
//
// 正式資料優先：兩份事件快照都存在 → 直接沿用 public/data，build 行為與過去完全相同。
// 只缺其中一份、或目錄內有其他狀態檔卻沒有事件快照 → fail closed，寧可 build 失敗，
// 也不拿合成資料覆蓋或補齊真實狀態（管線／部署缺資料時必須立刻看見）。
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const REQUIRED_SNAPSHOTS = ["domestic.json", "international.json"];
export const DEFAULT_FIXTURE = join(ROOT, "tests", "fixtures", "govintel-domestic.json");

export function prepareCleanCheckoutBuild({
  dataDir = join(ROOT, "public", "data"),
  fixturePath = DEFAULT_FIXTURE,
  stagingPrefix = "taiwan-intel-build-",
} = {}) {
  const present = REQUIRED_SNAPSHOTS.filter((name) => existsSync(join(dataDir, name)));
  if (present.length === REQUIRED_SNAPSHOTS.length) return { seeded: false, dataDir };
  if (present.length > 0) {
    throw new Error(
      `build data incomplete: ${REQUIRED_SNAPSHOTS.join(" 與 ")} 必須成對存在（目前只有 ${present.join(", ")}）`,
    );
  }
  if (existsSync(dataDir) && readdirSync(dataDir).length > 0) {
    throw new Error("build data incomplete: data directory contains files but both event snapshots are absent");
  }
  if (!existsSync(fixturePath)) {
    throw new Error(`build data incomplete: committed synthetic fixture missing (${fixturePath})`);
  }

  const staging = mkdtempSync(join(tmpdir(), stagingPrefix));
  try {
    copyFileSync(fixturePath, join(staging, REQUIRED_SNAPSHOTS[0]));
    writeFileSync(join(staging, REQUIRED_SNAPSHOTS[1]), "[]\n", "utf8");
  } catch (error) {
    // 寫入失敗（fixture 不可讀／磁碟滿）不得留下半套暫存輸入
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return {
    seeded: true,
    dataDir: staging,
    cleanup: () => rmSync(staging, { recursive: true, force: true }),
  };
}
