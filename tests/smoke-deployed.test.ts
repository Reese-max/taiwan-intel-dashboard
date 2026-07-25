import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { requiredDatasetsFromArgs, validateDeploymentPayload } from "../scripts/smoke-deployed.mjs";

const domains = [
  { key: "金融市場", status: "reference" },
  { key: "勞動／職災", status: "reference" },
  { key: "電信／網路服務", status: "gap" },
];

describe("部署後線上 smoke", () => {
  it("只對 refresh 來源要求金融與勞動資料落地", () => {
    expect(requiredDatasetsFromArgs("--sources=cwa,financeDerivatives,laborStats --exclusive")).toEqual(["11598", "123349"]);
    expect(requiredDatasetsFromArgs("--sources=cwa,police,rss")).toEqual([]);
  });

  it("驗證 provenance 與領域狀態，並拒絕指定來源缺失", () => {
    const base = {
      generatedAt: "2026-07-25T12:00:00.000Z",
      sources: [
        { datasetId: "11598", count: 1, stale: false },
        { datasetId: "123349", count: 1, stale: false },
      ],
    };
    const result = validateDeploymentPayload({
      provenance: base,
      domainCoverage: { generatedAt: base.generatedAt, rows: domains },
      requiredDatasetIds: ["11598", "123349"],
    });
    expect(result).toMatchObject({ ok: true, sourceCount: 2, domainCount: 3 });

    const missing = validateDeploymentPayload({
      provenance: { ...base, sources: [] },
      domainCoverage: { generatedAt: base.generatedAt, rows: domains },
      requiredDatasetIds: ["11598"],
    });
    expect(missing.ok).toBe(false);
    expect(missing.errors).toContain("provenance.sources 為空");
    expect(missing.errors).toContain("指定來源未落地：datasetId=11598");
  });
});
