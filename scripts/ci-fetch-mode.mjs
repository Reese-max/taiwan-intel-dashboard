import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const HOURLY_ARGS = "--sources=cwa,police,missing,twnews,rss";
export const REFRESH_ARGS = "--sources=cwa,pcc,police,missing,twnews,rss,judicial --exclusive";
export const CWA_ARGS = "--sources=cwa";
export const INTERNATIONAL_ARGS = "--sources=rss";
export const CWA_INTERNATIONAL_ARGS = "--sources=cwa,rss";
export const TWNEWS_ARGS = "--sources=twnews,missing";
export const CWA_ASSERT_ARGS = "--require=cwa,cwaWarnings";
export const INTERNATIONAL_ASSERT_ARGS = "--require=international --min-international-feeds=10 --min-international-raw=50";
export const CWA_INTERNATIONAL_ASSERT_ARGS =
  "--require=cwa,cwaWarnings,international --min-international-feeds=10 --min-international-raw=50";
export const TWNEWS_ASSERT_ARGS = "--require=twnews";
export const FETCH_MODE_CHOICES = [
  "hourly",
  "cwa",
  "international",
  "cwa-international",
  "twnews",
  "daily",
  "refresh",
  "police",
];

const DAILY_REFRESH_CRON = "30 18 * * *";

function argValue(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

export function resolveFetchMode({ schedule = "", mode = "" } = {}) {
  const normalizedMode = String(mode || "").trim().toLowerCase();
  const normalizedSchedule = String(schedule || "").trim();

  if (normalizedMode === "cwa") {
    return {
      label: "cwa",
      args: CWA_ARGS,
      assertArgs: CWA_ASSERT_ARGS,
      message: "選用 cwa（僅更新地震與天氣警特報）",
    };
  }

  if (normalizedMode === "international" || normalizedMode === "rss") {
    return {
      label: "international",
      args: INTERNATIONAL_ARGS,
      assertArgs: INTERNATIONAL_ASSERT_ARGS,
      message: "選用 international（僅更新國際 RSS）",
    };
  }

  if (normalizedMode === "cwa-international" || normalizedMode === "cwa-rss") {
    return {
      label: "cwa-international",
      args: CWA_INTERNATIONAL_ARGS,
      assertArgs: CWA_INTERNATIONAL_ASSERT_ARGS,
      message: "選用 cwa-international（僅更新 CWA 與國際 RSS）",
    };
  }

  if (normalizedMode === "twnews" || normalizedMode === "news") {
    return {
      label: "twnews",
      args: TWNEWS_ARGS,
      assertArgs: TWNEWS_ASSERT_ARGS,
      message: "選用 twnews（僅更新台灣新聞與失蹤人口）",
    };
  }

  if (normalizedSchedule === DAILY_REFRESH_CRON || normalizedMode === "refresh" || normalizedMode === "daily") {
    return {
      label: "refresh",
      args: REFRESH_ARGS,
      assertArgs: CWA_INTERNATIONAL_ASSERT_ARGS,
      message: "選用 refresh（完整，含 CWA、國際 RSS、新聞、LLM、警政、失蹤人口、司法）",
    };
  }

  return {
    label: "hourly",
    args: HOURLY_ARGS,
    assertArgs: CWA_INTERNATIONAL_ASSERT_ARGS,
    message: "選用 hourly（每小時，含 CWA、國際 RSS、警政、台灣新聞、失蹤人口；非 exclusive 保留其他資料）",
  };
}

export function writeGithubOutput(result, outputPath) {
  if (!outputPath) return;
  appendFileSync(outputPath, `label=${result.label}\nargs=${result.args}\nassert_args=${result.assertArgs}\n`, "utf8");
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
