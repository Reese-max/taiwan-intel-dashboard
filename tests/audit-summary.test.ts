import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  auditSummary,
  deterministicBrief,
  isDeterministicFallback,
  isPlaceholder,
  SUMMARY_PLACEHOLDER,
} from "../scripts/lib/summary-quality.mjs";
import { countIncidentsFromFile } from "../scripts/audit-summary.mjs";

const runCli = (dataDir: string, extraArgs: string[] = []) => {
  try {
    const out = execFileSync(
      process.execPath,
      ["scripts/audit-summary.mjs", `--data-dir=${dataDir}`, "--no-annotations", ...extraArgs],
      { encoding: "utf8" }
    );
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
};

const fixture = (files: Record<string, unknown>) => {
  const dir = mkdtempSync(join(tmpdir(), "audsum-"));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), JSON.stringify(body, null, 2));
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};

const sampleEvent = (id: string, category = "治安", datasetId = "normal-news") => ({
  id,
  title: `事件 ${id}`,
  category,
  timestamp: "2026-09-16T10:00:00Z",
  source: { name: "新聞來源", datasetId },
});

describe("summary quality & semantic audit gate (Issue #18)", () => {
  it("2026-09-16 快照回歸情境：有事件資料但摘要為（暫無資料）佔位字串時必須被阻擋", () => {
    const snapshotSummary = {
      domestic: "（暫無資料）",
      international: "（暫無資料）",
      recent24h: "",
      byCategory: {},
      trend: "",
      dailyCounts: [1256, 1152, 1174, 1254, 1195],
      generatedAt: "2026-09-16T09:52:09.450Z",
    };

    const result = auditSummary({
      summary: snapshotSummary,
      domesticCount: 1200,
      internationalCount: 40,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(2);
    expect(result.failures.map((f) => f.field)).toEqual(["domestic", "international"]);
    expect(result.failures[0].code).toBe("empty-brief-with-evidence");
  });

  it("真正無事件資料時，（暫無資料）為正常空狀態，審計通過", () => {
    const emptySummary = {
      domestic: SUMMARY_PLACEHOLDER,
      international: SUMMARY_PLACEHOLDER,
      generatedAt: "2026-09-16T10:00:00Z",
    };

    const result = auditSummary({
      summary: emptySummary,
      domesticCount: 0,
      internationalCount: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("純參考集合（reference-only rows）排除於事件計數，不誤判為 AI 失敗", () => {
    const referenceEvents = [
      sampleEvent("ref-1", "其他", "124173"), // 新北市高級中等學校教育概況 (REFERENCE_DATASET_ID)
      sampleEvent("ref-2", "其他", "84049"),  // 臺中市各區人口結構 (REFERENCE_DATASET_ID)
    ];

    const f = fixture({
      "summary.json": {
        domestic: SUMMARY_PLACEHOLDER,
        international: SUMMARY_PLACEHOLDER,
        generatedAt: "2026-09-16T10:00:00Z",
      },
      "domestic.json": referenceEvents,
      "international.json": [],
    });

    const incidentCount = countIncidentsFromFile(join(f.dir, "domestic.json"));
    expect(incidentCount).toBe(0);

    const cli = runCli(f.dir);
    f.cleanup();
    expect(cli.code).toBe(0);
    expect(cli.out).toContain("SUMMARY_AUDIT_OK");
  });

  it("確定性統計備援格式正確：誠實標記計數與分類，不冒充 AI 生成亦不偽稱暫無資料", () => {
    const events = [
      sampleEvent("e1", "治安"),
      sampleEvent("e2", "治安"),
      sampleEvent("e3", "反詐"),
      sampleEvent("e4", "災害"),
    ];

    const fallback = deterministicBrief("國內事件", events);
    expect(fallback).toContain("國內事件共 4 起");
    expect(fallback).toContain("治安 2 起");
    expect(fallback).toContain("AI 摘要暫時無法生成，事件資料仍可查閱；此為系統統計備援");
    expect(fallback).not.toContain(SUMMARY_PLACEHOLDER);
    expect(isDeterministicFallback(fallback)).toBe(true);

    expect(deterministicBrief("國內事件", [])).toBe(SUMMARY_PLACEHOLDER);
  });

  it("單邊失敗／統計備援：預設模式允許發布並記 warning，嚴格模式阻擋", () => {
    const events = [sampleEvent("e1", "治安")];
    const fallback = deterministicBrief("國內事件", events);

    const summary = {
      domestic: fallback,
      international: "美日菲國防部長於馬尼拉舉行三邊會談，重申臺海和平穩定之重要性。",
      degraded: { domestic: true, international: false },
      generatedAt: "2026-09-16T10:00:00Z",
    };

    // 預設模式（公開儀表板）：統計備援允許發布，提供警告
    const defaultResult = auditSummary({
      summary,
      domesticCount: 1,
      internationalCount: 1,
      requireNarrative: false,
    });
    expect(defaultResult.ok).toBe(true);
    expect(defaultResult.warnings.map((w) => w.code)).toContain("summary-degraded");

    // 嚴格模式：要求完整敘述，阻擋發布
    const strictResult = auditSummary({
      summary,
      domesticCount: 1,
      internationalCount: 1,
      requireNarrative: true,
    });
    expect(strictResult.ok).toBe(false);
    expect(strictResult.failures.map((f) => f.code)).toContain("narrative-required-but-degraded");
  });

  it("兩邊皆有完整 AI 摘要時，預設與嚴格模式皆通過且無警告", () => {
    const summary = {
      domestic: "今日國內以警政查緝詐欺車手為主，交通路況大致良好。",
      international: "國際要聞包含美日聯合演訓，區域情勢維持審慎觀察。",
      degraded: { domestic: false, international: false },
      generatedAt: "2026-09-16T10:00:00Z",
    };

    const r1 = auditSummary({ summary, domesticCount: 5, internationalCount: 3, requireNarrative: false });
    expect(r1.ok).toBe(true);
    expect(r1.warnings).toHaveLength(0);

    const r2 = auditSummary({ summary, domesticCount: 5, internationalCount: 3, requireNarrative: true });
    expect(r2.ok).toBe(true);
    expect(r2.failures).toHaveLength(0);
  });

  it("邊界情境：summary.json 缺失時依事件存在與否決定成敗", () => {
    expect(auditSummary({ summary: null, domesticCount: 1 }).ok).toBe(false);
    expect(auditSummary({ summary: null, domesticCount: 0, internationalCount: 0 }).ok).toBe(true);
  });

  it("isPlaceholder 正確識別空字串、空白與佔位字串", () => {
    expect(isPlaceholder("")).toBe(true);
    expect(isPlaceholder("   ")).toBe(true);
    expect(isPlaceholder(SUMMARY_PLACEHOLDER)).toBe(true);
    expect(isPlaceholder(`  ${SUMMARY_PLACEHOLDER}  `)).toBe(true);
    expect(isPlaceholder("正常內容")).toBe(false);
  });

  it("CLI 整合驗收：真實檔案與命令列參數行為", () => {
    // 1. 有事件但佔位 → exit 1
    const fFail = fixture({
      "summary.json": { domestic: SUMMARY_PLACEHOLDER, international: "正常", generatedAt: "2026-09-16T10:00:00Z" },
      "domestic.json": [sampleEvent("e1")],
      "international.json": [sampleEvent("e2")],
    });
    const cliFail = runCli(fFail.dir);
    fFail.cleanup();
    expect(cliFail.code).toBe(1);
    expect(cliFail.out).toContain("SUMMARY_AUDIT_FAIL");

    // 2. 有事件但為統計備援：預設 exit 0
    const fFallback = fixture({
      "summary.json": {
        domestic: deterministicBrief("國內事件", [sampleEvent("e1")]),
        international: "正常摘要",
        degraded: { domestic: true, international: false },
        generatedAt: "2026-09-16T10:00:00Z",
      },
      "domestic.json": [sampleEvent("e1")],
      "international.json": [sampleEvent("e2")],
    });
    const cliFallback = runCli(fFallback.dir);
    expect(cliFallback.code).toBe(0);
    expect(cliFallback.out).toContain("SUMMARY_AUDIT_OK");

    // 3. 統計備援 + --require-narrative → exit 1
    const cliStrict = runCli(fFallback.dir, ["--require-narrative"]);
    fFallback.cleanup();
    expect(cliStrict.code).toBe(1);
    expect(cliStrict.out).toContain("SUMMARY_AUDIT_FAIL");
  });
});
