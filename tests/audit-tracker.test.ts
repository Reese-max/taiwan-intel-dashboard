import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — JS ESM module without types
import {
  CLEAN_REQUIRED_STREAK,
  FIXED_PERSONA_IDS,
  PROTOCOL_CONDITION_COUNT,
  TRACKER_RULE_IDS,
  parseTracker,
  validateTracker,
} from "../scripts/lib/audit-tracker.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TRACKER_PATH = join(REPO_ROOT, "docs/audits/50-persona-tracker.md");

function validTracker() {
  return {
    schema: "fixed-50-audit-tracker/1",
    umbrella: { repo: "Reese-max/taiwan-intel-dashboard", issue: 41 },
    protocol: { repo: "Reese-max/autodev-ng", path: "docs/portfolio-audit/2026-09-06-50-persona-audit.md", blob: "a".repeat(40) },
    personas: [...FIXED_PERSONA_IDS],
    rules: [...TRACKER_RULE_IDS],
    rounds: [
      {
        round: 1,
        date: "2026-09-06",
        report: "docs/audits/50-persona-round-1-2026-09-06.md",
        inspectedSha: null,
        inspectedShaNote: "round-1 report records no inspected SHA",
        result: "NOT CLEAN",
        onDefaultBranch: true,
        pr: null,
        qualifyingClean: false,
        newFindings: [],
      },
      {
        round: 2,
        date: "2026-09-10",
        report: "docs/audits/50-persona-round-2-2026-09-10.md",
        inspectedSha: "b".repeat(40),
        result: "NOT CLEAN",
        onDefaultBranch: true,
        pr: null,
        qualifyingClean: false,
        newFindings: [17],
      },
    ],
    findings: [
      { issue: 17, severity: "P1", state: "closed", title: "operating-state mismatch", since: 2 },
      { issue: 18, severity: "P2", state: "open", title: "open finding", since: 2 },
    ],
    clean: {
      status: "NOT CLEAN",
      streak: 0,
      requiredStreak: CLEAN_REQUIRED_STREAK,
      coverage: { scenarios: FIXED_PERSONA_IDS.length, of: FIXED_PERSONA_IDS.length },
      conditions: [false, false, false, false, false],
    },
  };
}

function errorsFor(mutate: (tracker: any) => void, opts: { reports?: string[] } = {}) {
  const tracker = validTracker();
  mutate(tracker);
  const reports = opts.reports ?? [
    "docs/audits/50-persona-round-1-2026-09-06.md",
    "docs/audits/50-persona-round-2-2026-09-10.md",
  ];
  return validateTracker(tracker, { reportExists: (p: string) => reports.includes(p) });
}

describe("fixed-50 audit tracker contract", () => {
  it("固定 persona 清單就是協議的 50 個 ID（A01–J05）", () => {
    expect(FIXED_PERSONA_IDS).toHaveLength(50);
    expect(new Set(FIXED_PERSONA_IDS).size).toBe(50);
    for (const group of "ABCDEFGHIJ") {
      expect(FIXED_PERSONA_IDS.filter((id) => id.startsWith(group))).toHaveLength(5);
    }
    expect(FIXED_PERSONA_IDS[0]).toBe("A01");
    expect(FIXED_PERSONA_IDS[49]).toBe("J05");
    expect(CLEAN_REQUIRED_STREAK).toBe(2);
  });

  it("合法的 tracker 沒有錯誤", () => {
    expect(errorsFor(() => {})).toEqual([]);
  });

  it("persona 清單必須剛好是 50 個協議 ID", () => {
    expect(errorsFor((t) => t.personas.pop())).toContain("personas: 清單不是協議的固定 50 persona");
    expect(errorsFor((t) => t.personas.push("K01"))).toContain("personas: 清單不是協議的固定 50 persona");
  });

  it("round 編號不可重複、日期必須遞增", () => {
    expect(errorsFor((t) => (t.rounds[1].round = 1))).toContain("rounds: round 編號重複或未嚴格遞增：1（前一筆為 1）");
    expect(errorsFor((t) => t.rounds.reverse())).toContain("rounds: round 編號重複或未嚴格遞增：1（前一筆為 2）");
    expect(errorsFor((t) => (t.rounds[1].date = "2026-09-01"))).toContain(
      "rounds: 日期必須依 round 編號遞增：round 2（2026-09-01）早於 round 1（2026-09-06）",
    );
    expect(errorsFor((t) => (t.rounds[1].report = t.rounds[0].report))).toContain(
      "rounds: 報告路徑重複：docs/audits/50-persona-round-1-2026-09-06.md",
    );
  });

  it("宣稱在 default branch 的 round 必須真的有報告檔存在", () => {
    expect(errorsFor(() => {})).toEqual([]);
    expect(errorsFor(() => {}, { reports: ["docs/audits/50-persona-round-1-2026-09-06.md"] })).toContain(
      "rounds: round 2 宣稱在 default branch，但報告不存在：docs/audits/50-persona-round-2-2026-09-10.md",
    );
  });

  it("尚未合併的 round 必須引用 PR，且其報告必須確實不在此 checkout", () => {
    const reports = ["docs/audits/50-persona-round-1-2026-09-06.md"];
    const unmerged = (t: any) => {
      t.rounds[1].onDefaultBranch = false;
      t.rounds[1].pr = 48;
      t.rounds[1].prUrl = "https://github.com/Reese-max/taiwan-intel-dashboard/pull/48";
    };
    expect(
      validateTracker((() => {
        const t = validTracker();
        unmerged(t);
        return t;
      })(), { reportExists: (p: string) => reports.includes(p) }),
    ).toEqual([]);
    // 宣稱未合併，報告卻已經在 checkout 裡 → 可被驗證的假話。
    expect(
      validateTracker((() => {
        const t = validTracker();
        unmerged(t);
        return t;
      })(), { reportExists: () => true }),
    ).toContain("rounds: round 2 標示不在 default branch，但報告已存在於此 checkout：docs/audits/50-persona-round-2-2026-09-10.md");
    expect(
      errorsFor(
        (t) => {
          unmerged(t);
          t.rounds[1].prUrl = "https://github.com/someone-else/repo/pull/48";
        },
        { reports },
      ),
    ).toContain("rounds: round 2 的 prUrl 必須是 https://github.com/Reese-max/taiwan-intel-dashboard/pull/48");
    expect(
      errorsFor((t) => {
        t.rounds[1].onDefaultBranch = false;
        t.rounds[1].pr = null;
      }),
    ).toContain("rounds: round 2 不在 default branch 時必須引用 PR 編號");
  });

  it("qualifyingClean 不能只靠自稱：新增 finding／結果自述 NOT CLEAN／缺 SHA 都不得算數", () => {
    const qualifying = (t: any) => {
      t.findings = [{ issue: 18, severity: "P3", state: "open", title: "cosmetic", since: 2 }];
      t.clean.status = "NOT CLEAN";
      t.clean.streak = 1;
      t.rounds[1].qualifyingClean = true;
      t.rounds[1].newFindings = [];
      t.rounds[1].result = "CLEAN";
    };
    expect(errorsFor(qualifying)).toEqual([]);
    expect(
      errorsFor((t) => {
        qualifying(t);
        t.rounds[1].newFindings = [18];
        t.findings = [{ issue: 18, severity: "P2", state: "closed", title: "fixed", since: 2 }];
      }),
    ).toContain("rounds: round 2 有 newFindings（18）卻標示 qualifyingClean");
    expect(
      errorsFor((t) => {
        qualifying(t);
        t.rounds[1].result = "NOT CLEAN — something new";
      }),
    ).toContain("rounds: round 2 的結果自述為 NOT CLEAN，不能標示 qualifyingClean");
    expect(
      errorsFor((t) => {
        qualifying(t);
        t.rounds[1].inspectedSha = null;
        t.rounds[1].inspectedShaNote = "unknown";
      }),
    ).toContain("rounds: round 2 沒有 inspectedSha，不能當作 qualifying CLEAN 輪");
  });

  it("newFindings 必須已登記在 findings（round 與 register 不可脫鉤）", () => {
    expect(errorsFor((t) => (t.rounds[1].newFindings = [999]))).toContain(
      "rounds: round 2 的 newFindings #999 未登記在 findings",
    );
  });

  it("inspectedSha 必須是 40 碼 SHA；未知時要寫明原因", () => {
    expect(errorsFor((t) => (t.rounds[1].inspectedSha = "abc"))).toContain(
      "rounds: round 2 的 inspectedSha 必須是 40 碼 SHA",
    );
    expect(errorsFor((t) => (t.rounds[1].inspectedSha = null))).toContain(
      "rounds: round 2 缺少 inspectedSha 時必須附 inspectedShaNote",
    );
    expect(errorsFor((t) => delete t.rounds[0].inspectedShaNote)).toContain(
      "rounds: round 1 缺少 inspectedSha 時必須附 inspectedShaNote",
    );
  });

  it("finding 必須有唯一 issue 編號與合法 severity／state", () => {
    expect(errorsFor((t) => t.findings.push({ ...t.findings[0], severity: "P9" }))).toContain(
      "findings: #17 的 severity 非法：P9",
    );
    expect(errorsFor((t) => (t.findings[0].state = "probably-fine"))).toContain(
      "findings: #17 的 state 非法：probably-fine",
    );
    expect(errorsFor((t) => t.findings.push({ ...t.findings[1], issue: 18 }))).toContain(
      "findings: issue 編號重複：18",
    );
    expect(errorsFor((t) => (t.findings[0].issue = 0))).toContain("findings: #0 必須是有效的 issue 編號");
  });

  it("P3 不阻擋 CLEAN；P0/P1/P2 的未結案 finding 強制 NOT CLEAN 且 streak 歸零", () => {
    expect(
      errorsFor((t) => {
        t.findings = [{ issue: 18, severity: "P3", state: "open", title: "cosmetic", since: 2 }];
        t.clean.status = "NOT CLEAN";
        t.clean.streak = 0;
        t.rounds[1].newFindings = [];
      }),
    ).toEqual([]);
    expect(
      errorsFor((t) => {
        t.clean.status = "CLEAN";
        t.clean.streak = 2;
      }),
    ).toContain("clean: 仍有未結案的適用 finding（#18），不得標記 CLEAN");
    expect(errorsFor((t) => (t.clean.streak = 1))).toContain(
      "clean: 仍有未結案的適用 finding 時 streak 必須為 0",
    );
  });

  it("conditions 必須與 status 一致（不得在同區塊自相矛盾）", () => {
    expect(errorsFor((t) => (t.clean.conditions = [true, true, true, true, true]))).toContain(
      "clean: status=NOT CLEAN 與 conditions（5/5 成立）不一致",
    );
    expect(
      errorsFor((t) => {
        t.findings = [];
        t.clean.conditions = [true, true, true, true, true];
        t.clean.status = "CLEAN";
        t.clean.streak = 2;
        t.rounds[1].qualifyingClean = true;
        t.rounds[1].newFindings = [];
        t.rounds[1].result = "CLEAN";
        t.rounds[0].qualifyingClean = true;
        t.rounds[0].newFindings = [];
        t.rounds[0].inspectedSha = "c".repeat(40);
        t.rounds[0].inspectedShaNote = undefined;
        t.rounds[0].result = "CLEAN";
      }),
    ).toEqual([]);
  });

  it("streak 必須等於最近連續的 qualifying CLEAN round 數", () => {
    expect(errorsFor((t) => (t.clean.streak = 1))).toContain(
      "clean: streak（1）與最近連續 qualifying CLEAN round 數（0）不一致",
    );
    expect(
      errorsFor((t) => {
        t.findings = [{ issue: 18, severity: "P3", state: "open", title: "cosmetic", since: 2 }];
        t.rounds[1].qualifyingClean = true;
        t.rounds[1].newFindings = [];
        t.rounds[1].result = "CLEAN";
        t.clean.streak = 1;
      }),
    ).toEqual([]);
    expect(
      errorsFor((t) => {
        t.findings = [{ issue: 18, severity: "P3", state: "open", title: "cosmetic", since: 2 }];
        t.rounds[1].qualifyingClean = true;
        t.rounds[1].newFindings = [];
        t.rounds[1].result = "CLEAN";
        t.clean.status = "CLEAN";
        t.clean.streak = 1;
        t.clean.conditions = [true, true, true, true, true];
      }),
    ).toContain(`clean: CLEAN 需要連續 ${CLEAN_REQUIRED_STREAK} 輪 qualifying CLEAN，目前 streak=1`);
  });

  it("coverage 與 requiredStreak 不可被 tracker 自己放寬", () => {
    expect(errorsFor((t) => (t.clean.requiredStreak = 1))).toContain(
      `clean: requiredStreak 必須等於協議的 ${CLEAN_REQUIRED_STREAK}`,
    );
    expect(errorsFor((t) => (t.clean.coverage.scenarios = 42))).toContain(
      `clean: coverage.scenarios 必須等於 ${FIXED_PERSONA_IDS.length}`,
    );
    expect(errorsFor((t) => (t.clean.conditions = [false, false]))).toContain(
      `clean: conditions 必須列出協議的 ${PROTOCOL_CONDITION_COUNT} 個停止條件`,
    );
  });

  it("四條追蹤規則必須全部宣告", () => {
    expect(TRACKER_RULE_IDS).toHaveLength(4);
    expect(errorsFor((t) => t.rules.pop())).toContain(`rules: 缺少必要規則：${TRACKER_RULE_IDS[3]}`);
  });

  it("markdown 解析：缺區塊、壞 JSON、多個 tracker 區塊都要失敗", () => {
    expect(parseTracker("# tracker\n").errors[0]).toMatch(/^parse: 找不到 machine-readable tracker JSON 區塊/);
    const broken = parseTracker("```json audit-tracker\n{ not json\n```\n");
    expect(broken.errors[0]).toMatch(/^parse: tracker JSON 無法解析：/);
    const duplicated = parseTracker(
      "```json audit-tracker\n{\"schema\":\"fixed-50-audit-tracker/1\"}\n```\n```json audit-tracker\n{\"schema\":\"fixed-50-audit-tracker/1\"}\n```\n",
    );
    expect(duplicated.errors).toContain("parse: tracker JSON 區塊必須只有一個");
  });

  it("非 tracker 的 json 區塊不會被誤判", () => {
    const parsed = parseTracker("```json\n{\"hello\":\"world\"}\n```\n");
    expect(parsed.tracker).toBeNull();
    expect(parsed.errors).toHaveLength(1);
  });
});

describe("repo 內的 50-persona tracker 文件", () => {
  it("存在且通過機器檢查（npm run audit:tracker 的同一份規則）", () => {
    expect(existsSync(TRACKER_PATH)).toBe(true);
    const parsed = parseTracker(readFileSync(TRACKER_PATH, "utf8"));
    expect(parsed.errors).toEqual([]);
    const errors = validateTracker(parsed.tracker, {
      reportExists: (path: string) => existsSync(join(REPO_ROOT, path)),
    });
    expect(errors).toEqual([]);
  });

  it("宣稱在 default branch 的 round 至少涵蓋已合併的歷史報告", () => {
    const { tracker } = parseTracker(readFileSync(TRACKER_PATH, "utf8"));
    const onBranch = tracker.rounds.filter((r: any) => r.onDefaultBranch);
    expect(onBranch.length).toBeGreaterThanOrEqual(4);
    for (const round of onBranch) {
      expect(existsSync(join(REPO_ROOT, round.report))).toBe(true);
    }
  });

  it("tracker 只宣告固定 50 persona，且未合併 round 都帶 PR 編號", () => {
    const { tracker } = parseTracker(readFileSync(TRACKER_PATH, "utf8"));
    expect(tracker.personas).toEqual([...FIXED_PERSONA_IDS]);
    for (const round of tracker.rounds.filter((r: any) => !r.onDefaultBranch)) {
      expect(typeof round.pr).toBe("number");
      expect(round.pr).toBeGreaterThan(0);
    }
  });
});
