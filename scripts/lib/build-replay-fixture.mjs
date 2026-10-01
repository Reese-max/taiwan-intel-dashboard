// 監管 clean replay（detached worktree）有程式碼與依賴，但沒有 pipeline-state
// 的 public/data 快照。僅限本機 replay（CI=true 且非託管建置）以最小 fixture
// 保持建置 hermetic；不允許任何託管 CI/CD 用假資料掩蓋 pipeline 產物缺失
// （真實 build 仍需 restore-state 成功）。
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_DATA_DIR = join(ROOT, "public", "data");

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

export function canUseBuildReplayFixture(env = process.env) {
  if (env.CI !== "true") return false;
  return !HOSTED_CI_ENV.some((name) => env[name]);
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
  for (const [name, events] of Object.entries(BUILD_REPLAY_FIXTURE)) {
    writeFileSync(join(dataDir, `${name}.json`), JSON.stringify(events) + "\n");
  }
  return true;
}
