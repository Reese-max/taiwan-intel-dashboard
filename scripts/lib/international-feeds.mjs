export const INTERNATIONAL_FEEDS = [
  { label: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", hint: "地緣政治", tier: "core", topic: "general", topics: ["general"] },
  { label: "NPR World", url: "https://feeds.npr.org/1004/rss.xml", hint: "災害", tier: "core", topic: "general", topics: ["general", "disaster", "humanitarian"] },
  { label: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", hint: "地緣政治", tier: "core", topic: "general", topics: ["general"] },
  { label: "The Hacker News", url: "https://feeds.feedburner.com/TheHackersNews", hint: "資安", tier: "core", topic: "cyber", topics: ["cyber"] },
  { label: "CNBC Finance", url: "https://www.cnbc.com/id/10000664/device/rss/rss.html", hint: "金融", tier: "core", topic: "finance", topics: ["finance"] },
  { label: "Guardian World", url: "https://www.theguardian.com/world/rss", hint: "地緣政治", tier: "expanded", topic: "general", topics: ["general"] },
  { label: "DW All News", url: "https://rss.dw.com/rdf/rss-en-all", hint: "地緣政治", tier: "expanded", topic: "general", topics: ["general"] },
  { label: "France24 English", url: "https://www.france24.com/en/rss", hint: "地緣政治", tier: "expanded", topic: "general", topics: ["general"] },
  { label: "UN News All", url: "https://news.un.org/feed/subscribe/en/news/all/rss.xml", hint: "地緣政治", tier: "expanded", topic: "humanitarian", topics: ["humanitarian", "disaster", "health"] },
  { label: "GDACS Alerts", url: "https://www.gdacs.org/xml/rss.xml", hint: "災害", tier: "expanded", topic: "disaster", topics: ["disaster"] },
  { label: "WHO News", url: "https://www.who.int/rss-feeds/news-english.xml", hint: "災害", tier: "expanded", topic: "health", topics: ["health", "disaster"] },
  { label: "Politico EU", url: "https://www.politico.eu/feed/", hint: "地緣政治", tier: "expanded", topic: "general", topics: ["general"] },
  { label: "Le Monde International EN", url: "https://www.lemonde.fr/en/international/rss_full.xml", hint: "地緣政治", tier: "expanded", topic: "general", topics: ["general"] },
  { label: "Le Monde Global Issues EN", url: "https://www.lemonde.fr/en/global-issues/rss_full.xml", hint: "地緣政治", tier: "expanded", topic: "humanitarian", topics: ["humanitarian"] },
  { label: "Le Monde Pixels EN", url: "https://www.lemonde.fr/en/pixels/rss_full.xml", hint: "資安", tier: "expanded", topic: "cyber", topics: ["cyber"] },
  { label: "Le Monde Health EN", url: "https://www.lemonde.fr/en/health/rss_full.xml", hint: "災害", tier: "expanded", topic: "health", topics: ["health"] },
  { label: "CISA Cyber Advisories", url: "https://www.cisa.gov/cybersecurity-advisories/all.xml", hint: "資安", tier: "expanded", topic: "cyber", topics: ["cyber"] },
  { label: "CIS Advisories", url: "https://www.cisecurity.org/feed/advisories", hint: "資安", tier: "expanded", topic: "cyber", topics: ["cyber"] },
  { label: "Cisco Security Advisories", url: "https://sec.cloudapps.cisco.com/security/center/psirtrss10/CiscoSecurityAdvisory.xml", hint: "資安", tier: "expanded", topic: "cyber", topics: ["cyber"] },
  { label: "KrebsOnSecurity", url: "https://krebsonsecurity.com/feed/", hint: "資安", tier: "expanded", topic: "cyber", topics: ["cyber"] },
  { label: "SecurityWeek", url: "https://www.securityweek.com/feed/", hint: "資安", tier: "expanded", topic: "cyber", topics: ["cyber"] },
];

export const INTERNATIONAL_TOPICS = ["general", "cyber", "disaster", "health", "humanitarian", "finance"];

const CORE_LABELS = new Set(["BBC World", "NPR World", "Al Jazeera", "The Hacker News", "CNBC Finance"]);
const TOPIC_SET = new Set(INTERNATIONAL_TOPICS);

function numberEnv(env, name, fallback, min, max) {
  const value = Number(env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function selectInternationalFeeds({ tier = "expanded", topic = "all" } = {}) {
  const normalizedTier = String(tier || "expanded").trim().toLowerCase();
  const normalizedTopic = normalizeTopic(topic);
  const tierFeeds =
    normalizedTier === "core" ? INTERNATIONAL_FEEDS.filter((feed) => CORE_LABELS.has(feed.label)) : [...INTERNATIONAL_FEEDS];
  if (normalizedTopic === "all") return tierFeeds;
  return tierFeeds.filter((feed) => feedMatchesTopic(feed, normalizedTopic));
}

export function getInternationalRuntimeConfig(env = process.env) {
  return {
    tier: String(env.INTERNATIONAL_FEED_TIER || "expanded").trim().toLowerCase() === "core" ? "core" : "expanded",
    topic: normalizeTopic(env.INTERNATIONAL_FEED_TOPIC),
    perFeed: numberEnv(env, "INTERNATIONAL_RSS_PER_FEED", 5, 1, 25),
    concurrency: numberEnv(env, "INTERNATIONAL_RSS_CONCURRENCY", 5, 1, 10),
    maxEvents: numberEnv(env, "INTERNATIONAL_NORMALIZE_MAX", 20, 1, 40),
  };
}

function normalizeTopic(topic) {
  const normalized = String(topic || "all").trim().toLowerCase();
  return TOPIC_SET.has(normalized) ? normalized : "all";
}

function feedMatchesTopic(feed, topic) {
  const topics = new Set([feed.topic, ...(Array.isArray(feed.topics) ? feed.topics : [])]);
  return topics.has(topic);
}
