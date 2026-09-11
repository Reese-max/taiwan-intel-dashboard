import { describe, expect, it } from "vitest";
import {
  auditSummary,
  deterministicBrief,
  isPlaceholder,
  SUMMARY_PLACEHOLDER,
} from "../scripts/lib/summary-quality.mjs";

describe("summary quality gate", () => {
  it("flags placeholder briefs when evidence exists", () => {
    const result = auditSummary({
      summary: { domestic: SUMMARY_PLACEHOLDER, international: "正常摘要" },
      domesticCount: 1200,
      internationalCount: 40,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].field).toBe("domestic");
  });

  it("fails when both primary briefs are empty despite evidence", () => {
    const result = auditSummary({
      summary: { domestic: "", international: SUMMARY_PLACEHOLDER },
      domesticCount: 5,
      internationalCount: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.field)).toEqual(["domestic"]);
  });

  it("passes placeholders when there is truly no evidence", () => {
    const result = auditSummary({
      summary: { domestic: SUMMARY_PLACEHOLDER, international: SUMMARY_PLACEHOLDER },
      domesticCount: 0,
      internationalCount: 0,
    });
    expect(result.ok).toBe(true);
  });

  it("fails a missing summary only when evidence exists", () => {
    expect(auditSummary({ summary: null, domesticCount: 10 }).ok).toBe(false);
    expect(auditSummary({ summary: null, domesticCount: 0, internationalCount: 0 }).ok).toBe(true);
  });

  it("warns on degraded summaries and evidence-less briefs", () => {
    const result = auditSummary({
      summary: { domestic: "內容", international: "內容", degraded: true },
      domesticCount: 3,
      internationalCount: 0,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("summary-degraded");
    expect(result.warnings.map((w) => w.code)).toContain("brief-without-evidence");
  });

  it("deterministic fallback reports counts, not a fake no-data claim", () => {
    const events = [
      { category: "治安" }, { category: "治安" }, { category: "災害" },
    ];
    const text = deterministicBrief("國內事件", events);
    expect(text).toContain("3 起");
    expect(text).toContain("治安 2 起");
    expect(text).not.toContain(SUMMARY_PLACEHOLDER);
    expect(deterministicBrief("國內事件", [])).toBe(SUMMARY_PLACEHOLDER);
  });

  it("isPlaceholder treats empty and placeholder strings alike", () => {
    expect(isPlaceholder("")).toBe(true);
    expect(isPlaceholder(` ${SUMMARY_PLACEHOLDER} `)).toBe(true);
    expect(isPlaceholder("有內容")).toBe(false);
  });
});
