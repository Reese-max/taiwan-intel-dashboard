import { describe, expect, it } from "vitest";
import { buildDomainCoverage } from "../scripts/domain-coverage.mjs";

describe("領域完整性清單", () => {
  it("區分已整合、參考層、僅查詢與缺口", () => {
    const report = buildDomainCoverage({
      generatedAt: "2026-07-25T00:00:00.000Z",
      sources: [
        { scope: "domestic", category: "農業", datasetId: "70930", name: "農產品", stale: false, lastSuccessAt: "2026-07-25T00:00:00.000Z" },
        { scope: "domestic", category: "衛生", datasetId: "39331", name: "健保院所", stale: false, lastSuccessAt: "2026-07-25T00:00:00.000Z" },
        { scope: "domestic", category: "司法判決", datasetId: "judicial", name: "司法院裁判書", stale: false, lastSuccessAt: "2026-07-25T00:00:00.000Z" },
        { scope: "domestic", category: "國會", datasetId: "ly-bills", name: "立法院議案", stale: false, lastSuccessAt: "2026-07-25T00:00:00.000Z" },
        { scope: "domestic", category: "觀光", datasetId: "tad-index-inbound-lastmonth", name: "觀光統計", stale: false, lastSuccessAt: "2026-07-25T00:00:00.000Z" },
        { scope: "domestic", category: "社福", datasetId: "84049", name: "人口結構", stale: false, lastSuccessAt: "2026-07-25T00:00:00.000Z" },
        { scope: "domestic", category: "教育", datasetId: "124173", name: "教育概況", stale: false, lastSuccessAt: "2026-07-25T00:00:00.000Z" },
      ],
    });

    expect(report.counts).toMatchObject({ integrated: 10, reference: 7, "query-only": 4, gap: 1 });
    expect(report.rows.find((row) => row.key === "農業")).toMatchObject({
      status: "reference",
      sourceCount: 1,
      healthySourceCount: 1,
    });
    expect(report.rows.find((row) => row.key === "勞動／職災")).toMatchObject({ status: "query-only", sourceCount: 0 });
    expect(report.rows.find((row) => row.key === "司法／法務")).toMatchObject({ status: "integrated", sourceCount: 1, healthySourceCount: 1 });
    expect(report.rows.find((row) => row.key === "國會／立法")).toMatchObject({ status: "reference", sourceCount: 1, healthySourceCount: 1 });
    expect(report.rows.find((row) => row.key === "教育／科研")).toMatchObject({ status: "reference", sourceCount: 1, healthySourceCount: 1 });
  });
});
