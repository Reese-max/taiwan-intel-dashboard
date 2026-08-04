import { describe, expect, it } from "vitest";
import { buildDomainCoverage } from "../scripts/domain-coverage.mjs";

const DOMAIN = "能源／電力";

describe("重要領域來源覆蓋反例", () => {
  it("設定存在但未掛接執行管線時拒絕計入覆蓋量", () => {
    const report = buildDomainCoverage({
      sourceConfig: [{
        sourceId: "configured-only",
        sourceKey: "not-attached",
        domain: DOMAIN,
        publisherName: "台灣電力公司",
        publisherUrl: "https://example.test/power",
      }],
      enabledSourceKeys: [],
    });

    expect(report.rows.find((row) => row.key === DOMAIN)).toMatchObject({
      configuredSourceCount: 1,
      enabledSourceCount: 0,
      coverageCount: 0,
      enabledSources: [],
    });
  });

  it("端點或發布機構缺失時拒絕計入覆蓋量", () => {
    const report = buildDomainCoverage({
      sourceConfig: [
        {
          sourceId: "missing-endpoint",
          sourceKey: "missing-endpoint",
          domain: DOMAIN,
          publisherName: "台灣電力公司",
        },
        {
          sourceId: "missing-publisher",
          sourceKey: "missing-publisher",
          domain: DOMAIN,
          publisherUrl: "https://example.test/power",
        },
      ],
      enabledSourceKeys: ["missing-endpoint", "missing-publisher"],
    });

    expect(report.rows.find((row) => row.key === DOMAIN)).toMatchObject({
      configuredSourceCount: 2,
      enabledSourceCount: 0,
      coverageCount: 0,
      enabledSources: [],
    });
    expect(report.validation.failures.filter((failure) => failure.code === "source-config-invalid")).toHaveLength(2);
  });

  it("同領域重複來源識別不重複計入覆蓋量", () => {
    const report = buildDomainCoverage({
      sourceConfig: [
        {
          sourceId: "same-source",
          sourceKey: "power-a",
          domain: DOMAIN,
          publisherName: "台灣電力公司",
          publisherUrl: "https://example.test/power-a",
        },
        {
          sourceId: "same-source",
          sourceKey: "power-b",
          domain: DOMAIN,
          publisherName: "台灣電力公司",
          publisherUrl: "https://example.test/power-b",
        },
      ],
      enabledSourceKeys: ["power-a", "power-b"],
    });

    expect(report.rows.find((row) => row.key === DOMAIN)).toMatchObject({
      configuredSourceCount: 2,
      enabledSourceCount: 1,
      coverageCount: 1,
    });
    expect(report.validation.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "duplicate-source", domain: DOMAIN, source: "same-source" }),
    ]));
  });
});
