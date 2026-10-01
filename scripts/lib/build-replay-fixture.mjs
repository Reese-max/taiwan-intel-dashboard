// 監管 clean replay（detached worktree）有程式碼與依賴，但沒有 pipeline-state
// 的 public/data 快照。僅限本機 replay（CI===true 或明確 BUILD_REPLAY_FIXTURE=1，
// 且無任何已知託管 CI 標記）以最小 fixture 保持建置 hermetic；
// 已知託管 CI/CD 一律拒絕，避免假資料掩蓋 pipeline 產物缺失
// （真實 build 仍需 restore-state 成功）。不在清單內的 CI 可用
// BUILD_REPLAY_FIXTURE=0 強制停用。
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

export function writeBuildReplayFixture(env = process.env, dataDir = DEFAULT_DATA_DIR) {
  if (!canUseBuildReplayFixture(env) || existsSync(dataDir)) return false;
  mkdirSync(dataDir, { recursive: true });
  const written = [];
  try {
    for (const [name, events] of Object.entries(BUILD_REPLAY_FIXTURE)) {
      const file = join(dataDir, `${name}.json`);
      // wx：不覆寫已存在的檔案——若 existsSync 之後有其他程序補上真實快照，
      // 寫入直接失敗（fail-closed），不會以假資料覆蓋真實產物。
      writeFileSync(file, JSON.stringify(events) + "\n", { flag: "wx" });
      written.push(file);
    }
  } catch (err) {
    // 半途失敗時移除已寫入的 fixture，不留「一半假資料」讓下一次 build 誤用。
    for (const file of written) rmSync(file, { force: true });
    throw err;
  }
  return true;
}
