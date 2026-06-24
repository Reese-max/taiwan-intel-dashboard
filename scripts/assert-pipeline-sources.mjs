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
  const allowStaleCwa = parseAllowStaleCwaValue(
    argValue("allow-stale-cwa") || process.env.ALLOW_STALE_CWA,
  );
  assertRequiredPipelineSources(readPipeline(path), required, { allowStaleCwa });
  console.log(`Required pipeline sources ok: ${required.join(", ")}`);
}
