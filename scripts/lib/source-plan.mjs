export const DEFAULT_SOURCE_KEYS = Object.freeze([
  "cwa",
  "police",
  "missing",
  "twnews",
  "rss",
  "gdelt",
  "mofa",
  "ncdr",
  "mnd",
  "cdc",
  "tfda",
  "cga",
  "twcert",
  "taipower",
  "wra",
  "wraRiver",
]);

function parseSourceKeys(value) {
  return [...new Set(String(value).split(",").map((key) => key.trim()).filter(Boolean))];
}

export function createSourcePlan({ argv = process.argv, env = process.env } = {}) {
  const cliSources = argv.find((arg) => arg.startsWith("--sources="))?.slice("--sources=".length);
  const sourceKeys = parseSourceKeys(cliSources || env.SOURCES || DEFAULT_SOURCE_KEYS.join(","));
  const selected = new Set(sourceKeys);
  const exclusive = argv.includes("--exclusive") || env.EXCLUSIVE === "1";

  return {
    sourceKeys,
    exclusive,
    wants: (key) => selected.has(key),
    dropStale: (status) => exclusive && status?.skipped === true,
  };
}
