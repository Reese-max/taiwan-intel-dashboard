import { describe, expect, it } from "vitest";
import { resolveFetchMode } from "../scripts/ci-fetch-mode.mjs";

describe("resolveFetchMode", () => {
  it("maps hourly cron to CWA + police + missing + Taiwan news + international RSS", () => {
    const mode = resolveFetchMode({ schedule: "5 * * * *" });
    expect(mode.label).toBe("hourly");
    expect(mode.args).toBe("--sources=cwa,police,missing,twnews,rss");
  });

  it("maps daily refresh cron to full exclusive refresh including CWA and international RSS", () => {
    const mode = resolveFetchMode({ schedule: "30 18 * * *" });
    expect(mode.label).toBe("refresh");
    expect(mode.args).toBe("--sources=cwa,pcc,police,missing,twnews,rss,judicial --exclusive");
  });

  it("accepts explicit daily mode alias", () => {
    const mode = resolveFetchMode({ mode: "daily" });
    expect(mode.label).toBe("refresh");
    expect(mode.args).toContain("judicial");
    expect(mode.args).toContain("--exclusive");
  });

  it("keeps legacy manual police mode as hourly-compatible mode", () => {
    const mode = resolveFetchMode({ mode: "police" });
    expect(mode.label).toBe("hourly");
    expect(mode.args).toContain("cwa");
    expect(mode.args).toContain("rss");
  });

  it("accepts uppercase mode and preserves hourly behavior", () => {
    const mode = resolveFetchMode({ mode: "POLICE" });
    expect(mode.label).toBe("hourly");
    expect(mode.args).toContain("cwa");
  });

  it("maps manual refresh to full exclusive refresh", () => {
    const mode = resolveFetchMode({ mode: "refresh" });
    expect(mode.label).toBe("refresh");
    expect(mode.args).toContain("cwa");
    expect(mode.args).toContain("rss");
    expect(mode.args).toContain("--exclusive");
  });

  it("defaults to hourly mode when mode is empty and schedule is hourly", () => {
    const mode = resolveFetchMode({ mode: "", schedule: "5 * * * *" });
    expect(mode.label).toBe("hourly");
    expect(mode.args).toBe("--sources=cwa,police,missing,twnews,rss");
  });

  it("defaults to hourly mode when only schedule is missing", () => {
    const mode = resolveFetchMode({});
    expect(mode.label).toBe("hourly");
    expect(mode.args).toContain("cwa");
  });

  it("defaults unknown modes to hourly for backward-compatible safety", () => {
    const mode = resolveFetchMode({ mode: "legacy-only" });
    expect(mode.label).toBe("hourly");
  });

  it("prefers manual daily override when both schedule and mode are provided", () => {
    const mode = resolveFetchMode({ schedule: "5 * * * *", mode: "daily" });
    expect(mode.label).toBe("refresh");
    expect(mode.args).toContain("judicial");
    expect(mode.args).toContain("--exclusive");
  });
});
