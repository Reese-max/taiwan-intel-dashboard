import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CWA_SOURCES = new Set(["cwa", "cwaWarnings"]);

function argValue(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

function parseAllowStaleCwaValue(value) {
  return ["1", "true", "yes", "on", "y", "允許"].includes(String(value ?? "").trim().toLowerCase());
}

export function assertRequiredPipelineSources(pipeline, requiredSources, options = {}) {
  const allowStaleCwa = options.allowStaleCwa === true;

  for (const name of requiredSources) {
    const status = pipeline?.[name];
    if (!status) throw new Error(`Required pipeline source ${name} is missing`);
    if (status.skipped) throw new Error(`Required pipeline source ${name} was skipped`);

    if (allowStaleCwa && CWA_SOURCES.has(name)) {
      continue;
    }

    if (status.ok !== true) {
      const suffix = status.error ? `: ${status.error}` : "";
      throw new Error(`Required pipeline source ${name} failed${suffix}`);
    }
  }
}

export function assertInternationalFeedCoverage(status, { minFeeds = 0, minRawItems = 0 } = {}) {
  if (!status || status.ok !== true) return;
  if (minFeeds > 0) {
    const okFeeds = Number(status.okFeeds || 0);
    if (okFeeds < minFeeds) throw new Error(`International feed coverage too low: ${okFeeds}/${minFeeds} live feeds`);
  }
  if (minRawItems > 0) {
    const rawCount = Number(status.rawCount || 0);
    if (rawCount < minRawItems) throw new Error(`International raw item count too low: ${rawCount}/${minRawItems}`);
  }
}

// LLM 正規化全批失敗＝管線級故障但服務仍回舊快取（stale-but-valid），既有 gate 只看 ok/rawCount
// 讀不到它。此處以觀測模式（console.warn，不擋部署）把該旗標讀出來，讓故障在 CI log 被看見。
export function warnOnNormalizeFailure(pipeline) {
  const failed = [];
  for (const scope of ["international", "twnews"]) {
    if (pipeline?.[scope]?.normalizeFailed === true) {
      failed.push(scope);
      console.warn(
        `[LLM] ${scope} 正規化全批失敗：本輪只剩快取、資料未更新（provenance.pipeline.${scope}.normalizeFailed=true）`,
      );
    }
  }
  return failed;
}

export function warnOnGnSystemicFailure(pipeline) {
  const gnHealth = pipeline?.twnews?.gnHealth;
  if (gnHealth?.systemic !== true) return false;
  console.warn(
    `[GN健康] Google News 系統性異常：${gnHealth.gnOk}/${gnHealth.gnFeeds} GN feed 正常（okRate ${gnHealth.okRate}；provenance.pipeline.twnews.gnHealth.systemic=true）`,
  );
  return true;
}

export function readPipeline(path = "public/data/provenance.json") {
  const file = JSON.parse(readFileSync(path, "utf8"));
  return file.pipeline || {};
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const required = argValue("require")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const path = argValue("file") || "public/data/provenance.json";
  const minInternationalFeeds = Number(argValue("min-international-feeds") || 0);
  const minInternationalRaw = Number(argValue("min-international-raw") || 0);
  const allowStaleCwa = parseAllowStaleCwaValue(
    argValue("allow-stale-cwa") || process.env.ALLOW_STALE_CWA,
  );
  const pipeline = readPipeline(path);
  assertRequiredPipelineSources(pipeline, required, { allowStaleCwa });
  assertInternationalFeedCoverage(pipeline.international, {
    minFeeds: minInternationalFeeds,
    minRawItems: minInternationalRaw,
  });
  warnOnNormalizeFailure(pipeline);
  warnOnGnSystemicFailure(pipeline);
  console.log(`Required pipeline sources ok: ${required.join(", ")}`);
}
