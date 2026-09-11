import { describe, expect, it } from "vitest";
import { checkOperatingState } from "../scripts/check-operating-state.mjs";

const SCHEDULED_WORKFLOW = { name: "update.yml", text: "on:\n  schedule:\n    - cron: '5 * * * *'\n" };
const ACTIVE_README = "狀態：**運作中**";
const PAUSED_README = "狀態：**已暫停**（HTTP 503）";

const activeContract = {
  state: "ACTIVE",
  restoreReceipt: "docs/operations/reports/recovery-prerequisites/recovery-prerequisites-2026-08-27T13-29-47-730Z.json",
};

describe("operating-state contract", () => {
  it("accepts ACTIVE with schedules, matching README, and a passing receipt", () => {
    const result = checkOperatingState({
      contract: activeContract,
      readme: ACTIVE_README,
      workflowTexts: [SCHEDULED_WORKFLOW],
      restoreReport: { ok: true },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects PAUSED while a workflow still has a schedule trigger", () => {
    const result = checkOperatingState({
      contract: { state: "PAUSED" },
      readme: PAUSED_README,
      workflowTexts: [SCHEDULED_WORKFLOW],
    });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("schedule");
  });

  it("rejects ACTIVE with a stale paused README", () => {
    const result = checkOperatingState({
      contract: activeContract,
      readme: PAUSED_README,
      workflowTexts: [SCHEDULED_WORKFLOW],
      restoreReport: { ok: true },
    });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("README");
  });

  it("rejects ACTIVE without a passing restore receipt", () => {
    expect(
      checkOperatingState({
        contract: { ...activeContract, restoreReceipt: "missing.json" },
        readme: ACTIVE_README,
        workflowTexts: [SCHEDULED_WORKFLOW],
      }).ok,
    ).toBe(false);
    expect(
      checkOperatingState({
        contract: activeContract,
        readme: ACTIVE_README,
        workflowTexts: [SCHEDULED_WORKFLOW],
        restoreReport: { ok: false },
      }).ok,
    ).toBe(false);
  });

  it("rejects invalid state values", () => {
    expect(
      checkOperatingState({ contract: { state: "SOMEWHAT" }, readme: "", workflowTexts: [] }).ok,
    ).toBe(false);
  });

  it("accepts a consistent PAUSED declaration", () => {
    const result = checkOperatingState({
      contract: { state: "PAUSED" },
      readme: PAUSED_README,
      workflowTexts: [{ name: "pr.yml", text: "on:\n  pull_request:\n" }],
    });
    expect(result.ok).toBe(true);
  });
});
