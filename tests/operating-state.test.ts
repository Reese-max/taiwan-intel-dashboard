import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = "scripts/operating-state.mjs";
const run = (args: string[]) => {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
    return { code: 0, out: stdout, err: "" };
  } catch (e: any) {
    return { code: e.status ?? 1, out: e.stdout ?? "", err: e.stderr ?? "" };
  }
};

const contract = (state: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  schemaVersion: 1,
  state,
  effectiveAt: "2026-09-11T00:00:00Z",
  owner: "test",
  reason: "fixture",
  evidence: { restoreReceipt: null, ...extra },
});

const withFixture = (body: string) => {
  const dir = mkdtempSync(join(tmpdir(), "opstate-"));
  const p = join(dir, "state.json");
  writeFileSync(p, body);
  return { dir, p, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};

const readmeFor = (marker: string) => {
  const dir = mkdtempSync(join(tmpdir(), "opstate-readme-"));
  const p = join(dir, "README.md");
  writeFileSync(p, `# x\n\n- 狀態：**${marker}**（依 ops/operating-state.json）\n`);
  return { p, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};

describe("operating-state contract gate", () => {
  it("rejects malformed contract", () => {
    const f = withFixture('{"state":"SLEEPY"}');
    const r = run(["validate", "--state", f.p]);
    f.cleanup();
    expect(r.code).not.toBe(0);
  });

  it("PAUSED blocks mutation and emits a receipt", () => {
    const f = withFixture(contract("PAUSED"));
    const r = run(["guard-schedule", "--state", f.p, "--purpose", "mutation"]);
    f.cleanup();
    expect(r.code).toBe(78);
    expect(r.out).toContain("OPERATING_STATE_RECEIPT");
    expect(JSON.parse(r.out.split("OPERATING_STATE_RECEIPT ")[1].trim()).skipped).toBe(true);
  });

  it("PAUSED also blocks the validation path", () => {
    const f = withFixture(contract("PAUSED"));
    const r = run(["guard-schedule", "--state", f.p, "--purpose", "validation"]);
    f.cleanup();
    expect(r.code).toBe(78);
  });

  it("RESTORING allows only controlled validation", () => {
    const f = withFixture(contract("RESTORING"));
    const mutation = run(["guard-schedule", "--state", f.p, "--purpose", "mutation"]);
    const validation = run(["guard-schedule", "--state", f.p, "--purpose", "validation"]);
    f.cleanup();
    expect(mutation.code).toBe(78);
    expect(validation.code).toBe(0);
  });

  it("DEGRADED allows mutation but stays flagged", () => {
    const f = withFixture(contract("DEGRADED"));
    const r = run(["guard-schedule", "--state", f.p, "--purpose", "mutation"]);
    f.cleanup();
    expect(r.code).toBe(0);
    expect(r.out).toContain("state=DEGRADED");
  });

  it("ACTIVE without a restore receipt fails closed", () => {
    const f = withFixture(contract("ACTIVE"));
    const r = run(["validate", "--state", f.p]);
    f.cleanup();
    expect(r.code).not.toBe(0);
  });

  it("README must agree with the contract", () => {
    const st = withFixture(contract("DEGRADED"));
    const ok = readmeFor("降級運作中");
    const bad = readmeFor("已暫停");
    const good = run(["verify-docs", "--state", st.p, "--readme", ok.p]);
    const badr = run(["verify-docs", "--state", st.p, "--readme", bad.p]);
    st.cleanup(); ok.cleanup(); bad.cleanup();
    expect(good.code).toBe(0);
    expect(badr.code).toBe(1);
  });
});
