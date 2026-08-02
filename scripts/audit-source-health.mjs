import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditSourceHealth, SOURCE_HEALTH_REPORT_SCHEMA_VERSION } from "./lib/source-health.mjs";

export { auditSourceHealth };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function argValue(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function readJson(file, label) {
  if (!existsSync(file)) throw new Error(`找不到 ${label}：${file}`);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`無法讀取 ${label}：${error.message}`);
  }
}

function annotationValue(value) {
  return String(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function printFinding(finding) {
  const command = finding.severity === "fail" ? "error" : "warning";
  console.log(`::${command} title=來源健康::${annotationValue(`${finding.source}：${finding.reason}`)}`);
}

function failedReport(error) {
  return {
    schemaVersion: SOURCE_HEALTH_REPORT_SCHEMA_VERSION,
    generatedAt: null,
    ok: false,
    status: "fail",
    summary: {
      sourceCount: 0,
      attemptedSourceCount: 0,
      successfulSourceCount: 0,
      successRate: null,
      freshSourceCount: 0,
      staleSourceCount: 0,
      coverageCount: 0,
    },
    sources: [],
    failures: [{
      severity: "fail",
      code: "report-invalid",
      source: "source-health-report",
      reason: `來源健康稽核失敗：${error.message}`,
    }],
    warnings: [],
  };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const provenance = readJson(argValue("provenance") || join(ROOT, "public", "data", "provenance.json"), "provenance");
    const domainCoverage = readJson(
      argValue("domain-coverage") || join(ROOT, "public", "data", "domain-coverage.json"),
      "domain coverage",
    );
    const reportFile = argValue("report");
    const result = auditSourceHealth({
      provenance,
      domainCoverage,
      ...(reportFile ? { report: readJson(reportFile, "source health report") } : {}),
      requiredSources: argValue("require").split(",").map((value) => value.trim()).filter(Boolean),
      minInternationalFeeds: numberOr(
        argValue("min-international-feeds") || process.env.SOURCE_HEALTH_MIN_INTL_FEEDS,
        10,
      ),
      minInternationalRawItems: numberOr(
        argValue("min-international-raw") || process.env.SOURCE_HEALTH_MIN_INTL_RAW,
        50,
      ),
      coverageSeverity: process.argv.includes("--strict-coverage") ? "fail" : "warning",
    });

    if (process.argv.includes("--json")) console.log(JSON.stringify(result.report));
    else {
      for (const finding of [...result.failures, ...result.warnings]) printFinding(finding);
      console.log(`來源健康稽核：${result.status}（fail=${result.failures.length}, warning=${result.warnings.length}）`);
      console.log(`SOURCE_HEALTH_RESULT=${JSON.stringify(result.report)}`);
    }
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`來源健康稽核失敗：${error.message}`);
    const report = failedReport(error);
    console.log(process.argv.includes("--json") ? JSON.stringify(report) : `SOURCE_HEALTH_RESULT=${JSON.stringify(report)}`);
    process.exitCode = 1;
  }
}
