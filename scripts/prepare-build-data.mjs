import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Make a clean-checkout build hermetic without masking a partial data snapshot.
 * Real pipeline data wins whenever both required inputs are already present.
 */
export function ensureBuildData(dataDir, fixturePath) {
  const domesticPath = join(dataDir, "domestic.json");
  const internationalPath = join(dataDir, "international.json");
  const hasDomestic = existsSync(domesticPath);
  const hasInternational = existsSync(internationalPath);

  if (hasDomestic !== hasInternational) {
    throw new Error("build data incomplete: domestic.json and international.json must be provided together");
  }
  if (hasDomestic) return false;
  if (existsSync(dataDir) && readdirSync(dataDir).length > 0) {
    throw new Error("build data incomplete: data directory contains files but both event snapshots are absent");
  }

  mkdirSync(dataDir, { recursive: true });
  // A refresh may publish snapshots after the absence checks; never replace them.
  copyFileSync(fixturePath, domesticPath, constants.COPYFILE_EXCL);
  writeFileSync(internationalPath, "[]\n", { encoding: "utf8", flag: "wx" });
  return true;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const dataDir = join(ROOT, "public", "data");
  const seeded = ensureBuildData(dataDir, join(ROOT, "tests", "fixtures", "govintel-domestic.json"));
  if (seeded) console.log("build data missing; seeded committed synthetic snapshots for the clean checkout build");
}
