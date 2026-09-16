import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadContract,
  scheduleDecision,
  validateReceipt,
  verifyDocs,
  README_MARKERS,
  EXPECTED_REPO,
} from "../scripts/operating-state.mjs";

const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "opstate-"));
  mkdirSync(join(dir, "ops"), { recursive: true });
  mkdirSync(join(dir, "docs", "operations", "receipts"), { recursive: true });
  mkdirSync(join(dir, "docs", "operations", "reports"), { recursive: true });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};

const validContractBase = {
  schemaVersion: 1,
  state: "DEGRADED",
  effectiveAt: "2026-09-16T10:00:00Z",
  owner: "Reese-max",
  reason: "測試營運契約",
};

describe("operating-state contract & gates (Issue #17)", () => {
  it("驗證目前專案契約檔 ops/operating-state.json 結構合法且與 README 一致", () => {
    const { doc, errors } = loadContract();
    expect(errors).toHaveLength(0);
    expect(doc?.state).toBe("DEGRADED");

    const docErrors = verifyDocs();
    expect(docErrors).toHaveLength(0);
  });

  it("基本欄位校驗：拒絕無效 schemaVersion、非法 state、缺失 owner 或 reason", () => {
    const f = fixture();
    const stateFile = join(f.dir, "ops", "operating-state.json");

    // 非法 state
    writeFileSync(stateFile, JSON.stringify({ ...validContractBase, state: "UNKNOWN" }));
    expect(loadContract(stateFile, f.dir).errors[0]).toContain("state must be one of");

    // 缺少 owner
    writeFileSync(stateFile, JSON.stringify({ ...validContractBase, owner: "" }));
    expect(loadContract(stateFile, f.dir).errors[0]).toContain("owner is required");

    // 缺少 reason
    writeFileSync(stateFile, JSON.stringify({ ...validContractBase, reason: "  " }));
    expect(loadContract(stateFile, f.dir).errors[0]).toContain("reason is required");

    f.cleanup();
  });

  describe("ACTIVE 收據嚴格驗證（防範越界、失敗 run、錯誤 repo）", () => {
    it("ACTIVE 狀態缺少 restoreReceipt 必須拒絕", () => {
      const f = fixture();
      const stateFile = join(f.dir, "ops", "operating-state.json");
      writeFileSync(stateFile, JSON.stringify({ ...validContractBase, state: "ACTIVE" }));

      const res = loadContract(stateFile, f.dir);
      expect(res.errors.some((e) => e.includes("state=ACTIVE requires evidence.restoreReceipt"))).toBe(true);
      f.cleanup();
    });

    it("收據路徑目錄越界（路徑穿越 ..）必須拒絕", () => {
      const f = fixture();
      const res = validateReceipt("../secret.json", f.dir);
      expect(res.ok).toBe(false);
      expect(res.errors[0]).toContain("directory traversal");
      f.cleanup();
    });

    it("收據不在允許目錄（docs/operations/receipts 或 reports）必須拒絕", () => {
      const f = fixture();
      const res = validateReceipt("public/data/receipt.json", f.dir);
      expect(res.ok).toBe(false);
      expect(res.errors[0]).toContain("must be within");
      f.cleanup();
    });

    it("收據若標示非預期 repository，必須拒絕", () => {
      const f = fixture();
      const receiptPath = "docs/operations/receipts/restore-wrong-repo.json";
      writeFileSync(
        join(f.dir, receiptPath),
        JSON.stringify({ repo: "other-org/other-repo", ok: true, conclusion: "success" })
      );

      const res = validateReceipt(receiptPath, f.dir);
      expect(res.ok).toBe(false);
      expect(res.errors[0]).toContain("unexpected repository");
      f.cleanup();
    });

    it("收據若為失敗 run（ok:false 或 conclusion:failure），必須拒絕", () => {
      const f = fixture();
      const receiptPath = "docs/operations/receipts/restore-failed.json";
      writeFileSync(
        join(f.dir, receiptPath),
        JSON.stringify({ repo: EXPECTED_REPO, ok: false, conclusion: "failure" })
      );

      const res = validateReceipt(receiptPath, f.dir);
      expect(res.ok).toBe(false);
      expect(res.errors[0]).toContain("indicates failure");
      f.cleanup();
    });

    it("合法通過的 JSON 收據（預期 repo + ok:true）驗證成功", () => {
      const f = fixture();
      const receiptPath = "docs/operations/receipts/restore-20260916.json";
      writeFileSync(
        join(f.dir, receiptPath),
        JSON.stringify({ repo: EXPECTED_REPO, ok: true, conclusion: "success", summary: { fail: 0 } })
      );

      const res = validateReceipt(receiptPath, f.dir);
      expect(res.ok).toBe(true);
      expect(res.errors).toHaveLength(0);

      // 裝載於 ACTIVE 合約
      const stateFile = join(f.dir, "ops", "operating-state.json");
      writeFileSync(
        stateFile,
        JSON.stringify({
          ...validContractBase,
          state: "ACTIVE",
          evidence: { restoreReceipt: receiptPath },
        })
      );
      const contractRes = loadContract(stateFile, f.dir);
      expect(contractRes.errors).toHaveLength(0);

      f.cleanup();
    });

    it("合法通過的 Markdown 收據（含 actions/runs URL + 通過標記）驗證成功", () => {
      const f = fixture();
      const receiptPath = "docs/operations/receipts/restore-20260916.md";
      writeFileSync(
        join(f.dir, receiptPath),
        `# Restore Receipt\nRun: https://github.com/${EXPECTED_REPO}/actions/runs/35081600726\nStatus: pass (通過)`
      );

      const res = validateReceipt(receiptPath, f.dir);
      expect(res.ok).toBe(true);
      f.cleanup();
    });
  });

  describe("排程與發布決策（scheduleDecision）", () => {
    it("PAUSED 狀態：阻擋任何 mutation 與 validation，回傳 exitCode 78", () => {
      const pausedDoc = { ...validContractBase, state: "PAUSED", reason: "緊急決策暫停" };
      const d1 = scheduleDecision(pausedDoc, "mutation");
      expect(d1.allow).toBe(false);
      expect(d1.skipped).toBe(true);
      expect(d1.exitCode).toBe(78);
      expect(d1.receipt.why).toBe("緊急決策暫停");

      const d2 = scheduleDecision(pausedDoc, "validation");
      expect(d2.allow).toBe(false);
    });

    it("RESTORING 狀態：僅允許 validation，阻擋一般 mutation", () => {
      const restoringDoc = { ...validContractBase, state: "RESTORING" };
      const dMutation = scheduleDecision(restoringDoc, "mutation");
      expect(dMutation.allow).toBe(false);
      expect(dMutation.skipped).toBe(true);
      expect(dMutation.exitCode).toBe(78);

      const dValidation = scheduleDecision(restoringDoc, "validation");
      expect(dValidation.allow).toBe(true);
      expect(dValidation.skipped).toBe(false);
      expect(dValidation.exitCode).toBe(0);
    });

    it("DEGRADED 狀態：允許排程繼續並附帶降級提醒 receipt", () => {
      const degradedDoc = { ...validContractBase, state: "DEGRADED" };
      const d = scheduleDecision(degradedDoc, "mutation");
      expect(d.allow).toBe(true);
      expect(d.skipped).toBe(false);
      expect(d.receipt.notice).toContain("Operating in DEGRADED mode");
    });

    it("ACTIVE 狀態：全面允許 mutation 與 validation", () => {
      const activeDoc = { ...validContractBase, state: "ACTIVE" };
      const d = scheduleDecision(activeDoc, "mutation");
      expect(d.allow).toBe(true);
      expect(d.skipped).toBe(false);
    });
  });

  describe("文件狀態一致性（verifyDocs）", () => {
    it("README 標記必須與契約狀態精確對齊", () => {
      const f = fixture();
      const readmePath = join(f.dir, "README.md");

      // 契約為 PAUSED，README 寫 運作中 → 報錯
      writeFileSync(readmePath, "# 儀表板\n- 狀態：**運作中**\n");
      const errs1 = verifyDocs(readmePath, { state: "PAUSED" });
      expect(errs1.some((e) => e.includes(`README status must say **${README_MARKERS.PAUSED}**`))).toBe(true);

      // 契約為 DEGRADED，README 寫 降級運作中 → 通過
      writeFileSync(readmePath, "# 儀表板\n- 狀態：**降級運作中**\n");
      const errs2 = verifyDocs(readmePath, { state: "DEGRADED" });
      expect(errs2).toHaveLength(0);

      // 非 PAUSED 狀態下若宣稱 503 → 報錯
      writeFileSync(readmePath, "# 儀表板\n- 狀態：**降級運作中**（503 維護）\n");
      const errs3 = verifyDocs(readmePath, { state: "DEGRADED" });
      expect(errs3.some((e) => e.includes("claims 503 but contract state is DEGRADED"))).toBe(true);

      f.cleanup();
    });
  });
});
