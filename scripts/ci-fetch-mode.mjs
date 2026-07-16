import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// mofa/ncdr：2026-07-07 接線缺口修復——fetch-live 預設含此二源，但 CI 走顯式清單，
// 漏列導致 MOFA 旅遊警示與 NCDR 示警在排程 run 永遠 skipped（實際從未上線）。
export const HOURLY_ARGS = "--sources=cwa,police,missing,twnews,rss,mofa,ncdr,mnd,cga,twcert,taipower,wra,wraRiver";
export const REFRESH_ARGS = "--sources=cwa,pcc,police,missing,twnews,rss,judicial,mofa,ncdr,mnd,cdc,tfda,cga,twcert,taipower,wra,wraRiver --exclusive";
export const CWA_ARGS = "--sources=cwa";
export const INTERNATIONAL_ARGS = "--sources=rss";
export const CWA_INTERNATIONAL_ARGS = "--sources=cwa,rss";
export const TWNEWS_ARGS = "--sources=twnews,missing";
export const CWA_ASSERT_ARGS = "--require=cwa,cwaWarnings";
export const INTERNATIONAL_ASSERT_ARGS = "--require=international --min-international-feeds=10 --min-international-raw=50";
export const INTERNATIONAL_CORE_ASSERT_ARGS = "--require=international --min-international-feeds=3 --min-international-raw=10";
export const CWA_INTERNATIONAL_ASSERT_ARGS =
  "--require=cwa,cwaWarnings,international --min-international-feeds=10 --min-international-raw=50";
export const TWNEWS_ASSERT_ARGS = "--require=twnews";
// 本輪硬閘門只擋核心與 MCP；可 carry-over 的官方來源由 audit-source-freshness 依各自 maxAgeHours 閘控。
export const HOURLY_ASSERT_ARGS = "--require=cwa,cwaWarnings,international,police --min-international-feeds=10 --min-international-raw=50";
export const REFRESH_ASSERT_ARGS = "--require=cwa,cwaWarnings,international,pcc,police,judicial --min-international-feeds=10 --min-international-raw=50";
export const FETCH_MODE_CHOICES = [
  "hourly",
  "cwa",
  "international",
  "international-expanded",
  "international-core",
  "international-general",
  "international-cyber",
  "international-disaster",
  "international-health",
  "international-humanitarian",
  "international-finance",
  "cwa-international",
  "twnews",
  "daily",
  "refresh",
  "police",
];

const DAILY_REFRESH_CRON = "30 18 * * *";
const TOPIC_ASSERT_MINIMUMS = {
  general: { minFeeds: 4, minRawItems: 10 },
  cyber: { minFeeds: 4, minRawItems: 10 },
  disaster: { minFeeds: 2, minRawItems: 5 },
  health: { minFeeds: 2, minRawItems: 5 },
  humanitarian: { minFeeds: 2, minRawItems: 5 },
  finance: { minFeeds: 1, minRawItems: 3 },
};

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
      internationalFeedTier: "",
      internationalFeedTopic: "",
      message: "選用 cwa（僅更新地震與天氣警特報）",
    };
  }

  if (normalizedMode === "international" || normalizedMode === "rss" || normalizedMode === "international-expanded") {
    return internationalMode({
      label: "international",
      tier: "expanded",
      topic: "all",
      assertArgs: INTERNATIONAL_ASSERT_ARGS,
      message: "選用 international（expanded，全量國際 RSS）",
    });
  }

  if (normalizedMode === "international-core") {
    return internationalMode({
      label: "international-core",
      tier: "core",
      topic: "all",
      assertArgs: INTERNATIONAL_CORE_ASSERT_ARGS,
      message: "選用 international-core（核心 5 條國際 RSS）",
    });
  }

  const topicMode = normalizedMode.match(/^international-(general|cyber|disaster|health|humanitarian|finance)$/)?.[1];
  if (topicMode) {
    const mins = TOPIC_ASSERT_MINIMUMS[topicMode];
    return internationalMode({
      label: `international-${topicMode}`,
      tier: "expanded",
      topic: topicMode,
      assertArgs: internationalAssertArgs(mins),
      message: `選用 international-${topicMode}（expanded，僅 ${topicMode} topic）`,
    });
  }

  if (normalizedMode === "cwa-international" || normalizedMode === "cwa-rss") {
    return {
      label: "cwa-international",
      args: CWA_INTERNATIONAL_ARGS,
      assertArgs: CWA_INTERNATIONAL_ASSERT_ARGS,
      internationalFeedTier: "expanded",
      internationalFeedTopic: "all",
      message: "選用 cwa-international（僅更新 CWA 與國際 RSS）",
    };
  }

  if (normalizedMode === "twnews" || normalizedMode === "news") {
    return {
      label: "twnews",
      args: TWNEWS_ARGS,
      assertArgs: TWNEWS_ASSERT_ARGS,
      internationalFeedTier: "",
      internationalFeedTopic: "",
      message: "選用 twnews（僅更新台灣新聞與失蹤人口）",
    };
  }

  if (normalizedSchedule === DAILY_REFRESH_CRON || normalizedMode === "refresh" || normalizedMode === "daily") {
    return {
      label: "refresh",
      args: REFRESH_ARGS,
      assertArgs: REFRESH_ASSERT_ARGS,
      internationalFeedTier: "expanded",
      internationalFeedTopic: "all",
      message: "選用 refresh（完整，含 CWA、國際 RSS、新聞、LLM、警政、失蹤人口、司法）",
    };
  }

  return {
    label: "hourly",
    args: HOURLY_ARGS,
    assertArgs: HOURLY_ASSERT_ARGS,
    internationalFeedTier: "expanded",
    internationalFeedTopic: "all",
    message: "選用 hourly（每小時，含 CWA、國際 RSS、警政、台灣新聞、失蹤人口；非 exclusive 保留其他資料）",
  };
}

export function writeGithubOutput(result, outputPath) {
  if (!outputPath) return;
  appendFileSync(
    outputPath,
    [
      `label=${result.label}`,
      `args=${result.args}`,
      `assert_args=${result.assertArgs}`,
      `international_feed_tier=${result.internationalFeedTier || ""}`,
      `international_feed_topic=${result.internationalFeedTopic || ""}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function internationalMode({ label, tier, topic, assertArgs, message }) {
  return {
    label,
    args: INTERNATIONAL_ARGS,
    assertArgs,
    internationalFeedTier: tier,
    internationalFeedTopic: topic,
    message,
  };
}

function internationalAssertArgs({ minFeeds, minRawItems }) {
  return `--require=international --min-international-feeds=${minFeeds} --min-international-raw=${minRawItems}`;
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
