import { fileURLToPath } from "node:url";
import { fetchRssItems } from "./lib/fetch-rss.mjs";
import { getInternationalRuntimeConfig, selectInternationalFeeds } from "./lib/international-feeds.mjs";

function argValue(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

export function summarizeInternationalFeedAudit(feedStatus, { minOkFeeds = 10, minRawItems = 50 } = {}) {
  const okFeeds = feedStatus.filter((f) => f.ok && Number(f.count || 0) > 0).length;
  const rawItems = feedStatus.reduce((sum, f) => sum + (f.ok ? Number(f.count || 0) : 0), 0);
  const errors = [];
  if (okFeeds < minOkFeeds) errors.push(`live feeds ${okFeeds}/${minOkFeeds}`);
  if (rawItems < minRawItems) errors.push(`raw items ${rawItems}/${minRawItems}`);
  return { ok: errors.length === 0, okFeeds, rawItems, errors };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = getInternationalRuntimeConfig(process.env);
  const feeds = selectInternationalFeeds({ tier: cfg.tier });
  const minOkFeeds = Number(argValue("min-ok-feeds") || process.env.INTERNATIONAL_MIN_OK_FEEDS || 10);
  const minRawItems = Number(argValue("min-raw-items") || process.env.INTERNATIONAL_MIN_RAW_ITEMS || 50);
  const result = await fetchRssItems({ perFeed: cfg.perFeed, feeds, concurrency: cfg.concurrency });

  for (const status of result.feedStatus) {
    console.log(`${status.ok ? "OK" : "FAIL"}\t${status.count || 0}\t${status.label}${status.error ? `\t${status.error}` : ""}`);
  }

  const summary = summarizeInternationalFeedAudit(result.feedStatus, { minOkFeeds, minRawItems });
  console.log(`International feed audit: ${summary.okFeeds}/${feeds.length} live feeds, ${summary.rawItems} raw items`);
  if (!summary.ok) {
    console.error(`International feed audit failed: ${summary.errors.join(", ")}`);
    process.exit(1);
  }
}
