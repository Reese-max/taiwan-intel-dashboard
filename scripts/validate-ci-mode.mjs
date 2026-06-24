import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function runNodeScript(args, env) {
  const nodeExecutable = process.execPath;
  const scriptPath = join(fileURLToPath(new URL("./assert-pipeline-sources.mjs", import.meta.url)));
  const result = spawnSync(nodeExecutable, [scriptPath, ...args], {
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function makeSmoke() {
  const dir = mkdtempSync(join(tmpdir(), "ci-mode-"));
  const path = join(dir, "provenance.json");
  return { dir, path };
}

function buildFixture(overrides = {}) {
  const base = {
    pipeline: {
      cwa: { ok: true, count: 10 },
      cwaWarnings: { ok: true, count: 0 },
      international: { ok: true, count: 10 },
    },
  };
  return JSON.stringify({ ...base, ...overrides }, null, 2);
}

const { dir, path } = makeSmoke();
try {
  writeFileSync(path, buildFixture(), "utf8");
  runNodeScript([`--require=cwa,cwaWarnings,international`, `--file=${path}`]);

  writeFileSync(
    path,
    buildFixture({
      pipeline: {
        cwa: { ok: false, error: "暫時性失敗" },
        cwaWarnings: { ok: false, error: "暫時性失敗" },
        international: { ok: true, count: 10 },
      },
    }),
    "utf8",
  );
  runNodeScript([`--require=international`, `--file=${path}`], {});
  runNodeScript([`--require=cwa,cwaWarnings,international`, `--file=${path}`], {
    ALLOW_STALE_CWA: "1",
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("CI mode smoke checks passed");
