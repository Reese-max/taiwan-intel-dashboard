import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertInternationalFeedCoverage,
  assertRequiredPipelineSources,
  warnOnGnSystemicFailure,
  warnOnNormalizeFailure,
} from "../scripts/assert-pipeline-sources.mjs";

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

  it("rejects an MCP auth failure hidden under an otherwise-ok police source", () => {
    expect(() =>
      assertRequiredPipelineSources(
        {
          police: {
            ok: true,
            count: 8,
            crimeWeekly: { ok: true, count: 8 },
            traffic: { ok: false, error: "MCP tools/call HTTP 401: Unauthorized" },
          },
        },
        ["police"],
      ),
    ).toThrow("Required pipeline source police has an authentication failure at traffic");
  });

  it("does not mistake an optional RSS HTTP 403 for an MCP credential failure", () => {
    expect(() =>
      assertRequiredPipelineSources(
        {
          international: {
            ok: true,
            count: 20,
            feeds: [{ ok: false, error: "RSS HTTP 403" }, { ok: true, count: 20 }],
          },
        },
        ["international"],
      ),
    ).not.toThrow();
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

describe("assertInternationalFeedCoverage", () => {
  it("accepts international status with enough live feeds and raw items", () => {
    expect(() =>
      assertInternationalFeedCoverage(
        { ok: true, count: 20, okFeeds: 15, rawCount: 120 },
        { minFeeds: 10, minRawItems: 50 },
      ),
    ).not.toThrow();
  });

  it("rejects international status with too few live feeds", () => {
    expect(() =>
      assertInternationalFeedCoverage(
        { ok: true, count: 20, okFeeds: 4, rawCount: 120 },
        { minFeeds: 10, minRawItems: 50 },
      ),
    ).toThrow("International feed coverage too low: 4/10 live feeds");
  });

  it("rejects international status with too few raw items", () => {
    expect(() =>
      assertInternationalFeedCoverage(
        { ok: true, count: 3, okFeeds: 15, rawCount: 12 },
        { minFeeds: 10, minRawItems: 50 },
      ),
    ).toThrow("International raw item count too low: 12/50");
  });
});

describe("warnOnNormalizeFailure", () => {
  afterEach(() => vi.restoreAllMocks());

  it("warns and reports the scope when domestic LLM normalize fails wholesale", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failed = warnOnNormalizeFailure({ twnews: { ok: true, normalizeFailed: true } });
    expect(failed).toEqual(["twnews"]);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("twnews 正規化全批失敗"))).toBe(true);
  });

  it("reports both scopes when international and domestic both fail", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failed = warnOnNormalizeFailure({
      international: { ok: true, normalizeFailed: true },
      twnews: { ok: true, normalizeFailed: true },
    });
    expect(failed).toEqual(["international", "twnews"]);
  });

  it("stays silent when no normalize failure flag is set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failed = warnOnNormalizeFailure({ twnews: { ok: true }, international: { ok: true } });
    expect(failed).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});


describe("warnOnGnSystemicFailure", () => {
  afterEach(() => vi.restoreAllMocks());

  it("warns when twnews gnHealth reports systemic failure", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const warned = warnOnGnSystemicFailure({
      twnews: { gnHealth: { gnFeeds: 10, gnOk: 4, okRate: 0.4, systemic: true } },
    });

    expect(warned).toBe(true);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("Google News 系統性異常"))).toBe(true);
  });

  it("stays silent when gnHealth is healthy", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const warned = warnOnGnSystemicFailure({
      twnews: { gnHealth: { gnFeeds: 10, gnOk: 10, okRate: 1, systemic: false } },
    });

    expect(warned).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent when gnHealth is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const warned = warnOnGnSystemicFailure({ twnews: { ok: true } });

    expect(warned).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});
