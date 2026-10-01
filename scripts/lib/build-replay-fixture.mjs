// 僅限本機 clean replay 的建置 fixture：pipeline-state 的 public/data 快照不在 main，
// detached worktree（監管驗證、CI 快取）因此沒有真實資料可讀，`npm run build` 會因
// 缺少 domestic.json 直接失敗，讓「程式碼 + 依賴齊全但沒有資料狀態」的環境無法驗證。
//
// 邊界（fail-closed）：
// - 只在 CI=true 且沒有任何託管建置標記時啟用；GitHub Actions / Cloudflare Pages 等
//   託管建置仍必須靠 restore-state 取得真實快照，不得用假資料掩蓋產物缺失。
// - 只補「缺少」的檔案，絕不覆蓋既有 pipeline-state 資料。
// - 寫檔失敗時清掉自己寫入的檔案，不留下半套假快照。
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// 出現任一標記即視為託管／受控建置環境，一律不使用 fixture。
export const HOSTED_CI_MARKERS = Object.freeze([
  "GITHUB_ACTIONS",
  "CF_PAGES",
  "CF_PAGES_BRANCH",
  "GITLAB_CI",
  "CIRCLECI",
  "TRAVIS",
  "JENKINS_URL",
  "HUDSON_URL",
  "BUILDKITE",
  "TEAMCITY_VERSION",
  "BITBUCKET_BUILD_NUMBER",
  "CODEBUILD_BUILD_ID",
  "TF_BUILD",
  "VERCEL",
  "NETLIFY",
]);

export const BUILD_REPLAY_FIXTURE = Object.freeze({
  domestic: [
    {
      id: "build-replay-domestic",
      title: "本機 replay 建置驗證事件",
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

export function canUseBuildReplayFixture(env = process.env) {
  if (env.CI !== "true") return false;
  return !HOSTED_CI_MARKERS.some((name) => Boolean(env[name]));
}

export function seedBuildReplayFixture({
  dataDir,
  env = process.env,
  fixture = BUILD_REPLAY_FIXTURE,
  writeFile = (file, contents) => writeFileSync(file, contents),
  log = () => {},
} = {}) {
  if (!canUseBuildReplayFixture(env)) return { seeded: false, reason: "fixture-not-allowed", files: [] };

  const names = Object.keys(fixture);
  const missing = names.filter((name) => !existsSync(join(dataDir, `${name}.json`)));
  if (!missing.length) return { seeded: false, reason: "data-present", files: [] };

  const written = [];
  try {
    mkdirSync(dataDir, { recursive: true });
    for (const name of missing) {
      const file = join(dataDir, `${name}.json`);
      writeFile(file, JSON.stringify(fixture[name], null, 2) + "\n");
      written.push(file);
    }
  } catch (error) {
    for (const file of written) rmSync(file, { force: true });
    throw error;
  }

  log(
    `public/data 缺少 ${missing.join("、")}；使用僅限本機 clean replay 的建置 fixture（託管建置不使用此 fallback）`,
  );
  return { seeded: true, reason: "fixture-seeded", files: written };
}
