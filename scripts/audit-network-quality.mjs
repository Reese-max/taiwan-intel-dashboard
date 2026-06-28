import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MAX_LARGEST_CLUSTER,
  formatNetworkQualityWarning,
  networkQualityWarnings,
} from "./lib/network-quality.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const networkPath = join(ROOT, "public", "data", "network.json");
const maxLargestCluster = Number(process.env.NETWORK_MAX_LARGEST_CLUSTER) || DEFAULT_MAX_LARGEST_CLUSTER;
const strict = process.argv.includes("--strict") || process.env.NETWORK_QUALITY_STRICT === "1";

function readNetwork() {
  if (!existsSync(networkPath)) {
    throw new Error("找不到 public/data/network.json，請先執行 npm run build:network 或 npm run build:static。");
  }
  return JSON.parse(readFileSync(networkPath, "utf8"));
}

try {
  const network = readNetwork();
  const warnings = networkQualityWarnings(network, { maxLargestCluster });
  if (!warnings.length) {
    console.log(`情報網品質 audit passed：最大 cluster 未超過 ${maxLargestCluster}`);
  } else {
    for (const warning of warnings) {
      console.warn(`::warning title=情報網品質::${formatNetworkQualityWarning(warning)}`);
    }
    console.log(`情報網品質 audit warnings：${warnings.length} 個 scope 超過最大 cluster 門檻`);
    if (strict) process.exitCode = 1;
  }
} catch (error) {
  console.error(`情報網品質 audit 失敗：${error.message}`);
  process.exitCode = 1;
}
