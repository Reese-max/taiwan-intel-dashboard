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
    protocolIssueQuality: { repo: "Reese-max/autodev-ng", path: "docs/portfolio-audit/2026-09-14-issue-quality-v2.md", blob: "d".repeat(40) },
    personas: [...FIXED_PERSONA_IDS],
    rules: [...TRACKER_RULE_IDS],
    rounds: [
      {
        round: 1,
        date: "2026-09-06",
        report: "docs/audits/50-persona-round-1-2026-09-06.md",
        inspectedSha: null,
        inspectedShaNote: "round-1 report records no inspected SHA",
        personasApplied: 50,
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
        personasApplied: 50,
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
    ).toContain("rounds: round 2 的結果自述不推進 streak（NOT CLEAN — something new），不能標示 qualifyingClean");
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

describe("tracker 契約的其餘分支（逐一可失敗）", () => {
  const cases: Array<[string, (t: any) => void, string]> = [
    ["schema 必須是追蹤器 schema", (t) => (t.schema = "other/1"), "schema: 必須是 fixed-50-audit-tracker/1"],
    ["umbrella 必須有 repo 與 issue", (t) => (t.umbrella = { repo: "", issue: 0 }), "umbrella: 必須記錄 repo 與正整數 issue 編號"],
    [
      "protocol 需要 40 碼 blob",
      (t) => (t.protocol.blob = "nope"),
      "protocol: 必須記錄外部協議 repo、path 與 40 碼 blob",
    ],
    [
      "protocolIssueQuality 與 protocol 同樣被檢查",
      (t) => delete t.protocolIssueQuality,
      "protocolIssueQuality: 必須記錄外部協議 repo、path 與 40 碼 blob",
    ],
    ["未知規則 id 會被擋", (t) => t.rules.push("trust-me"), "rules: 未定義的規則 id：trust-me"],
    ["至少要有一輪", (t) => (t.rounds = []), "rounds: 至少要有一輪稽核紀錄"],
    ["round 必須是物件", (t) => (t.rounds[0] = "round-1"), "rounds: 第 1 筆 round 必須是物件"],
    ["round 編號必須是正整數", (t) => (t.rounds[0].round = "1"), "rounds: rounds[0] 的 round 編號必須是正整數"],
    ["date 必須是 YYYY-MM-DD", (t) => (t.rounds[0].date = "2026/09/06"), "rounds: round 1 的 date 必須是 YYYY-MM-DD"],
    ["報告路徑必填", (t) => (t.rounds[0].report = ""), "rounds: round 1 必須記錄報告路徑"],
    [
      "報告路徑必須是 round 報告命名",
      (t) => (t.rounds[0].report = "README.md"),
      "rounds: round 1 的報告路徑必須是 docs/audits/50-persona-round-<n>-<YYYY-MM-DD>.md：README.md",
    ],
    ["每輪必須記錄結果", (t) => (t.rounds[0].result = ""), "rounds: round 1 必須記錄該輪結果"],
    ["每輪必須標示 onDefaultBranch", (t) => delete t.rounds[0].onDefaultBranch, "rounds: round 1 必須標示 onDefaultBranch"],
    ["每輪必須標示 qualifyingClean", (t) => delete t.rounds[0].qualifyingClean, "rounds: round 1 必須標示 qualifyingClean"],
    [
      "newFindings 不可重複",
      (t) => (t.rounds[0].newFindings = [17, 17]),
      "rounds: round 1 的 newFindings 必須是不重複的 issue 編號陣列",
    ],
    [
      "qualifying 輪必須已合併",
      (t) => {
        t.rounds[0].qualifyingClean = true;
        t.rounds[0].inspectedSha = "c".repeat(40);
        t.rounds[0].result = "CLEAN";
        t.rounds[0].onDefaultBranch = false;
        t.rounds[0].pr = 1;
        t.rounds[0].prUrl = "https://github.com/Reese-max/taiwan-intel-dashboard/pull/1";
      },
      "rounds: round 1 不在 default branch，其報告可能隨 PR 消失，不能當作 qualifying CLEAN 輪",
    ],
    [
      "verified 狀態必須附理由",
      (t) => {
        t.findings[0].state = "verified";
        delete t.findings[0].note;
      },
      "findings: #17 標示 verified 必須附理由（note）",
    ],
    [
      "未宣稱完整覆蓋時要附說明",
      (t) => (t.rounds[0].personasApplied = null),
      "rounds: round 1 未宣稱完整覆蓋時必須附 personasAppliedNote",
    ],
    [
      "personasApplied 不得超過 50",
      (t) => (t.rounds[0].personasApplied = 51),
      "rounds: round 1 的 personasApplied 必須是 1..50 的整數",
    ],
    [
      "qualifying 輪必須是完整 50 persona",
      (t) => {
        t.rounds[0].qualifyingClean = true;
        t.rounds[0].inspectedSha = "c".repeat(40);
        t.rounds[0].result = "CLEAN";
        t.rounds[0].personasApplied = 3;
      },
      "rounds: round 1 只套用了 3/50 persona，不能當作 qualifying CLEAN 輪",
    ],
    [
      "NO_CHANGE / partial review 不推進 streak",
      (t) => {
        t.rounds[0].qualifyingClean = true;
        t.rounds[0].inspectedSha = "c".repeat(40);
        t.rounds[0].result = "NO_CHANGE";
      },
      "rounds: round 1 的結果自述不推進 streak（NO_CHANGE），不能標示 qualifyingClean",
    ],
    ["findings 必須是陣列", (t) => (t.findings = {}), "findings: 必須是陣列"],
    ["finding 必須有 title", (t) => (t.findings[0].title = " "), "findings: #17 必須有 title"],
    ["since 必須是存在的 round", (t) => (t.findings[0].since = 99), "findings: #17 的 since round 不存在：99"],
    [
      "not_planned 必須附理由",
      (t) => {
        t.findings[0].state = "not_planned";
        delete t.findings[0].note;
      },
      "findings: #17 標示 not_planned 必須附理由（note）",
    ],
    ["clean 必須是物件", (t) => delete t.clean, "clean: 必須記錄 CLEAN 會計"],
    ["status 只能是 CLEAN 或 NOT CLEAN", (t) => (t.clean.status = "MOSTLY CLEAN"), "clean: status 必須是 CLEAN 或 NOT CLEAN：MOSTLY CLEAN"],
    ["streak 必須是非負整數", (t) => (t.clean.streak = -1), "clean: streak 必須是非負整數"],
    ["coverage.of 必須等於 scenarios", (t) => (t.clean.coverage.of = 49), "clean: coverage.of 必須等於 coverage.scenarios"],
    ["conditions 每項必須是 boolean", (t) => (t.clean.conditions = [1, 0, 0, 0, 0]), "clean: conditions 每一項都必須是 boolean"],
  ];

  for (const [name, mutate, expected] of cases) {
    it(name, () => {
      expect(errorsFor(mutate)).toContain(expected);
    });
  }

  it("未合併的 round 其實不在 checkout 時才會走到「不能當 qualifying 輪」判定", () => {
    expect(errorsFor((t) => {
      t.rounds[0].qualifyingClean = true;
      t.rounds[0].inspectedSha = "c".repeat(40);
      t.rounds[0].result = "CLEAN";
      t.rounds[0].onDefaultBranch = false;
      t.rounds[0].pr = 1;
      t.rounds[0].prUrl = "https://github.com/Reese-max/taiwan-intel-dashboard/pull/1";
    }, { reports: ["docs/audits/50-persona-round-2-2026-09-10.md"] })).toContain(
      "rounds: round 1 不在 default branch，其報告可能隨 PR 消失，不能當作 qualifying CLEAN 輪",
    );
  });

  it("非物件輸入 fail closed", () => {
    expect(validateTracker(null, {})).toEqual(["parse: tracker JSON 必須是物件"]);
    expect(validateTracker([], {})).toEqual(["parse: tracker JSON 必須是物件"]);
  });
});
