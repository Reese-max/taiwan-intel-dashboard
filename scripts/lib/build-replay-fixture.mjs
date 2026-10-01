// 監管 clean replay（detached worktree）有程式碼與依賴，卻沒有 pipeline-state 的
// public/data 快照，因此 `npm run build` 會在讀任何產品程式碼之前就失敗。
// 僅限本機 replay（CI=true 或明確 BUILD_REPLAY_FIXTURE=1，且無任何已知託管 CI 標記）
// 以最小 fixture 保持建置 hermetic；已知託管 CI/CD 一律拒絕，避免假資料掩蓋 pipeline
// 產物缺失（真實 build 仍需 restore-state 成功）。
//
// fail-closed 邊界：
// - 只要 domestic.json / international.json 任一個已存在（真實、部分或上次殘留），
//   就不寫入，絕不產生「真實 + 假資料」混合快照。
// - 以 wx 寫入，不覆蓋任何已存在的檔案；半途失敗（含寫到一半的檔案）回滾。
// - purgeStaleBuildReplayFixture：每次建置先把「內容仍等於 fixture」的殘留檔清掉，
//   讓 fixture 不會被後續的一般本機 build 或 fetch-live carry-over 當成真實狀態。
// - cleanupBuildReplayFixture：build-static 取用 dist/data 後清除 fixture 與其衍生的
//   network.json / manifest.json；真實資料（內容已被 refresh 覆寫者）一律保留。
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_DATA_DIR = join(ROOT, "public", "data");

// 由 fixture 驅動的建置會一併產生的衍生物（build-network / build-static 寫入 public/data）。
const DERIVED_FILES = Object.freeze(["network.json", "manifest.json"]);

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

function readFileOrNull(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function isEventArray(contents) {
  try {
    return Array.isArray(JSON.parse(contents));
  } catch {
    return false;
  }
}

export function canUseBuildReplayFixture(env = process.env) {
  // 已知託管環境一律拒絕（連明確 opt-in 都無效）。
  if (HOSTED_CI_ENV.some((name) => env[name] !== undefined)) return false;
  // BUILD_REPLAY_FIXTURE 一旦被設定，只有精確 "1" 表示啟用；其他值一律停用，
  // 與託管標記一致的 presence 語義（""/"0"/"true" 都不會悄悄落入預設路徑）。
  if (env.BUILD_REPLAY_FIXTURE !== undefined) return env.BUILD_REPLAY_FIXTURE === "1";
  return env.CI === "true";
}

/**
 * 真實／部分／殘留快照已存在時回 true，絕不摻入 fixture。
 * 除了兩個事件檔，dataDir 內任何其他非衍生物（例如部分 restore 留下的 summary.json、
 * *.map.json）也算真實快照：build-static 會把整個目錄複製進 dist/data，摻進假事件等於
 * 製造跨版本混合產物。衍生物（network.json / manifest.json）不算，它們本來就是本流程產物。
 */
export function hasRealSnapshot(dataDir = DEFAULT_DATA_DIR, fixture = BUILD_REPLAY_FIXTURE) {
  if (Object.keys(fixture).some((name) => existsSync(join(dataDir, `${name}.json`)))) return true;
  if (!existsSync(dataDir)) return false;
  return readdirSync(dataDir).some((name) => !DERIVED_FILES.includes(name));
}

/** 清掉「內容仍等於 fixture」的殘留；真實資料（已被 refresh 覆寫）不動。 */
export function purgeStaleBuildReplayFixture(dataDir = DEFAULT_DATA_DIR, fixture = BUILD_REPLAY_FIXTURE) {
  return cleanupBuildReplayFixture(dataDir, fixture, { derived: false }).removed;
}

export function writeBuildReplayFixture(env = process.env, dataDir = DEFAULT_DATA_DIR, fixture = BUILD_REPLAY_FIXTURE) {
  if (!canUseBuildReplayFixture(env) || hasRealSnapshot(dataDir, fixture)) return false;

  mkdirSync(dataDir, { recursive: true });
  const intended = Object.entries(fixture).map(([name, events]) => join(dataDir, `${name}.json`));
  try {
    for (const [index, [name, events]] of Object.entries(fixture).entries()) {
      const file = intended[index];
      // wx：不覆蓋已存在的檔案。若 existsSync 之後有其他程序補上真實快照，
      // 寫入直接失敗（fail-closed），不會以假資料覆蓋真實產物。
      writeFileSync(file, serialize(events), { flag: "wx" });
    }
  } catch (error) {
    // 回滾：移除本次寫入的完整 fixture 檔，以及寫到一半被截斷的檔案；
    // 其他程序補上的真實快照（內容既非 fixture、又是合法事件陣列）一律保留。
    for (const [index, file] of intended.entries()) {
      const contents = readFileOrNull(file);
      if (contents === null) continue;
      const isFixture = contents === serialize(Object.values(fixture)[index]);
      if (isFixture || !isEventArray(contents)) rmSync(file, { force: true });
    }
    throw error;
  }
  return true;
}

/**
 * build-static 取用完 fixture 後清除。預設連同衍生的 network.json / manifest.json 一起移除
 * ——兩者同樣是 fixture 驅動的產物，留著會讓後續稽核/建置把它當真實狀態。
 */
export function cleanupBuildReplayFixture(
  dataDir = DEFAULT_DATA_DIR,
  fixture = BUILD_REPLAY_FIXTURE,
  { derived = true } = {},
) {
  const entries = Object.entries(fixture);
  const matched = entries.filter(([name, events]) => readFileOrNull(join(dataDir, `${name}.json`)) === serialize(events));
  const removed = matched.map(([name]) => join(dataDir, `${name}.json`));
  for (const file of removed) rmSync(file, { force: true });

  // 只有「整組都是 fixture」的那次建置，其衍生的 network.json / manifest.json 才可一併清除；
  // 若任一 scope 已是真實資料，保守地保留衍生物（可能來自真實 refresh）。
  const fixtureDriven = matched.length === entries.length;
  if (derived && fixtureDriven) {
    for (const name of DERIVED_FILES) {
      const file = join(dataDir, name);
      if (!existsSync(file)) continue;
      rmSync(file, { force: true });
      removed.push(file);
    }
  }
  return { removed, fixtureDriven };
}
