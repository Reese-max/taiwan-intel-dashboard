import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const REPORT_VERSION = "dependency-build-health/v1";

function cleanOutput(value) {
  return String(value || "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-12)
    .join("\n")
    .slice(-2000);
}

function run(command, args) {
  const executable = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : command;
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", command, ...args] : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  return {
    ok: result.error == null && result.status === 0,
    exitCode: result.status,
    stdout: cleanOutput(result.stdout),
    stderr: cleanOutput(result.stderr),
    error: result.error?.message || null,
  };
}

function commandFailure(result) {
  return cleanOutput([result.error, result.stderr, result.stdout].filter(Boolean).join("\n")) || "命令未提供錯誤輸出";
}

function sortedObject(value) {
  return Object.fromEntries(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
}

function inspectLockfile() {
  const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const lockfile = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  const root = lockfile.packages?.[""];
  const failures = [];

  if (!root) failures.push("package-lock.json 缺少根套件資料");
  if (lockfile.lockfileVersion !== 3) failures.push(`不支援的 lockfileVersion：${lockfile.lockfileVersion}`);
  if (root?.name !== packageJson.name) failures.push("package.json 與 package-lock.json 的套件名稱不一致");

  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    if (JSON.stringify(sortedObject(packageJson[section])) !== JSON.stringify(sortedObject(root?.[section]))) {
      failures.push(`${section} 與 package-lock.json 根套件資料不一致`);
    }
  }

  const entries = Object.entries(lockfile.packages || {}).filter(([name, entry]) =>
    name && !entry.link && !String(entry.resolved || "").startsWith("file:"),
  );
  const missingIntegrity = entries.filter(([, entry]) => !entry.integrity).length;
  const missingResolved = entries.filter(([, entry]) => !entry.resolved).length;
  if (missingIntegrity) failures.push(`有 ${missingIntegrity} 個套件缺少 integrity`);
  if (missingResolved) failures.push(`有 ${missingResolved} 個套件缺少 resolved`);

  return {
    status: failures.length ? "failed" : "passed",
    file: "package-lock.json",
    lockfileVersion: lockfile.lockfileVersion ?? null,
    rootManifestMatch: failures.every((failure) => !failure.includes("不一致")),
    packageEntries: entries.length,
    missingIntegrity,
    missingResolved,
    failureReason: failures.join("；") || null,
  };
}

function skipped(reason) {
  return { command: null, status: "skipped", exitCode: null, failureReason: reason };
}

function main() {
  const failures = [];
  const npmVersionResult = run(NPM, ["--version"]);
  const report = {
    schema: REPORT_VERSION,
    checkedAt: new Date().toISOString(),
    nodeVersion: process.version,
    npmVersion: npmVersionResult.ok ? npmVersionResult.stdout : null,
    lockfile: null,
    install: skipped("尚未執行"),
    build: skipped("尚未執行"),
    failures,
  };

  if (!npmVersionResult.ok) {
    failures.push({ stage: "runtime", reason: `無法取得 npm 版本：${commandFailure(npmVersionResult)}` });
  }

  try {
    report.lockfile = inspectLockfile();
  } catch (error) {
    report.lockfile = {
      status: "failed",
      file: "package-lock.json",
      lockfileVersion: null,
      rootManifestMatch: false,
      packageEntries: 0,
      missingIntegrity: null,
      missingResolved: null,
      failureReason: error.message,
    };
  }

  if (report.lockfile.status !== "passed") {
    failures.push({ stage: "lockfile", reason: report.lockfile.failureReason });
  } else if (npmVersionResult.ok) {
    const install = run(NPM, ["ci"]);
    report.install = {
      command: "npm ci",
      status: install.ok ? "passed" : "failed",
      exitCode: install.exitCode,
      failureReason: install.ok ? null : commandFailure(install),
    };
    if (!install.ok) {
      failures.push({ stage: "install", reason: report.install.failureReason });
    } else {
      const build = run(NPM, ["run", "build"]);
      report.build = {
        command: "npm run build",
        status: build.ok ? "passed" : "failed",
        exitCode: build.exitCode,
        failureReason: build.ok ? null : commandFailure(build),
      };
      if (!build.ok) failures.push({ stage: "build", reason: report.build.failureReason });
    }
  } else {
    report.install = skipped("npm 不可用");
    report.build = skipped("安裝未執行");
  }

  report.status = failures.length ? "failed" : "passed";
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = failures.length ? 1 : 0;
}

main();
