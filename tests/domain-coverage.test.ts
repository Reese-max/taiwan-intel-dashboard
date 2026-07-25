import { describe, expect, it } from "vitest";
import { buildDomainCoverage } from "../scripts/domain-coverage.mjs";

describe("領域完整性清單", () => {
  it("區分已整合、參考層、僅查詢與缺口", () => {
    const report = buildDomainCoverage({
      generatedAt: "2026-07-25T00:00:00.000Z",
      sources: [
        { scope: "domestic", category: "農業", datasetId: "70930", name: "農產品", stale: false, lastSuccessAt: "2026-07-25T00:00:00.000Z" },
        { scope: "domestic", category: "衛生", datasetId: "39331", name: "健保院所", stale: false, lastSuccessAt: "2026-07-25T00:00:00.000Z" },
      ],
    });

    expect(report.counts).toMatchObject({ integrated: 10, reference: 2, "query-only": 4, gap: 4 });
    expect(report.rows.find((row) => row.key === "農業")).toMatchObject({
      status: "reference",
      sourceCount: 1,
      healthySourceCount: 1,
    });
    expect(report.rows.find((row) => row.key === "勞動／職災")).toMatchObject({ status: "query-only", sourceCount: 0 });
  });
});
