import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const HOURLY_ARGS = "--sources=cwa,police,missing,twnews,rss";
export const REFRESH_ARGS = "--sources=cwa,pcc,police,missing,twnews,rss,judicial --exclusive";
const DAILY_REFRESH_CRON = "30 18 * * *";

function argValue(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

export function resolveFetchMode({ schedule = "", mode = "" } = {}) {
  const normalizedMode = String(mode || "").trim().toLowerCase();
  const normalizedSchedule = String(schedule || "").trim();
  const isRefreshMode = normalizedMode === "refresh" || normalizedMode === "daily";

  if (normalizedSchedule === DAILY_REFRESH_CRON || isRefreshMode) {
    return {
      label: "refresh",
      args: REFRESH_ARGS,
      message: "選用 refresh（完整，含 CWA、國際 RSS、新聞、LLM、警政、失蹤人口、司法）",
    };
  }

  return {
    label: "hourly",
    args: HOURLY_ARGS,
    message: "選用 hourly（每小時，含 CWA、國際 RSS、警政、台灣新聞、失蹤人口；非 exclusive 保留其他資料）",
  };
}

export function writeGithubOutput(result, outputPath) {
  if (!outputPath) return;
  appendFileSync(outputPath, `label=${result.label}\nargs=${result.args}\n`, "utf8");
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = resolveFetchMode({
    schedule: argValue("schedule"),
    mode: argValue("mode"),
  });

  writeGithubOutput(result, argValue("github-output") || process.env.GITHUB_OUTPUT);

  console.log(result.message);
  console.log(`args=${result.args}`);
}
