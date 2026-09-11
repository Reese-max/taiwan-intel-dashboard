import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const run = (dataDir: string) => {
  try {
    const out = execFileSync(process.execPath, ["scripts/audit-summary.mjs", `--data-dir=${dataDir}`], { encoding: "utf8" });
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
};

const fixture = (files: Record<string, unknown>) => {
  const dir = mkdtempSync(join(tmpdir(), "audsum-"));
  for (const [name, body] of Object.entries(files))
    writeFileSync(join(dir, name), JSON.stringify(body));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};

const summaryOk = { domestic: "國內情勢摘要", international: "國際情勢摘要", generatedAt: "2026-09-11T00:00:00Z" };
const event = (id: string) => ({ id, title: "t", timestamp: "2026-09-11T00:00:00Z" });

describe("audit-summary semantic gate", () => {
  it("passes when briefs have content and events exist", () => {
    const f = fixture({ "summary.json": summaryOk, "domestic.json": [event("a")], "international.json": [event("b")] });
    const r = run(f.dir); f.cleanup();
    expect(r.code).toBe(0);
  });

  it("fails closed when events exist but domestic brief is placeholder", () => {
    const f = fixture({
      "summary.json": { ...summaryOk, domestic: "（暫無資料）" },
      "domestic.json": [event("a")],
      "international.json": [],
    });
    const r = run(f.dir); f.cleanup();
    expect(r.code).toBe(1);
    expect(r.out).toContain("SUMMARY_AUDIT_FAIL");
  });

  it("fails closed when events exist but international brief is placeholder", () => {
    const f = fixture({
      "summary.json": { ...summaryOk, international: "（暫無資料）" },
      "domestic.json": [],
      "international.json": [event("b"), event("c")],
    });
    const r = run(f.dir); f.cleanup();
    expect(r.code).toBe(1);
  });

  it("passes when there is genuinely no event data", () => {
    const f = fixture({
      "summary.json": { domestic: "（暫無資料）", international: "（暫無資料）" },
      "domestic.json": [],
      "international.json": [],
    });
    const r = run(f.dir); f.cleanup();
    expect(r.code).toBe(0);
  });

  it("fails when summary.json is missing entirely", () => {
    const f = fixture({ "domestic.json": [event("a")] });
    const r = run(f.dir); f.cleanup();
    expect(r.code).toBe(1);
  });
});
