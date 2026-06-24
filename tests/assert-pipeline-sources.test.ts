import { describe, expect, it } from "vitest";
import { assertRequiredPipelineSources } from "../scripts/assert-pipeline-sources.mjs";

describe("assertRequiredPipelineSources", () => {
  it("accepts required sources that are ok, including zero weather warnings", () => {
    expect(() =>
      assertRequiredPipelineSources(
        {
          cwa: { ok: true, count: 10 },
          cwaWarnings: { ok: true, count: 0 },
          international: { ok: true, count: 8 },
        },
        ["cwa", "cwaWarnings", "international"],
      ),
    ).not.toThrow();
  });

  it("rejects skipped sources", () => {
    expect(() =>
      assertRequiredPipelineSources(
        {
          cwa: { skipped: true },
          cwaWarnings: { ok: true, count: 0 },
          international: { ok: true, count: 8 },
        },
        ["cwa", "cwaWarnings", "international"],
      ),
    ).toThrow("Required pipeline source cwa was skipped");
  });

  it("rejects failed sources with the upstream error", () => {
    expect(() =>
      assertRequiredPipelineSources(
        {
          cwa: { ok: true, count: 10 },
          cwaWarnings: { ok: true, count: 0 },
          international: { ok: false, error: "缺少 API key" },
        },
        ["cwa", "cwaWarnings", "international"],
      ),
    ).toThrow("Required pipeline source international failed: 缺少 API key");
  });

  it("allows stale CWA sources when ALLOW_STALE_CWA is enabled", () => {
    expect(() =>
      assertRequiredPipelineSources(
        {
          cwa: { ok: false, error: "暫時性 API 連線失敗" },
          cwaWarnings: { ok: false, error: "暫時性 API 連線失敗" },
          international: { ok: true, count: 8 },
        },
        ["cwa", "cwaWarnings", "international"],
        { allowStaleCwa: true },
      ),
    ).not.toThrow();
  });

  it("still rejects CWA warnings when allowStaleCwa is off", () => {
    expect(() =>
      assertRequiredPipelineSources(
        {
          cwa: { ok: false, error: "暫時性 API 連線失敗" },
          cwaWarnings: { ok: true, count: 0 },
          international: { ok: true, count: 8 },
        },
        ["cwa", "cwaWarnings", "international"],
        { allowStaleCwa: false },
      ),
    ).toThrow("Required pipeline source cwa failed: 暫時性 API 連線失敗");
  });
});
