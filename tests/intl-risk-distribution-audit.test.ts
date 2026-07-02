import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { auditRiskDistribution } from "../scripts/audit-intl-risk-distribution.mjs";

const make = (spec: Record<string, number>) => {
  const out: { riskLevel: string }[] = [];
  for (const [risk, count] of Object.entries(spec)) for (let i = 0; i < count; i++) out.push({ riskLevel: risk });
  return out;
};

describe("auditRiskDistribution (病態偵測)", () => {
  it("洗版分布（high 90%）→ 病態", () => {
    const r = auditRiskDistribution(make({ high: 90, critical: 6, medium: 4 }));
    expect(r.ok).toBe(false);
    expect(r.warnings.some((w: string) => w.includes("high"))).toBe(true);
  });

  it("健康分布 → ok", () => {
    const r = auditRiskDistribution(make({ critical: 8, high: 25, medium: 45, low: 22 }));
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });

  it("low=0 且樣本足夠 → 病態（低風險被洗光）", () => {
    const r = auditRiskDistribution(make({ critical: 5, high: 20, medium: 25 }));
    expect(r.ok).toBe(false);
    expect(r.warnings.some((w: string) => w.includes("low = 0"))).toBe(true);
  });

  it("low=0 但樣本過小（<20）→ 不誤報", () => {
    const r = auditRiskDistribution(make({ high: 5, medium: 5 }));
    expect(r.warnings.some((w: string) => w.includes("low = 0"))).toBe(false);
  });

  it("medium 崩塌（<15%）→ 病態", () => {
    const r = auditRiskDistribution(make({ critical: 5, high: 30, medium: 5, low: 60 }));
    expect(r.ok).toBe(false);
    expect(r.warnings.some((w: string) => w.includes("medium"))).toBe(true);
  });

  it("空陣列 → ok（無事件可稽核）", () => {
    expect(auditRiskDistribution([]).ok).toBe(true);
  });
});
