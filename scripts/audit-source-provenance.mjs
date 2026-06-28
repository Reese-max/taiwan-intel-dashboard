import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const files = ["public/data/domestic.json", "public/data/international.json"];
const maxDetails = Number(process.env.AUDIT_SOURCE_PROVENANCE_MAX_DETAILS) || 80;
let failures = 0;
let shown = 0;

function fail(file, id, message) {
  failures += 1;
  if (shown < maxDetails) {
    shown += 1;
    console.error(`${file} ${id}: ${message}`);
  }
}

for (const file of files) {
  const events = JSON.parse(readFileSync(join(root, file), "utf8"));
  for (const e of events) {
    const s = e.source || {};
    if (typeof s.name === "string" && s.name.startsWith("GN ")) {
      fail(file, e.id, `source.name must not be Google News query label: ${s.name}`);
    }
    const url = String(s.url || s.recordRef || "");
    if (url.includes("news.google.com") && s.aggregatorName !== "Google News") {
      fail(file, e.id, "news.google.com URL must declare aggregatorName=Google News");
    }
    if (e.lat === 0 && e.lng === 0 && e.locationPrecision !== "global") {
      fail(file, e.id, "0,0 coordinate must be marked locationPrecision=global or omitted from map");
    }
    if (s.sourceConfidence === "aggregated" && !s.aggregatorName) {
      fail(file, e.id, "aggregated source must include aggregatorName");
    }
  }
}

if (failures) {
  if (failures > shown) console.error(`... ${failures - shown} more issue(s) hidden; set AUDIT_SOURCE_PROVENANCE_MAX_DETAILS to raise the cap.`);
  console.error(`source provenance audit failed: ${failures} issue(s)`);
  process.exit(1);
}

console.log("source provenance audit passed");
