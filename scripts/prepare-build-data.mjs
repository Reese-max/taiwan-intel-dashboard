import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INTERNATIONAL_STUB = "[]\n";

const readIfExists = (path) => (existsSync(path) ? readFileSync(path) : null);

/**
 * Make a clean-checkout build hermetic without masking a partial data snapshot.
 * Real pipeline data wins whenever both required inputs are already present.
 * Exclusive creates catch publishers that land before each write; byte checks
 * afterwards catch a publisher that overwrites domestic mid-seed — we never
 * delete or keep a file that would leave real data mixed with fixtures.
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
  const fixtureBytes = readFileSync(fixturePath);
  let seededDomestic = false;
  try {
    // A refresh may publish snapshots after the absence checks; never replace them.
    copyFileSync(fixturePath, domesticPath, constants.COPYFILE_EXCL);
    seededDomestic = true;
    writeFileSync(internationalPath, INTERNATIONAL_STUB, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    // If a concurrent publisher won the second exclusive create, do not leave a
    // synthetic domestic snapshot paired with its real international snapshot —
    // but only remove domestic if it still holds the bytes we wrote; a publisher
    // that already overwrote it owns the file.
    const current = readIfExists(domesticPath);
    if (seededDomestic && current && current.equals(fixtureBytes)) unlinkSync(domesticPath);
    throw error;
  }
  // A publisher can also overwrite either file *between* the two exclusive
  // creates or just after (publishers don't use EXCL). Detect by content and
  // unwind whichever halves are still ours rather than leave a fixture masked
  // by — or masking — a real snapshot.
  const domesticNow = readIfExists(domesticPath);
  const internationalNow = readIfExists(internationalPath);
  const domesticIsOurs = domesticNow != null && domesticNow.equals(fixtureBytes);
  const internationalIsOurs =
    internationalNow != null && internationalNow.equals(Buffer.from(INTERNATIONAL_STUB, "utf8"));
  if (!domesticIsOurs || !internationalIsOurs) {
    if (internationalIsOurs) unlinkSync(internationalPath);
    if (domesticIsOurs) unlinkSync(domesticPath);
    throw new Error("build data changed during seeding; refusing to mix fixture with a real snapshot");
  }
  return true;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const dataDir = join(ROOT, "public", "data");
  const seeded = ensureBuildData(dataDir, join(ROOT, "tests", "fixtures", "govintel-domestic.json"));
  if (seeded) console.log("build data missing; seeded committed synthetic snapshots for the clean checkout build");
}
