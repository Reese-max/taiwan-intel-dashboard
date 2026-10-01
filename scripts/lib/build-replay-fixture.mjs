// 監管 clean replay（detached worktree）有程式碼與依賴，卻沒有 pipeline-state 的
// public/data 快照，因此 `npm run build` 會在讀任何產品程式碼之前就失敗。
// 僅限本機 replay（CI=true 或明確 BUILD_REPLAY_FIXTURE=1，且無任何已知託管 CI 標記）
// 以最小 fixture 保持建置 hermetic；已知託管 CI/CD 一律拒絕，避免假資料掩蓋 pipeline
// 產物缺失（真實 build 仍需 restore-state 成功）。
//
// fail-closed 邊界：
// - 只要 domestic.json / international.json 任一個已存在（真實或部分快照），就不寫入，
//   絕不產生「真實 + 假資料」混合快照。
// - 以 wx 寫入，不覆蓋任何已存在的檔案；半途失敗回滾已寫入的 fixture。
// - build-static 產出 dist/data 後清除 fixture 檔，且只在內容仍等於 fixture 時刪除，
//   避免 fixture 殘留讓之後的一般本機 build 或 fetch-live carry-over 誤用。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_DATA_DIR = join(ROOT, "public", "data");

// 已知託管 CI/CD 標記。以「是否存在」判斷（不看值，空字串也拒絕），
// 避免把建置 fixture 寫進正式產物。
export const HOSTED_CI_ENV = Object.freeze([
  "GITHUB_ACTIONS",
  "CF_PAGES",
  "CF_PAGES_BRANCH",
  "CF_BUILD_ID",
  "WORKERS_CI",
  "GITLAB_CI",
  "CIRCLECI",
  "TRAVIS",
  "APPVEYOR",
  "DRONE",
  "JENKINS_URL",
  "JENKINS_HOME",
  "HUDSON_URL",
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
  "HARNESS_BUILD_ID",
  "RENDER",
  "TF_BUILD",
  "BUILDKITE",
  "VERCEL",
  "NETLIFY",
]);

export const BUILD_REPLAY_FIXTURE = Object.freeze({
  domestic: [
    {
      id: "build-replay-domestic",
      title: "本機建置驗證事件",
      summary: "僅供 clean replay 建置驗證，不代表正式資料。",
      region: "臺北市",
      timestamp: "2026-01-01T00:00:00.000Z",
      category: "測試",
      scope: "domestic",
      riskLevel: "low",
      source: {
        name: "build-replay-fixture",
        type: "news-rss",
        recordRef: "https://example.invalid/build-replay-domestic",
      },
    },
  ],
  international: [
    {
      id: "build-replay-international",
      title: "Build replay fixture event",
      summary: "Only for clean replay build verification; not production data.",
      region: "全球",
      timestamp: "2026-01-01T00:00:00.000Z",
      category: "測試",
      scope: "international",
      riskLevel: "low",
      source: {
        name: "build-replay-fixture",
        type: "news-rss",
        recordRef: "https://example.invalid/build-replay-international",
      },
    },
  ],
});

function serialize(events) {
  return JSON.stringify(events) + "\n";
}

export function canUseBuildReplayFixture(env = process.env) {
  // 已知託管環境一律拒絕（連明確 opt-in 都無效）。
  if (HOSTED_CI_ENV.some((name) => env[name] !== undefined)) return false;
  // BUILD_REPLAY_FIXTURE 一旦被設定，只有精確 "1" 表示啟用；其他值一律停用，
  // 與託管標記一致的 presence 語義（""/"0"/"true" 都不會悄悄落入預設路徑）。
  if (env.BUILD_REPLAY_FIXTURE !== undefined) return env.BUILD_REPLAY_FIXTURE === "1";
  return env.CI === "true";
}

/** 真實／部分快照已存在時回 false，絕不摻入 fixture。 */
export function hasRealSnapshot(dataDir = DEFAULT_DATA_DIR, fixture = BUILD_REPLAY_FIXTURE) {
  return Object.keys(fixture).some((name) => existsSync(join(dataDir, `${name}.json`)));
}

export function writeBuildReplayFixture(env = process.env, dataDir = DEFAULT_DATA_DIR, fixture = BUILD_REPLAY_FIXTURE) {
  if (!canUseBuildReplayFixture(env) || hasRealSnapshot(dataDir, fixture)) return false;

  mkdirSync(dataDir, { recursive: true });
  const written = [];
  try {
    for (const [name, events] of Object.entries(fixture)) {
      const file = join(dataDir, `${name}.json`);
      // wx：不覆寫已存在的檔案。若 existsSync 之後有其他程序補上真實快照，
      // 寫入直接失敗（fail-closed），不會以假資料覆蓋真實產物。
      writeFileSync(file, serialize(events), { flag: "wx" });
      written.push(file);
    }
  } catch (error) {
    // 半途失敗時移除已寫入的 fixture，不留「一半假資料」讓下一次 build 誤用。
    for (const file of written) rmSync(file, { force: true });
    throw error;
  }
  return true;
}

/** build-static 取用完 fixture 後清除；內容已被真實 refresh 覆寫者一律保留。 */
export function cleanupBuildReplayFixture(dataDir = DEFAULT_DATA_DIR, fixture = BUILD_REPLAY_FIXTURE) {
  const removed = [];
  for (const [name, events] of Object.entries(fixture)) {
    const file = join(dataDir, `${name}.json`);
    let current;
    try {
      current = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (current !== serialize(events)) continue;
    rmSync(file, { force: true });
    removed.push(file);
  }
  return removed;
}
