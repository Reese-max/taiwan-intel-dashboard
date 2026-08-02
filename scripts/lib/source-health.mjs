import { auditSourceFreshness } from "../audit-source-freshness.mjs";

export const DEFAULT_INTERNATIONAL_COVERAGE = Object.freeze({
  minFeeds: 10,
  minRawItems: 50,
});

export const DEFAULT_DOMAIN_COVERAGE = Object.freeze({
  integrated: 1,
  reference: 1,
});

export const SOURCE_HEALTH_REPORT_SCHEMA_VERSION = 1;

const DERIVED_PIPELINE_STAGES = new Set(["network", "summary"]);

function text(value, fallback = "") {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

function numberOr(value, fallback = NaN) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function coverageIssue({ severity, code, source, reason, ...detail }) {
  return { severity, code, source, reason, ...detail };
}

function collectRequestFailures(value, path, failures) {
  if (!value || typeof value !== "object") return;
  if (value.ok === false || value.failed === true) {
    failures.push({
      source: path.join(".") || "(root)",
      error: text(value.error, "未提供錯誤原因"),
    });
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object") collectRequestFailures(child, [...path, key], failures);
  }
}

function requestFindings(pipeline, requiredSources = []) {
  const failures = [];
  for (const [name, status] of Object.entries(pipeline || {})) {
    if (DERIVED_PIPELINE_STAGES.has(name)) continue;
    collectRequestFailures(status, [name], failures);
  }
  const required = new Set(requiredSources);
  return failures.map(({ source, error }) => ({
    severity: required.has(source.split(".")[0]) ? "fail" : "warning",
    code: "request-failed",
    source,
    reason: `來源請求失敗：${error}`,
  }));
}

function staleSourceRequestFindings(provenance, existing, requiredSources = []) {
  const required = new Set(requiredSources);
  return (Array.isArray(provenance?.sources) ? provenance.sources : [])
    .filter((source) => source?.stale === true && source?.skippedThisRun !== true)
    .filter((source) => !source.error || !existing.some((finding) => finding.reason.endsWith(String(source.error))))
    .map((source) => {
      const sourceName = text(source.name, source.datasetId || source.key || "(未命名來源)");
      const requiredSource = [source.key, source.datasetId, source.name].some((value) => required.has(String(value)));
      return {
        severity: requiredSource ? "fail" : "warning",
        code: "request-failed",
        source: sourceName,
        reason: `來源請求失敗：${text(source.error, "provenance 標記 stale=true")}`,
      };
    });
}

function staleReason(row) {
  if (row.reason === "no-success-timestamp") return "沒有可信的成功時間戳";
  return `資料過期：age=${row.ageHours}h > ${row.threshold}h`;
}

function freshnessFindings(freshness) {
  const failures = freshness.staleStructured.map((row) => coverageIssue({
    severity: "fail",
    code: "data-stale",
    source: row.name,
    reason: staleReason(row),
    type: row.type,
    category: row.category,
  }));
  const warnings = [
    ...freshness.staleFetchFailures.map((row) => coverageIssue({
      severity: "warning",
      code: "data-stale-after-request-failure",
      source: row.name,
      reason: `請求失敗後沿用舊資料：${staleReason(row)}`,
      type: row.type,
      category: row.category,
    })),
    ...freshness.staleSkippedThisRun.map((row) => coverageIssue({
      severity: "warning",
      code: "data-stale-skipped",
      source: row.name,
      reason: `本輪未請求，沿用舊資料：${staleReason(row)}`,
      type: row.type,
      category: row.category,
    })),
  ];
  return { failures, warnings };
}

function coverageFindings(
  provenance,
  domainCoverage,
  {
    minInternationalFeeds = DEFAULT_INTERNATIONAL_COVERAGE.minFeeds,
    minInternationalRawItems = DEFAULT_INTERNATIONAL_COVERAGE.minRawItems,
    domainMinimums = DEFAULT_DOMAIN_COVERAGE,
    coverageSeverity = "warning",
  } = {},
) {
  const warnings = [];
  const international = provenance?.pipeline?.international;
  if (international?.ok === true) {
    const okFeeds = numberOr(international.okFeeds);
    if (Number.isFinite(okFeeds) && okFeeds < minInternationalFeeds) {
      warnings.push(coverageIssue({
        severity: coverageSeverity,
        code: "coverage-low",
        source: "international",
        reason: `國際來源覆蓋量低於門檻：live feeds ${okFeeds}/${minInternationalFeeds}`,
        metric: "okFeeds",
        actual: okFeeds,
        threshold: minInternationalFeeds,
      }));
    }
    const rawItems = numberOr(international.rawCount);
    if (Number.isFinite(rawItems) && rawItems < minInternationalRawItems) {
      warnings.push(coverageIssue({
        severity: coverageSeverity,
        code: "coverage-low",
        source: "international",
        reason: `國際原文覆蓋量低於門檻：raw items ${rawItems}/${minInternationalRawItems}`,
        metric: "rawCount",
        actual: rawItems,
        threshold: minInternationalRawItems,
      }));
    }
  }

  for (const source of Array.isArray(provenance?.sources) ? provenance.sources : []) {
    const threshold = numberOr(source?.minCount ?? source?.minimumCount);
    const count = numberOr(source?.count);
    if (Number.isFinite(threshold) && Number.isFinite(count) && count < threshold) {
      warnings.push(coverageIssue({
        severity: coverageSeverity,
        code: "coverage-low",
        source: text(source.name, "(未命名來源)"),
        reason: `來源覆蓋量低於門檻：${count}/${threshold} 筆`,
        metric: "count",
        actual: count,
        threshold,
      }));
    }
  }

  for (const row of Array.isArray(domainCoverage?.rows) ? domainCoverage.rows : []) {
    const threshold = numberOr(domainMinimums?.[row?.status]);
    const healthy = numberOr(row?.healthySourceCount, 0);
    if (!Number.isFinite(threshold) || healthy >= threshold) continue;
    warnings.push(coverageIssue({
      severity: coverageSeverity,
      code: "coverage-low",
      source: text(row.key, `${row.scope || "未知"}/${row.status || "未知"}`),
      reason: `領域健康來源低於門檻：${healthy}/${threshold}（${row.status}）`,
      metric: "healthySourceCount",
      actual: healthy,
      threshold,
    }));
  }
  return warnings;
}

function sourceReportRow(source, index, staleNames) {
  const attemptedAt = timestamp(source?.lastAttemptAt);
  const succeededAt = timestamp(source?.lastSuccessAt);
  const attempted = attemptedAt !== null;
  // 成功必須有本輪（或更晚）的成功時間戳；未標 stale 不是成功證據。
  const successful = attempted
    && source?.stale !== true
    && succeededAt !== null
    && succeededAt >= attemptedAt;
  const name = text(source?.name, source?.datasetId || source?.key || `來源 ${index + 1}`);
  const freshness = source?.stale === true || staleNames.has(name)
    ? "stale"
    : succeededAt === null
      ? "unknown"
      : "fresh";
  return {
    id: text(source?.datasetId, source?.key || name),
    name,
    attempted,
    successful,
    freshness,
    coverageCount: numberOr(source?.count, 0),
    lastAttemptAt: attemptedAt === null ? null : String(source.lastAttemptAt),
    lastSuccessAt: succeededAt === null ? null : String(source.lastSuccessAt),
  };
}

function staleSourceNames(freshness) {
  return new Set([
    ...freshness.staleStructured,
    ...freshness.staleFetchFailures,
    ...freshness.staleSkippedThisRun,
  ].map((row) => row.name));
}

function sourceHealthReport({ provenance, freshness, status, ok, failures, warnings }) {
  const staleNames = staleSourceNames(freshness);
  const sources = (Array.isArray(provenance?.sources) ? provenance.sources : [])
    .map((source, index) => sourceReportRow(source, index, staleNames));
  const attemptedSources = sources.filter((source) => source.attempted);
  const successfulSources = attemptedSources.filter((source) => source.successful);
  return {
    schemaVersion: SOURCE_HEALTH_REPORT_SCHEMA_VERSION,
    generatedAt: typeof provenance?.generatedAt === "string" ? provenance.generatedAt : null,
    ok,
    status,
    summary: {
      sourceCount: sources.length,
      attemptedSourceCount: attemptedSources.length,
      successfulSourceCount: successfulSources.length,
      successRate: attemptedSources.length
        ? Math.round((successfulSources.length / attemptedSources.length) * 10_000) / 100
        : null,
      freshSourceCount: sources.filter((source) => source.freshness === "fresh").length,
      staleSourceCount: sources.filter((source) => source.freshness === "stale").length,
      coverageCount: sources.reduce((total, source) => total + source.coverageCount, 0),
    },
    sources,
    failures,
    warnings,
  };
}

function reportDifference(actual, expected, path = "report") {
  if (Object.is(actual, expected)) return null;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return `${path} 預期為陣列`;
    if (actual.length !== expected.length) return `${path}.length 預期 ${expected.length}，實際 ${actual.length}`;
    for (let index = 0; index < expected.length; index++) {
      const difference = reportDifference(actual[index], expected[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return `${path} 預期為物件`;
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();
    if (actualKeys.join("\u0000") !== expectedKeys.join("\u0000")) return `${path} 欄位不符合固定 schema`;
    for (const key of expectedKeys) {
      const difference = reportDifference(actual[key], expected[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return `${path} 預期 ${JSON.stringify(expected)}，實際 ${JSON.stringify(actual)}`;
}

export function validateSourceHealthReport(report, expectedReport) {
  const difference = reportDifference(report, expectedReport);
  return difference ? [coverageIssue({
    severity: "fail",
    code: "report-invalid",
    source: "source-health-report",
    reason: `固定健康報告與實際來源不一致：${difference}`,
  })] : [];
}

export function auditSourceHealth({ provenance = {}, domainCoverage = {}, ...options } = {}) {
  const freshness = auditSourceFreshness(provenance, options);
  const requests = requestFindings(provenance.pipeline, options.requiredSources);
  requests.push(...staleSourceRequestFindings(provenance, requests, options.requiredSources));
  const stale = freshnessFindings(freshness);
  const coverage = coverageFindings(provenance, domainCoverage, options);
  const failures = [
    ...requests.filter((finding) => finding.severity === "fail"),
    ...stale.failures,
    ...coverage.filter((finding) => finding.severity === "fail"),
  ];
  const warnings = [
    ...requests.filter((finding) => finding.severity === "warning"),
    ...stale.warnings,
    ...coverage.filter((finding) => finding.severity === "warning"),
  ];
  const healthOk = failures.length === 0;
  const healthStatus = failures.length ? "fail" : warnings.length ? "warning" : "pass";
  const expectedReport = sourceHealthReport({
    provenance,
    freshness,
    status: healthStatus,
    ok: healthOk,
    failures,
    warnings,
  });
  const reportFailures = options.report === undefined
    ? []
    : validateSourceHealthReport(options.report, expectedReport);
  const allFailures = [...failures, ...reportFailures];
  const ok = allFailures.length === 0;
  const status = !ok ? "fail" : healthStatus;
  return {
    ok,
    status,
    failures: allFailures,
    warnings,
    freshness,
    report: sourceHealthReport({
      provenance,
      freshness,
      status,
      ok,
      failures: allFailures,
      warnings,
    }),
  };
}
