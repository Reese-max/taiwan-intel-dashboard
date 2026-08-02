import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// @ts-expect-error — JS ESM module without types
import { auditSourceHealth } from "../scripts/lib/source-health.mjs";

const generatedAt = "2026-07-05T00:00:00.000Z";
const now = Date.parse(generatedAt);

const provenance = (sources: unknown[] = [], pipeline: Record<string, unknown> = {}) => ({
  generatedAt,
  sources,
  pipeline,
});

describe("auditSourceHealth（來源失敗非靜默判定）", () => {
  it("來源請求失敗會產生 warning 與具體原因，但保留 fail-soft", () => {
    const result = auditSourceHealth({
      provenance: provenance([], { optional: { ok: false, error: "HTTP 503" } }),
      now,
    });

    expect(result.status).toBe("warning");
    expect(result.failures).toHaveLength(0);
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: "request-failed",
      source: "optional",
      reason: "來源請求失敗：HTTP 503",
    }));
  });

  it("必要來源請求失敗會產生 fail", () => {
    const result = auditSourceHealth({
      provenance: provenance([], { cwa: { ok: false, error: "API key 無效" } }),
      requiredSources: ["cwa"],
      now,
    });

    expect(result.status).toBe("fail");
    expect(result.failures).toContainEqual(expect.objectContaining({
      code: "request-failed",
      source: "cwa",
      reason: "來源請求失敗：API key 無效",
    }));
  });

  it("僅有 source.stale=true 且尚未超過 age 門檻時仍會告警", () => {
    const result = auditSourceHealth({
      provenance: provenance([
        {
          name: "測試快照來源",
          type: "gov-open-data",
          fetchedAt: generatedAt,
          stale: true,
        },
      ]),
      now,
    });

    expect(result.status).toBe("warning");
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: "request-failed",
      source: "測試快照來源",
      reason: "來源請求失敗：provenance 標記 stale=true",
    }));
  });

  it("資料過期會產生 fail，並保留 age 與門檻", () => {
    const result = auditSourceHealth({
      provenance: provenance([
        {
          name: "測試官方來源",
          type: "gov-open-data",
          lastSuccessAt: "2026-06-30T00:00:00.000Z",
        },
      ]),
      now,
    });

    expect(result.status).toBe("fail");
    expect(result.failures).toContainEqual(expect.objectContaining({
      code: "data-stale",
      source: "測試官方來源",
      reason: "資料過期：age=120h > 48h",
    }));
  });

  it("領域健康來源低於門檻會產生 warning", () => {
    const result = auditSourceHealth({
      provenance: provenance(),
      domainCoverage: {
        rows: [{ key: "災防／氣象", status: "integrated", healthySourceCount: 0 }],
      },
      now,
    });

    expect(result.status).toBe("warning");
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: "coverage-low",
      source: "災防／氣象",
      reason: "領域健康來源低於門檻：0/1（integrated）",
    }));
  });

  it("國際 live feed 與 raw item 低於門檻會各自說明", () => {
    const result = auditSourceHealth({
      provenance: provenance([], { international: { ok: true, okFeeds: 2, rawCount: 4 } }),
      minInternationalFeeds: 3,
      minInternationalRawItems: 5,
      now,
    });

    expect(result.status).toBe("warning");
    expect(result.warnings.filter((finding: { code: string }) => finding.code === "coverage-low")).toHaveLength(2);
    expect(result.warnings.map((finding: { reason: string }) => finding.reason)).toEqual(expect.arrayContaining([
      "國際來源覆蓋量低於門檻：live feeds 2/3",
      "國際原文覆蓋量低於門檻：raw items 4/5",
    ]));
  });

  it("沒有異常時回傳 pass", () => {
    const result = auditSourceHealth({
      provenance: provenance(
        [{ name: "健康來源", type: "gov-open-data", lastSuccessAt: generatedAt }],
        { international: { ok: true, okFeeds: 10, rawCount: 50 } },
      ),
      domainCoverage: { rows: [{ key: "災防／氣象", status: "integrated", healthySourceCount: 1 }] },
      now,
    });

    expect(result).toMatchObject({ ok: true, status: "pass", failures: [], warnings: [] });
  });

  it("已嘗試但無成功時間戳的來源不能被報成 100% 成功率", () => {
    const input = provenance([
      { name: "無成功證據來源", type: "news-rss", stale: false, lastAttemptAt: generatedAt },
    ]);
    const expected = auditSourceHealth({ provenance: input, now });
    const forged = {
      ...expected.report,
      summary: { ...expected.report.summary, successRate: 100 },
    };
    const result = auditSourceHealth({ provenance: input, now, report: forged });

    expect(expected.report.summary).toMatchObject({
      attemptedSourceCount: 1,
      successfulSourceCount: 0,
      successRate: 0,
    });
    expect(expected.report).toMatchObject({ ok: true, status: "pass", failures: [] });
    expect(result).toMatchObject({ ok: false, status: "fail" });
    expect(result.failures).toContainEqual(expect.objectContaining({
      code: "report-invalid",
      source: "source-health-report",
      reason: expect.stringContaining("report.summary.successRate 預期 0，實際 100"),
    }));
    expect(result.report).toMatchObject({
      ok: false,
      status: "fail",
      failures: expect.arrayContaining([
        expect.objectContaining({ code: "report-invalid", source: "source-health-report" }),
      ]),
    });
  });

  it("混合來源時健康、失敗、過期與低覆蓋量判定彼此獨立", () => {
    const result = auditSourceHealth({
      provenance: provenance([
        { name: "健康來源", type: "gov-open-data", lastSuccessAt: generatedAt },
        { name: "過期來源", type: "gov-open-data", lastSuccessAt: "2026-06-30T00:00:00.000Z" },
        { name: "低覆蓋來源", type: "news-rss", count: 1, minCount: 3 },
      ], {
        failedSource: { ok: false, error: "HTTP 503" },
      }),
      now,
    });

    expect(result.status).toBe("fail");
    expect(result.failures).toEqual([
      expect.objectContaining({ code: "data-stale", source: "過期來源" }),
    ]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "request-failed",
        source: "failedSource",
        reason: "來源請求失敗：HTTP 503",
      }),
      expect.objectContaining({
        code: "coverage-low",
        source: "低覆蓋來源",
        reason: "來源覆蓋量低於門檻：1/3 筆",
      }),
    ]));
    expect([...result.failures, ...result.warnings]).not.toContainEqual(
      expect.objectContaining({ source: "健康來源" }),
    );
  });

  it("CLI 會輸出 CI annotation、JSON 結果並以 fail 結束", () => {
    const dir = mkdtempSync(join(tmpdir(), "source-health-"));
    const provenancePath = join(dir, "provenance.json");
    const domainCoveragePath = join(dir, "domain-coverage.json");
    const scriptPath = fileURLToPath(new URL("../scripts/audit-source-health.mjs", import.meta.url));
    try {
      writeFileSync(provenancePath, JSON.stringify(provenance([
        { name: "過期來源", type: "gov-open-data", lastSuccessAt: "2026-06-30T00:00:00.000Z" },
      ])), "utf8");
      writeFileSync(domainCoveragePath, JSON.stringify({ rows: [] }), "utf8");
      const result = spawnSync(process.execPath, [
        scriptPath,
        `--provenance=${provenancePath}`,
        `--domain-coverage=${domainCoveragePath}`,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("::error title=來源健康::過期來源：資料過期：age=120h > 48h");
      expect(result.stdout).toContain("SOURCE_HEALTH_RESULT=");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("CLI 會對混合來源逐一輸出失敗、過期與低覆蓋量告警", () => {
    const dir = mkdtempSync(join(tmpdir(), "source-health-mixed-"));
    const provenancePath = join(dir, "provenance.json");
    const domainCoveragePath = join(dir, "domain-coverage.json");
    const scriptPath = fileURLToPath(new URL("../scripts/audit-source-health.mjs", import.meta.url));
    try {
      writeFileSync(provenancePath, JSON.stringify(provenance([
        { name: "健康來源", type: "gov-open-data", lastSuccessAt: generatedAt },
        { name: "過期來源", type: "gov-open-data", lastSuccessAt: "2026-06-30T00:00:00.000Z" },
        { name: "低覆蓋來源", type: "news-rss", count: 1, minCount: 3 },
      ], {
        failedSource: { ok: false, error: "HTTP 503" },
      })), "utf8");
      writeFileSync(domainCoveragePath, JSON.stringify({ rows: [] }), "utf8");
      const result = spawnSync(process.execPath, [
        scriptPath,
        `--provenance=${provenancePath}`,
        `--domain-coverage=${domainCoveragePath}`,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("::warning title=來源健康::failedSource：來源請求失敗：HTTP 503");
      expect(result.stdout).toContain("::error title=來源健康::過期來源：資料過期：age=120h > 48h");
      expect(result.stdout).toContain("::warning title=來源健康::低覆蓋來源：來源覆蓋量低於門檻：1/3 筆");
      expect(result.stdout).not.toContain("健康來源：");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("CLI 驗證報告失敗時，SOURCE_HEALTH_RESULT 同步輸出 fail 與錯誤", () => {
    const dir = mkdtempSync(join(tmpdir(), "source-health-report-"));
    const provenancePath = join(dir, "provenance.json");
    const domainCoveragePath = join(dir, "domain-coverage.json");
    const reportPath = join(dir, "source-health-report.json");
    const scriptPath = fileURLToPath(new URL("../scripts/audit-source-health.mjs", import.meta.url));
    const input = provenance([
      { name: "無成功證據來源", type: "news-rss", stale: false, lastAttemptAt: generatedAt },
    ]);
    try {
      const expected = auditSourceHealth({ provenance: input, now });
      writeFileSync(provenancePath, JSON.stringify(input), "utf8");
      writeFileSync(domainCoveragePath, JSON.stringify({ rows: [] }), "utf8");
      writeFileSync(reportPath, JSON.stringify({
        ...expected.report,
        summary: { ...expected.report.summary, successRate: 100 },
      }), "utf8");
      const result = spawnSync(process.execPath, [
        scriptPath,
        `--provenance=${provenancePath}`,
        `--domain-coverage=${domainCoveragePath}`,
        `--report=${reportPath}`,
      ], { encoding: "utf8" });
      const line = result.stdout.split(/\r?\n/).find((value) => value.startsWith("SOURCE_HEALTH_RESULT="));

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("::error title=來源健康::source-health-report：固定健康報告與實際來源不一致：report.summary.successRate 預期 0，實際 100");
      expect(line).toBeDefined();
      expect(JSON.parse(line!.slice("SOURCE_HEALTH_RESULT=".length))).toMatchObject({
        ok: false,
        status: "fail",
        failures: expect.arrayContaining([
          expect.objectContaining({ code: "report-invalid", source: "source-health-report" }),
        ]),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
