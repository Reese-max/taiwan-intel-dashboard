// Rebuild recognized statistical fallbacks for a verified, existing preview cohort.
// No feed/LLM requests and no writes to the restored pipeline-state checkout.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { auditSummary, deterministicBrief, isDeterministicFallback } from "./lib/summary-quality.mjs";
import { isReferenceEvent, validateEventContract } from "./lib/event-contract.mjs";

export const PREVIEW_RECEIPT = "preview-summary-derivation.json";
const REQUIRED = ["domestic.json", "international.json", "network.json", "summary.json"];
const IMMUTABLE_INPUTS = ["domestic.json", "international.json", "summary.json", "provenance.json"];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (dir, name) => JSON.parse(readFileSync(join(dir, name), "utf8"));
const isClock = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const hashFile = (dir, name) => digest(readFileSync(join(dir, name)));
const within = (parent, child) => { const rel = relative(parent, child); return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); };
function canonicalTarget(value) {
  let existing = resolve(value);
  const tail = [];
  while (!existsSync(existing)) { tail.unshift(basename(existing)); existing = dirname(existing); }
  if (lstatSync(existing).isSymbolicLink() && !tail.length) throw new Error("Linked preview output is not supported");
  return join(realpathSync(existing), ...tail);
}

function verifySource(sourceDir) {
  const manifest = read(sourceDir, "manifest.json");
  if (manifest.manifestVersion !== 1 || !manifest.snapshotId || !isClock(manifest.generatedAt)) throw new Error("Invalid source cohort manifest");
  for (const name of REQUIRED) if (!manifest.files?.[name]) throw new Error(`Source cohort does not bind ${name}`);
  for (const [name, record] of Object.entries(manifest.files)) {
    if (!/^[A-Za-z0-9._-]+\.json$/.test(name) || record.path !== name || lstatSync(join(sourceDir, name)).isSymbolicLink()) throw new Error("Unsafe source cohort path");
    const bytes = readFileSync(join(sourceDir, name));
    if (digest(bytes) !== record.sha256 || bytes.length !== record.bytes) throw new Error(`Source cohort hash mismatch: ${name}`);
    if (record.count !== undefined && (!Array.isArray(JSON.parse(bytes)) || JSON.parse(bytes).length !== record.count)) throw new Error(`Source cohort count mismatch: ${name}`);
  }
  const network = read(sourceDir, "network.json"), provenance = read(sourceDir, "provenance.json");
  if (network.snapshotId !== manifest.snapshotId || network.generatedAt !== manifest.generatedAt || provenance.generatedAt !== manifest.generatedAt) throw new Error("Mixed source cohort/as-of clocks");
  return manifest;
}

export function preparePreviewData({ sourceDir, outputDir }) {
  sourceDir = realpathSync(sourceDir);
  outputDir = canonicalTarget(outputDir);
  if (within(sourceDir, outputDir) || within(outputDir, sourceDir)) throw new Error("Preview output must be separate from the source checkout");
  if (existsSync(outputDir) && (lstatSync(outputDir).isSymbolicLink() || readdirSync(outputDir).length)) throw new Error("Preview output must be empty");
  const names = readdirSync(sourceDir).filter((name) => name.endsWith(".json"));
  if (names.includes(PREVIEW_RECEIPT) || names.some((name) => !lstatSync(join(sourceDir, name)).isFile())) throw new Error("Source must contain original regular snapshot files");
  const manifest = verifySource(sourceDir);
  const summary = read(sourceDir, "summary.json"), next = structuredClone(summary), events = {}, changes = [];
  if (!isClock(summary.generatedAt)) throw new Error("Missing original summary publication clock");
  for (const scope of ["domestic", "international"]) {
    const rows = read(sourceDir, `${scope}.json`);
    if (!Array.isArray(rows) || validateEventContract(rows).invalid.length) throw new Error(`Invalid ${scope} snapshot`);
    events[scope] = rows.filter((row) => !isReferenceEvent(row));
    const text = summary[scope], label = scope === "domestic" ? "國內事件" : "國際事件";
    const degraded = summary.degraded === true || summary.degraded?.[scope] === true;
    if (isDeterministicFallback(text)) {
      const suffix = " 為主。（AI 摘要暫時無法生成，事件資料仍可查閱；此為系統統計備援）";
      if (!degraded || typeof text !== "string" || !text.startsWith(`${label}共 `) || !/^.+?共 [0-9]+ 起，以 .+/.test(text) || !text.endsWith(suffix)) throw new Error(`Unrecognized degraded fallback: ${scope}`);
      next[scope] = deterministicBrief(label, events[scope]);
      if (next[scope] !== text) changes.push({ scope, beforeSha256: digest(text), afterSha256: digest(next[scope]), incidentCount: events[scope].length });
    } else {
      // Narrative counts cannot be repaired deterministically without replacing
      // the model's claims; leave those failures visible for a fresh review.
      const advertised = typeof text === "string" ? text.match(/共 ([0-9]+) 起/) : null;
      if (advertised && Number(advertised[1]) !== events[scope].length) throw new Error(`Non-fallback summary count mismatch: ${scope}`);
    }
  }
  const report = auditSummary({ summary: next, domesticCount: events.domestic.length, internationalCount: events.international.length });
  if (!report.ok) throw new Error(`Preview summary rejected: ${report.failures.map((f) => f.reason).join("; ")}`);
  const receipt = {
    schemaVersion: 1, kind: "preview-deterministic-summary",
    note: "Offline derivation from the restored snapshot; no new fetch or model generation. Original clocks and cohort retained.",
    source: { snapshotId: manifest.snapshotId, generatedAt: manifest.generatedAt, summaryGeneratedAt: summary.generatedAt,
      manifestSha256: hashFile(sourceDir, "manifest.json"), files: Object.fromEntries(REQUIRED.map((name) => [name, hashFile(sourceDir, name)])) },
    changes,
  };
  mkdirSync(outputDir, { recursive: true });
  try {
    for (const name of names) copyFileSync(join(sourceDir, name), join(outputDir, name));
    if (changes.length) writeFileSync(join(outputDir, "summary.json"), JSON.stringify(next, null, 2) + "\n");
    const bytes = readFileSync(join(outputDir, "summary.json"));
    const previewManifest = structuredClone(manifest);
    previewManifest.files["summary.json"] = { ...previewManifest.files["summary.json"], sha256: digest(bytes), bytes: bytes.length };
    writeFileSync(join(outputDir, "manifest.json"), JSON.stringify(previewManifest, null, 2) + "\n");
    receipt.inputs = Object.fromEntries(IMMUTABLE_INPUTS.map((name) => [name, hashFile(outputDir, name)]));
    writeFileSync(join(outputDir, PREVIEW_RECEIPT), JSON.stringify(receipt, null, 2) + "\n");
  } catch (error) {
    rmSync(outputDir, { recursive: true, force: true });
    throw error;
  }
  return receipt;
}

export function previewSnapshotContext(dataDir, env = process.env) {
  if (env.BUILD_PREVIEW_SNAPSHOT !== "1") return null;
  const receipt = read(dataDir, PREVIEW_RECEIPT), manifest = verifySource(dataDir);
  if (receipt.schemaVersion !== 1 || receipt.kind !== "preview-deterministic-summary" || !receipt.source?.snapshotId || !isClock(receipt.source.generatedAt)) throw new Error("Invalid preview derivation receipt");
  if (manifest.snapshotId !== receipt.source.snapshotId || manifest.generatedAt !== receipt.source.generatedAt) throw new Error("Preview cohort identity/as-of changed");
  for (const name of IMMUTABLE_INPUTS) if (hashFile(dataDir, name) !== receipt.inputs?.[name]) throw new Error(`Preview input changed after derivation: ${name}`);
  const network = read(dataDir, "network.json");
  if (network.snapshotId !== receipt.source.snapshotId || network.generatedAt !== receipt.source.generatedAt) throw new Error("Preview network cohort/as-of changed");
  return { snapshotId: receipt.source.snapshotId, generatedAt: receipt.source.generatedAt };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const arg = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
    const sourceDir = arg("source"), outputDir = arg("output");
    if (!sourceDir || !outputDir) throw new Error("Use --source=<restored data> --output=<separate empty preview data>");
    const result = preparePreviewData({ sourceDir, outputDir });
    console.log(`Preview snapshot ${result.source.snapshotId}: rebuilt ${result.changes.length} deterministic fallback(s), as-of ${result.source.generatedAt}; no fetch/model calls`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
