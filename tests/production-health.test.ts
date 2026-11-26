import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { evaluateProductionHealth } from "../scripts/production-health.mjs";

const NOW = Date.parse("2026-11-26T03:00:00.000Z");
const provenance = (over: Record<string, unknown> = {}) => ({
  generatedAt: "2026-11-26T02:40:00.000Z",
  pipeline: { twnews: { llmGate: { failedBatches: 0, skippedBatches: 0 } } },
  sources: [{ datasetId: "tfda-noncompliant-food", lastAttemptAt: "2026-11-25T18:40:00.000Z" }],
  ...over,
});
const healthy = { provenance: provenance(), searchUpstreams: ["ok", "ok"], relayStatus: 401, now: NOW };

describe("production health", () => {
  it("正常狀態沒有失敗與警告", () => {
    expect(evaluateProductionHealth(healthy)).toEqual({ ok: true, failures: [], warnings: [] });
  });

  it("資料超過 120 分鐘沒更新算失敗", () => {
    const r = evaluateProductionHealth({ ...healthy, provenance: provenance({ generatedAt: "2026-11-26T00:50:00.000Z" }) });
    expect(r.ok).toBe(false);
    expect(r.failures.join()).toMatch(/130 分鐘/);
  });

  it("補跑在時窗尾端才跑完（約 32 小時）不誤報", () => {
    // 前一天 12:32Z 手動 daily、當晚 cron 被丟，次晚補跑 20:30Z 派出、21:00Z 前跑完 → 檢查時約 32 小時
    const late = provenance({ sources: [{ datasetId: "tfda-noncompliant-food", lastAttemptAt: "2026-11-24T19:00:00.000Z" }] });
    expect(evaluateProductionHealth({ ...healthy, provenance: late }).ok).toBe(true);
  });

  it("每日來源超過 34 小時沒嘗試算失敗（cron 與補跑都沒發生）", () => {
    const stale = provenance({ sources: [{ datasetId: "tfda-noncompliant-food", lastAttemptAt: "2026-11-24T20:00:00.000Z" }] });
    const r = evaluateProductionHealth({ ...healthy, provenance: stale });
    expect(r.ok).toBe(false);
    expect(r.failures.join()).toMatch(/每日重建/);
    expect(evaluateProductionHealth({ ...healthy, provenance: provenance({ sources: [] }) }).failures.join()).toMatch(/每日重建/);
  });

  it("站外搜尋兩次都不是 ok 才算失敗，一次失敗只是警告", () => {
    expect(evaluateProductionHealth({ ...healthy, searchUpstreams: ["error", "error"] }).ok).toBe(false);
    const once = evaluateProductionHealth({ ...healthy, searchUpstreams: ["error", "ok"] });
    expect(once.ok).toBe(true);
    expect(once.warnings.join()).toMatch(/站外搜尋/);
  });

  it("轉發服務不帶密鑰卻沒回 401 算失敗", () => {
    expect(evaluateProductionHealth({ ...healthy, relayStatus: 200 }).failures.join()).toMatch(/401/);
    expect(evaluateProductionHealth({ ...healthy, relayStatus: 0 }).ok).toBe(false);
  });

  it("LLM 複核失敗或跳過批次只列警告", () => {
    const r = evaluateProductionHealth({
      ...healthy,
      provenance: provenance({ pipeline: { twnews: { llmGate: { failedBatches: 1, skippedBatches: 2 } } } }),
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toMatch(/LLM 複核/);
  });
});
