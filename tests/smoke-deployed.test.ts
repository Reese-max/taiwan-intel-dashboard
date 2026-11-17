import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error — JS ESM module without types
import { smokeDeployed, validateDeploymentPayload, validateRemovedRouteResponse, validateSearchResponse } from "../scripts/smoke-deployed.mjs";

afterEach(() => vi.unstubAllGlobals());

const domains = [
  { key: "金融市場", status: "reference" },
  { key: "勞動／職災", status: "reference" },
  { key: "電信／網路服務", status: "gap" },
];

describe("部署後線上 smoke", () => {
  it("搜尋回應允許空結果與上游失敗，但要求 200 與有效結構", () => {
    expect(validateSearchResponse(200, { items: [], upstream: "ok" })).toBe(true);
    expect(validateSearchResponse(200, { items: [], upstream: "error" })).toBe(true);
    expect(validateSearchResponse(201, { items: [], upstream: "ok" })).toBe(false);
    expect(validateSearchResponse(200, { items: [] })).toBe(false);
    expect(validateSearchResponse(200, { items: {}, upstream: "ok" })).toBe(false);
  });

  it("部署檢查同時涵蓋搜尋端點與兩條已移除路由", async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (["/api/health", "/query.html"].includes(url.pathname)) return new Response("找不到頁面", { status: 404 });
      if (url.pathname === "/api/search") return Response.json({ items: [], upstream: "error" });
      if (url.pathname.endsWith("provenance.json")) return Response.json({ generatedAt: "2026-11-17T00:00:00Z", sources: [{ count: 1 }] });
      return Response.json({ generatedAt: "2026-11-17T00:00:00Z", rows: domains });
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await smokeDeployed({ baseUrl: "https://site.test", runId: "test" })).toMatchObject({ ok: true, removedRouteCount: 2, searchOk: true });
    expect(fetcher).toHaveBeenCalledWith("https://site.test/api/search?q=%E9%9B%BB%E4%BF%A1&days=7", expect.anything());
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it("只接受已移除舊路由的 404", () => {
    expect(validateRemovedRouteResponse(404)).toBe(true);
    expect(validateRemovedRouteResponse(200)).toBe(false);
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
