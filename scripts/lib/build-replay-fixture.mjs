// 監管 clean replay（detached worktree）有程式碼與依賴，但沒有 pipeline-state
// 的 public/data 快照。僅限本機 replay（CI===true 或明確 BUILD_REPLAY_FIXTURE=1，
// 且無任何已知託管 CI 標記）以最小 fixture 保持建置 hermetic；
// 已知託管 CI/CD 一律拒絕，避免假資料掩蓋 pipeline 產物缺失
// （真實 build 仍需 restore-state 成功）。不在清單內的 CI 可用
// BUILD_REPLAY_FIXTURE=0 強制停用。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_DATA_DIR = join(ROOT, "public", "data");

// 已知託管 CI/CD 標記。以「是否存在」判斷（不看值，空字串也拒絕），
// 避免把建置 fixture 寫進正式產物。
export const HOSTED_CI_ENV = [
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

export function canUseBuildReplayFixture(env = process.env) {
  // 已知託管環境一律拒絕（連 opt-in 也無效）。
  if (HOSTED_CI_ENV.some((name) => env[name] !== undefined)) return false;
  // BUILD_REPLAY_FIXTURE 一旦被設定，只有精確 "1" 表示啟用；其他值一律停用
  // （與託管標記一致的 presence 語義，"0"/""/"true" 皆不會悄悄落入預設路徑）。
  if (env.BUILD_REPLAY_FIXTURE !== undefined) return env.BUILD_REPLAY_FIXTURE === "1";
  return env.CI === "true";
}

export const BUILD_REPLAY_FIXTURE = {
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
};

export function assertBuildReplayFixtureAllowed(env = process.env, dataDir = DEFAULT_DATA_DIR) {
  if (canUseBuildReplayFixture(env)) return;
  for (const scope of Object.keys(BUILD_REPLAY_FIXTURE)) {
    const file = join(dataDir, `${scope}.json`);
    if (!existsSync(file)) continue;
    const events = JSON.parse(readFileSync(file, "utf8"));
    if (Array.isArray(events) && events.some((event) => event?.source?.name === "build-replay-fixture")) {
      throw new Error("build replay fixture is not allowed in this environment");
    }
  }
}

export function writeBuildReplayFixture(env = process.env, dataDir = DEFAULT_DATA_DIR) {
  assertBuildReplayFixtureAllowed(env, dataDir);
  if (!canUseBuildReplayFixture(env) || existsSync(dataDir)) return false;
  mkdirSync(dirname(dataDir), { recursive: true });
  const stagingDir = mkdtempSync(join(dirname(dataDir), ".build-replay-"));
  try {
    for (const [name, events] of Object.entries(BUILD_REPLAY_FIXTURE)) {
      const file = join(stagingDir, `${name}.json`);
      writeFileSync(file, JSON.stringify(events) + "\n", { flag: "wx" });
    }
    // 整組發布；並行還原若已寫入資料，rename 失敗且不動其內容。
    renameSync(stagingDir, dataDir);
  } finally {
    // 只清理本次擁有的暫存目錄，不依正式路徑刪除其他程序的快照。
    rmSync(stagingDir, { recursive: true, force: true });
  }
  return true;
}
