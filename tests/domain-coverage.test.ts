import { describe, expect, it } from "vitest";
import {
  buildDomainCoverage,
  validateDomainCoverageConfig,
} from "../scripts/domain-coverage.mjs";

describe("領域完整性清單", () => {
  it("依啟用設定計算核心領域來源覆蓋數", () => {
    const report = buildDomainCoverage();

    expect(report.validation).toMatchObject({ ok: true, failures: [] });
    expect(report.rows.filter((row) => row.configuredSourceCount > 0)).toHaveLength(7);
    expect(report.rows.find((row) => row.key === "治安／警政")).toMatchObject({
      configuredSourceCount: 2,
      enabledSourceCount: 2,
      coverageCount: 2,
      sourceCount: 0,
    });
  });

  it("報告核心領域沒有啟用來源、無效標籤與未歸類來源的原因", () => {
    const result = validateDomainCoverageConfig({
      sourceConfig: [
        {
          sourceId: "disabled",
          sourceKey: "disabled",
          domain: "治安／警政",
          enabled: false,
          publisherName: "測試機構",
          publisherUrl: "https://example.com/disabled",
        },
        {
          sourceId: "invalid-tag",
          sourceKey: "invalid-tag",
          domain: "不存在領域",
          publisherName: "測試機構",
          publisherUrl: "https://example.com/invalid",
        },
        {
          sourceId: "unclassified",
          sourceKey: "unclassified",
          publisherName: "測試機構",
          publisherUrl: "https://example.com/unclassified",
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "core-domain-no-enabled-source", domain: "治安／警政", path: "sourceConfig.治安／警政" }),
      expect.objectContaining({ code: "invalid-domain-tag", source: "invalid-tag", reason: expect.stringContaining("不存在領域") }),
      expect.objectContaining({ code: "source-unclassified", source: "unclassified", reason: expect.stringContaining("沒有領域標籤") }),
    ]));
  });

  it("拒絕已知來源的無效標籤與未知官方來源未歸類", () => {
    const report = buildDomainCoverage({
      sources: [
        { scope: "domestic", type: "gov-open-data", datasetId: "taipower-supply-demand", category: "錯誤標籤", name: "台電" },
        { scope: "domestic", type: "gov-open-data", datasetId: "unknown-dataset", category: "未知標籤", name: "未知來源" },
      ],
    });

    expect(report.validation.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid-source-tag", source: "taipower-supply-demand" }),
      expect.objectContaining({ code: "source-unclassified", source: "unknown-dataset" }),
    ]));
  });

  it("區分已整合、參考層、僅查詢與缺口", () => {
    const report = buildDomainCoverage({
      generatedAt: "2026-07-25T00:00:00.000Z",
      sources: [
        { scope: "domestic", category: "農業", datasetId: "70930", name: "農產品", stale: false, lastSuccessAt: "2026-07-25T00:00:00.000Z" },
        { scope: "domestic", category: "衛生", datasetId: "39331", name: "健保院所", stale: false, lastSuccessAt: "2026-07-25T00:00:00.000Z" },
        { scope: "domestic", category: "國會", datasetId: "ly-bills", name: "立法院議案", stale: false, lastSuccessAt: "2026-07-25T00:00:00.000Z" },
        { scope: "domestic", category: "觀光", datasetId: "tad-index-inbound-lastmonth", name: "觀光統計", stale: false, lastSuccessAt: "2026-07-25T00:00:00.000Z" },
        { scope: "domestic", category: "社福", datasetId: "84049", name: "人口結構", stale: false, lastSuccessAt: "2026-07-25T00:00:00.000Z" },
        { scope: "domestic", category: "教育", datasetId: "124173", name: "教育概況", stale: false, lastSuccessAt: "2026-07-25T00:00:00.000Z" },
        { scope: "domestic", category: "金融", datasetId: "11598", name: "期貨三大法人", stale: false, lastSuccessAt: "2026-07-25T00:00:00.000Z" },
        { scope: "domestic", category: "勞動", datasetId: "123349", name: "失業率統計", stale: false, lastSuccessAt: "2026-07-25T00:00:00.000Z" },
      ],
    });

    expect(report.counts).toMatchObject({ integrated: 8, reference: 9, "query-only": 2, gap: 3 });
    expect(report.rows.find((row) => row.key === "農業")).toMatchObject({
      status: "reference",
      sourceCount: 1,
      healthySourceCount: 1,
    });
    expect(report.rows.find((row) => row.key === "勞動／職災")).toMatchObject({ status: "reference", sourceCount: 1, healthySourceCount: 1 });
    expect(report.rows.find((row) => row.key === "司法／法務")).toMatchObject({ status: "gap", sourceCount: 0, healthySourceCount: 0 });
    expect(report.rows.find((row) => row.key === "國會／立法")).toMatchObject({ status: "reference", sourceCount: 1, healthySourceCount: 1 });
    expect(report.rows.find((row) => row.key === "教育／科研")).toMatchObject({ status: "reference", sourceCount: 1, healthySourceCount: 1 });
    expect(report.rows.find((row) => row.key === "金融市場")).toMatchObject({ status: "reference", sourceCount: 1, healthySourceCount: 1 });
  });

});
