import { readFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = join(root, "ops", "approved-code.json");

export function approvedCodeSha(file = manifest) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const sha = parsed?.sha;
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("ops/approved-code.json must contain a full lowercase commit SHA");
  }
  return sha;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const sha = approvedCodeSha();
    const output = process.argv.find((arg) => arg.startsWith("--github-output="))?.slice(16);
    if (output) appendFileSync(output, `sha=${sha}\n`);
    console.log(`Approved production code: ${sha}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
