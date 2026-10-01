// Umbrella 50-persona tracker（#41）的機器可檢查契約。
//
// 追蹤器是稽核協調文件，不是產品程式碼；這裡把「CLEAN 會計」與「追蹤規則」變成
// 可執行的規則，讓 tracker 不會在没人複查的情況下宣稱 CLEAN、漏掉未合併的 round
// 或引用不存在的報告。純邏輯、不碰網路、不碰 GitHub API。

export const TRACKER_SCHEMA = "fixed-50-audit-tracker/1";

// 協議（Reese-max/autodev-ng/docs/portfolio-audit/2026-09-06-50-persona-audit.md）
// 的固定 50 persona：10 組 × 每組 5 人，ID 跨版本不變。
export const FIXED_PERSONA_IDS = Object.freeze(
  "ABCDEFGHIJ".split("").flatMap((group) => [1, 2, 3, 4, 5].map((n) => `${group}${String(n).padStart(2, "0")}`)),
);

// 協議「停止條件」共 5 條，其中第 5 條要求連續兩輪沒有新增 P0/P1/P2。
export const PROTOCOL_CONDITION_COUNT = 5;
export const CLEAN_REQUIRED_STREAK = 2;

export const SEVERITIES = Object.freeze(["P0", "P1", "P2", "P3"]);
// P3 只記錄、不阻擋 CLEAN。
export const BLOCKING_SEVERITIES = Object.freeze(["P0", "P1", "P2"]);
export const FINDING_STATES = Object.freeze([
  "open",
  "regression",
  "partial",
  "verified",
  "closed",
  "not_planned",
]);
// 這些狀態代表 finding 仍適用且未結案。
export const BLOCKING_FINDING_STATES = Object.freeze(["open", "regression", "partial"]);

export const TRACKER_RULE_IDS = Object.freeze([
  "one-finding-per-issue",
  "implementation-not-authorized",
  "runtime-claims-need-receipts",
  "immutable-round-reports",
]);

const SHA_RE = /^[0-9a-f]{40}$/;
const NOT_CLEAN_RESULT_RE = /NOT[\s-]*CLEAN/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FENCE_RE = /```json audit-tracker[^\S\n]*\n([\s\S]*?)\n```/g;

export function parseTracker(markdown) {
  const blocks = [...String(markdown).matchAll(FENCE_RE)].map((match) => match[1]);
  if (!blocks.length) {
    return { tracker: null, errors: ["parse: 找不到 machine-readable tracker JSON 區塊（需要 ```json audit-tracker 圍欄）"] };
  }
  if (blocks.length > 1) {
    return { tracker: null, errors: ["parse: tracker JSON 區塊必須只有一個"] };
  }
  try {
    return { tracker: JSON.parse(blocks[0]), errors: [] };
  } catch (error) {
    return { tracker: null, errors: [`parse: tracker JSON 無法解析：${error.message}`] };
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function blockingFindings(tracker) {
  const findings = Array.isArray(tracker?.findings) ? tracker.findings : [];
  return findings.filter(
    (finding) =>
      isPlainObject(finding) &&
      BLOCKING_SEVERITIES.includes(finding.severity) &&
      BLOCKING_FINDING_STATES.includes(finding.state),
  );
}

export function trailingQualifyingRounds(rounds) {
  const ordered = [...rounds].sort((a, b) => a.round - b.round);
  let streak = 0;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    if (!ordered[index].qualifyingClean) break;
    streak += 1;
  }
  return streak;
}

export function validateTracker(tracker, { reportExists = () => false } = {}) {
  if (!isPlainObject(tracker)) return ["parse: tracker JSON 必須是物件"];

  const errors = [];

  if (tracker.schema !== TRACKER_SCHEMA) errors.push(`schema: 必須是 ${TRACKER_SCHEMA}`);

  if (
    !isPlainObject(tracker.umbrella) ||
    !isNonEmptyString(tracker.umbrella.repo) ||
    !isPositiveInt(tracker.umbrella.issue)
  ) {
    errors.push("umbrella: 必須記錄 repo 與正整數 issue 編號");
  }

  if (
    !isPlainObject(tracker.protocol) ||
    !isNonEmptyString(tracker.protocol.repo) ||
    !isNonEmptyString(tracker.protocol.path) ||
    !SHA_RE.test(String(tracker.protocol.blob ?? ""))
  ) {
    errors.push("protocol: 必須記錄外部協議 repo、path 與 40 碼 blob");
  }

  const personas = tracker.personas;
  const personaOk =
    Array.isArray(personas) &&
    personas.length === FIXED_PERSONA_IDS.length &&
    new Set(personas).size === FIXED_PERSONA_IDS.length &&
    FIXED_PERSONA_IDS.every((id) => personas.includes(id));
  if (!personaOk) errors.push(`personas: 清單不是協議的固定 ${FIXED_PERSONA_IDS.length} persona`);

  const rules = Array.isArray(tracker.rules) ? tracker.rules : [];
  const missingRules = TRACKER_RULE_IDS.filter((id) => !rules.includes(id));
  if (missingRules.length) errors.push(`rules: 缺少必要規則：${missingRules.join("、")}`);
  const unknownRules = rules.filter((id) => !TRACKER_RULE_IDS.includes(id));
  if (unknownRules.length) errors.push(`rules: 未定義的規則 id：${unknownRules.join("、")}`);

  const rounds = tracker.rounds;
  if (!Array.isArray(rounds) || !rounds.length) {
    errors.push("rounds: 至少要有一輪稽核紀錄");
  } else {
    rounds.forEach((round, index) => {
      if (!isPlainObject(round)) {
        errors.push(`rounds: 第 ${index + 1} 筆 round 必須是物件`);
        return;
      }
      const label = isPositiveInt(round.round) ? `round ${round.round}` : `rounds[${index}]`;
      if (!isPositiveInt(round.round)) errors.push(`rounds: ${label} 的 round 編號必須是正整數`);
      if (!DATE_RE.test(String(round.date ?? ""))) {
        errors.push(`rounds: ${label} 的 date 必須是 YYYY-MM-DD`);
      }
      if (!isNonEmptyString(round.report)) errors.push(`rounds: ${label} 必須記錄報告路徑`);
      if (round.inspectedSha == null) {
        if (!isNonEmptyString(round.inspectedShaNote)) {
          errors.push(`rounds: ${label} 缺少 inspectedSha 時必須附 inspectedShaNote`);
        }
      } else if (!SHA_RE.test(String(round.inspectedSha))) {
        errors.push(`rounds: ${label} 的 inspectedSha 必須是 40 碼 SHA`);
      }
      if (!isNonEmptyString(round.result)) errors.push(`rounds: ${label} 必須記錄該輪結果`);
      if (typeof round.onDefaultBranch !== "boolean") {
        errors.push(`rounds: ${label} 必須標示 onDefaultBranch`);
      } else if (round.onDefaultBranch === false && !isPositiveInt(round.pr)) {
        errors.push(`rounds: ${label} 不在 default branch 時必須引用 PR 編號`);
      } else if (round.onDefaultBranch === false && isNonEmptyString(round.report) && reportExists(round.report)) {
        errors.push(`rounds: ${label} 標示不在 default branch，但報告已存在於此 checkout：${round.report}`);
      } else if (round.onDefaultBranch === true && isNonEmptyString(round.report) && !reportExists(round.report)) {
        errors.push(`rounds: ${label} 宣稱在 default branch，但報告不存在：${round.report}`);
      } else if (
        round.onDefaultBranch === false &&
        isPositiveInt(round.pr) &&
        isNonEmptyString(tracker.umbrella?.repo) &&
        round.prUrl !== `https://github.com/${String(tracker.umbrella.repo).replace(/\.git$/, "")}/pull/${round.pr}`
      ) {
        errors.push(
          `rounds: ${label} 的 prUrl 必須是 https://github.com/${String(tracker.umbrella.repo).replace(/\.git$/, "")}/pull/${round.pr}`,
        );
      }
      if (typeof round.qualifyingClean !== "boolean") {
        errors.push(`rounds: ${label} 必須標示 qualifyingClean`);
      }
      if (
        !Array.isArray(round.newFindings) ||
        round.newFindings.some((issue) => !isPositiveInt(issue)) ||
        new Set(round.newFindings).size !== round.newFindings.length
      ) {
        errors.push(`rounds: ${label} 的 newFindings 必須是不重複的 issue 編號陣列`);
      } else if (round.qualifyingClean === true) {
        // qualifying CLEAN 不能只靠自稱：新增任何 finding、結果自述 NOT CLEAN、
        // 沒有可追溯的 inspected SHA，都不可能是協議定義的 qualifying 輪。
        if (round.newFindings.length) {
          errors.push(`rounds: ${label} 有 newFindings（${round.newFindings.join("、")}）卻標示 qualifyingClean`);
        }
        if (NOT_CLEAN_RESULT_RE.test(String(round.result ?? ""))) {
          errors.push(`rounds: ${label} 的結果自述為 NOT CLEAN，不能標示 qualifyingClean`);
        }
        if (!SHA_RE.test(String(round.inspectedSha ?? ""))) {
          errors.push(`rounds: ${label} 沒有 inspectedSha，不能當作 qualifying CLEAN 輪`);
        }
      }
    });

    const validRounds = rounds.filter(isPlainObject);
    let previousRound = null;
    for (const round of validRounds) {
      if (previousRound && !(round.round > previousRound.round)) {
        errors.push(`rounds: round 編號重複或未嚴格遞增：${round.round}（前一筆為 ${previousRound.round}）`);
      }
      previousRound = round;
    }
    const byRound = [...validRounds].sort((a, b) => a.round - b.round);
    for (let index = 1; index < byRound.length; index += 1) {
      const current = byRound[index];
      const earlier = byRound[index - 1];
      if (DATE_RE.test(String(current.date)) && DATE_RE.test(String(earlier.date)) && String(current.date) < String(earlier.date)) {
        errors.push(
          `rounds: 日期必須依 round 編號遞增：round ${current.round}（${current.date}）早於 round ${earlier.round}（${earlier.date}）`,
        );
      }
    }

    const seenReports = new Set();
    for (const round of rounds) {
      if (!isPlainObject(round) || !isNonEmptyString(round.report)) continue;
      if (seenReports.has(round.report)) errors.push(`rounds: 報告路徑重複：${round.report}`);
      seenReports.add(round.report);
    }
  }

  const findings = tracker.findings;
  if (!Array.isArray(findings)) {
    errors.push("findings: 必須是陣列");
  } else {
    const seenIssues = new Set();
    findings.forEach((finding, index) => {
      if (!isPlainObject(finding)) {
        errors.push(`findings: 第 ${index + 1} 筆 finding 必須是物件`);
        return;
      }
      if (!isPositiveInt(finding.issue)) {
        errors.push(`findings: #${finding.issue} 必須是有效的 issue 編號`);
        return;
      }
      if (!SEVERITIES.includes(finding.severity)) {
        errors.push(`findings: #${finding.issue} 的 severity 非法：${finding.severity}`);
      }
      if (!FINDING_STATES.includes(finding.state)) {
        errors.push(`findings: #${finding.issue} 的 state 非法：${finding.state}`);
      }
      if (!isNonEmptyString(finding.title)) errors.push(`findings: #${finding.issue} 必須有 title`);
      if (!isPositiveInt(finding.since)) errors.push(`findings: #${finding.issue} 必須記錄 since round`);
      if (seenIssues.has(finding.issue)) errors.push(`findings: issue 編號重複：${finding.issue}`);
      seenIssues.add(finding.issue);
    });

    const knownIssues = new Set(
      (Array.isArray(findings) ? findings : []).filter(isPlainObject).map((finding) => finding.issue),
    );
    for (const round of Array.isArray(rounds) ? rounds.filter(isPlainObject) : []) {
      for (const issue of Array.isArray(round.newFindings) ? round.newFindings : []) {
        if (isPositiveInt(issue) && !knownIssues.has(issue)) {
          errors.push(`rounds: round ${round.round} 的 newFindings #${issue} 未登記在 findings`);
        }
      }
    }
  }

  const clean = tracker.clean;
  if (!isPlainObject(clean)) {
    errors.push("clean: 必須記錄 CLEAN 會計");
  } else {
    if (clean.status !== "CLEAN" && clean.status !== "NOT CLEAN") {
      errors.push(`clean: status 必須是 CLEAN 或 NOT CLEAN：${clean.status}`);
    }
    if (!Number.isInteger(clean.streak) || clean.streak < 0) errors.push("clean: streak 必須是非負整數");
    if (clean.requiredStreak !== CLEAN_REQUIRED_STREAK) {
      errors.push(`clean: requiredStreak 必須等於協議的 ${CLEAN_REQUIRED_STREAK}`);
    }
    if (!isPlainObject(clean.coverage) || clean.coverage.scenarios !== FIXED_PERSONA_IDS.length) {
      errors.push(`clean: coverage.scenarios 必須等於 ${FIXED_PERSONA_IDS.length}`);
    } else if (clean.coverage.of !== clean.coverage.scenarios) {
      errors.push("clean: coverage.of 必須等於 coverage.scenarios");
    }
    if (!Array.isArray(clean.conditions) || clean.conditions.length !== PROTOCOL_CONDITION_COUNT) {
      errors.push(`clean: conditions 必須列出協議的 ${PROTOCOL_CONDITION_COUNT} 個停止條件`);
    } else if (clean.conditions.some((value) => typeof value !== "boolean")) {
      errors.push("clean: conditions 每一項都必須是 boolean");
    } else if (
      typeof clean.status === "string" &&
      clean.conditions.every(Boolean) !== (clean.status === "CLEAN")
    ) {
      errors.push(
        `clean: status=${clean.status} 與 conditions（${clean.conditions.filter(Boolean).length}/${PROTOCOL_CONDITION_COUNT} 成立）不一致`,
      );
    }

    const blocking = blockingFindings(tracker).map((finding) => `#${finding.issue}`);
    if (blocking.length) {
      if (clean.status === "CLEAN") {
        errors.push(`clean: 仍有未結案的適用 finding（${blocking.join("、")}），不得標記 CLEAN`);
      }
      if (clean.streak !== 0) {
        errors.push("clean: 仍有未結案的適用 finding 時 streak 必須為 0");
      }
    } else if (Number.isInteger(clean.streak) && clean.streak >= CLEAN_REQUIRED_STREAK && clean.status !== "CLEAN") {
      errors.push(`clean: 無未結案適用 finding 且 streak 已達 ${CLEAN_REQUIRED_STREAK} 時狀態必須是 CLEAN`);
    }

    if (clean.status === "CLEAN" && Number.isInteger(clean.streak) && clean.streak < CLEAN_REQUIRED_STREAK) {
      errors.push(`clean: CLEAN 需要連續 ${CLEAN_REQUIRED_STREAK} 輪 qualifying CLEAN，目前 streak=${clean.streak}`);
    }

    if (Array.isArray(rounds)) {
      const qualifying = trailingQualifyingRounds(rounds.filter(isPlainObject));
      if (Number.isInteger(clean.streak) && clean.streak !== qualifying) {
        errors.push(`clean: streak（${clean.streak}）與最近連續 qualifying CLEAN round 數（${qualifying}）不一致`);
      }
    }
  }

  return errors;
}
