# Fixed 50-Persona Audit — Tracker (umbrella #41)

Umbrella for the fixed A01–J05, 50 synthetic-persona audit of this repository.

- Umbrella issue: https://github.com/Reese-max/taiwan-intel-dashboard/issues/41
- Protocol: [`Reese-max/autodev-ng/docs/portfolio-audit/2026-09-06-50-persona-audit.md`](https://github.com/Reese-max/autodev-ng/blob/6e3499d6ef5be7e123050e1526946f6a40f99263/docs/portfolio-audit/2026-09-06-50-persona-audit.md) (blob `6e3499d6ef5be7e123050e1526946f6a40f99263`)
- Issue-quality gate: [`Reese-max/autodev-ng/docs/portfolio-audit/2026-09-14-issue-quality-v2.md`](https://github.com/Reese-max/autodev-ng/blob/8167e10798071d2276addaff6b201c6b0e904a2a/docs/portfolio-audit/2026-09-14-issue-quality-v2.md) (blob `8167e10798071d2276addaff6b201c6b0e904a2a`)
- Machine check: `npm run audit:tracker` (contracts live in `scripts/lib/audit-tracker.mjs`)

> A01–J05 are the protocol's fixed 50 **synthetic simulated personas**. They are not 50 human
> participants and not independent votes. Static source review is never reported as runtime evidence.

## Scope of this tracker

This file is audit coordination only. It links rounds and findings and keeps the CLEAN accounting
honest. It is not 50 human tests, it is not an implementation authorization, and it grants no
merge, deploy, or paid-provider permission. Each round report stays immutable; every new round uses
a new report path.

The tracker carries no audit fix. The change that introduced it did also make `npm run build`
hermetic on a clean checkout (`scripts/lib/build-replay-fixture.mjs`, `CI=true` or an explicit
`BUILD_REPLAY_FIXTURE=1`, never on hosted CI) — that is the verification prerequisite behind #47's
residual scope, not a fix for any finding above, and the same gap is tracked by #67/#69.

## Round index

| Round | Date | Inspected product SHA | On default branch | Report | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | 2026-09-06 | not recorded by the report | yes | [`50-persona-round-1-2026-09-06.md`](50-persona-round-1-2026-09-06.md) | NOT CLEAN (static review pass; repository intentionally paused) |
| 2 | 2026-09-10 | not recorded by the report | yes | [`50-persona-round-2-2026-09-10.md`](50-persona-round-2-2026-09-10.md) | NOT CLEAN (P1 #17 mapped) |
| 3 | 2026-09-11 | `e60ffa079b35cc6d01f4a672242736b5b54c5716` | yes | [`50-persona-round-3-2026-09-11.md`](50-persona-round-3-2026-09-11.md) | NOT CLEAN (P1 #18 incorporated) |
| 4 | 2026-09-17 | `44eb775d3fe9e335b34b3e46be2bbffb42c572eb` | yes | [`50-persona-round-4-2026-09-17.md`](50-persona-round-4-2026-09-17.md) | NOT CLEAN (#38 reopened as REGRESSION / PARTIALLY_FIXED) |
| 5 | 2026-09-17 | `4521d46411a2944fea446ce90f6f83ab3506a0f0` | no — PR [#48](https://github.com/Reese-max/taiwan-intel-dashboard/pull/48) | `docs/audits/50-persona-round-5-2026-09-17.md` | NOT CLEAN (new P2 #47) |
| 6 | 2026-10-01 | `df7cee191aa5f7cb21581e9e93844f6a57e1ea3a` | no — PR [#71](https://github.com/Reese-max/taiwan-intel-dashboard/pull/71) | `docs/audits/50-persona-round-6-2026-10-01.md` | NOT CLEAN (no qualifying round) |

Rounds 5 and 6 are complete 50/50 re-verifications but their reports are still **not on the default
branch**, so they do not yet count as merged coverage. Their reviewable content lives in the
referenced PRs; this tracker records their existence so the gap cannot be read as a clean streak.

The last round that is merged coverage (Round 4) inspected `44eb775`. The default branch has since
merged 12 product commits (`45cb168` … `df7cee1`), so no **merged** round has re-verified current
code. Round 5 inspected `4521d46` and Round 6 inspected `df7cee1` (the current default-branch head);
`git diff 4521d46..df7cee1 -- src/` is empty, so the browser-facing audited surface carried over
unchanged between those two rounds. Because both reports are still unmerged, a qualifying round must
repeat that coverage on merged code.

## Findings register

`since` = the round in which the finding was filed (not necessarily the round that lists it in
`newFindings`, which records only that round's *new distinct* fingerprints).

| Issue | Severity | State | First seen | Note |
| --- | --- | --- | --- | --- |
| #17 | P1 | closed | Round 2 | Declared pause/restore state vs. scheduled workflow; source fix merged. Runtime acceptance is not inferred from closure. |
| #18 | P1 | closed | Round 3 | Empty AI brief published as `暫無資料`; source fix merged. Runtime acceptance is not inferred from closure. |
| #36 | P2 | closed | Round 4 | Candidate vs. verified correlation separated; closed by source change. |
| #37 | P2 | closed | Round 4 | Location precision/role policy for geo clustering; closed by source change. |
| #38 | P2 | regression | Round 4 | REGRESSION / PARTIALLY_FIXED. D1 present; D2 same-cohort promotion still incomplete — `src/main.ts` first-paint `loadMapEvents(scope)` takes no manifest, so an unverified slim cohort can be promoted before the verified refresh. Fix PRs #45/#46 open. |
| #42 | P2 | open | Round 5 | Protected branches must gate on the full quality gate; blocks release-path trust. |
| #43 | P2 | open | Round 5 | Relation/location ground-truth benchmark to measure mis-linking and missed links. |
| #44 | P2 | open | Round 5 | Human correction ledger must survive pipeline rebuilds. |
| #47 | P2 | open | Round 5 | NEW in Round 5. Round 6 re-check: the reported clean-checkout `npm test` defect is **source-fixed** at `df7cee1` (`45cb168` added `tests/fixtures/govintel-domestic.json` fallback); what remains is `npm run build` hermeticity without pipeline-state data, tracked by #67/#69. |

Every independent actionable P0/P1/P2 root cause lives in its own issue. This umbrella only links
rounds and findings; it never carries a fix.

## CLEAN accounting

The protocol allows `CLEAN` only when **all** of the following hold. Current state, per condition:

| # | Protocol stop condition | Met | Evidence / gap |
| --- | --- | --- | --- |
| 1 | All applicable P0/P1/P2 resolved or explicitly dispositioned | no | #38, #42, #43, #44, #47 open. |
| 2 | Full 50-persona re-run against the latest default-branch SHA | no | Last merged round inspected `44eb775`; head is `df7cee1`. Rounds 5/6 exist only in open PRs. |
| 3 | No new reproducible problem in statically verifiable items | no | #38 remains source-reproducible at the latest inspected head. |
| 4 | Required runtime evidence (core happy path, error paths, mobile/CLI path) complete | no | Round 6 recorded Actions/deploy receipts at `df7cee1`, but no browser happy-path / error-path / narrow-screen receipt, and the #38 cross-deploy cohort promotion scenario was never executed. |
| 5 | Two consecutive rounds with no new P0/P1/P2 | no | Qualifying streak **0/2**. |

**Repository status: NOT CLEAN — streak 0/2.**

`NO_CHANGE`, partial review, issue closure alone, and audit-only commits do not advance the streak.
Claiming `CLEAN` is only valid with zero blocking findings and a streak of two qualifying rounds;
`npm run audit:tracker` fails closed if the machine-readable accounting below says otherwise.

## Tracking rules

1. `one-finding-per-issue` — each independent actionable P0/P1/P2 root cause stays in its own issue;
   this umbrella only links rounds and findings.
2. `implementation-not-authorized` — new issues default to `auto_implementation=false`;
   implementation requires separate authorization and triage readiness.
3. `runtime-claims-need-receipts` — runtime claims require actual local/CI/deployed execution receipts
   tied to the tested SHA or version.
4. `immutable-round-reports` — historical audit reports are never edited; each round uses a new
   report path.

## What the next qualifying round requires

- #38 fixed on the default branch with a regression test for the cross-deploy cohort scenario, and
  the first-paint map load locked to the verified cohort manifest.
- #42, #43, #44, #47 dispositioned (fixed, or explicitly `not_planned` with a reason).
- A new round report at a new path, inspecting the then-current default-branch SHA with all 50
  persona IDs applied, plus the runtime receipts the protocol requires.
- Two consecutive such rounds before `CLEAN` may be claimed.

## Machine-readable accounting

`npm run audit:tracker` parses exactly one ```json audit-tracker``` block from this file and checks
it against `scripts/lib/audit-tracker.mjs`: the fixed 50 persona set, round ordering and report
existence, PR-backed rounds that are not merged, unique findings with valid severity/state, and the
CLEAN streak arithmetic.

```json audit-tracker
{
  "schema": "fixed-50-audit-tracker/1",
  "umbrella": {
    "repo": "Reese-max/taiwan-intel-dashboard",
    "issue": 41
  },
  "protocol": {
    "repo": "Reese-max/autodev-ng",
    "path": "docs/portfolio-audit/2026-09-06-50-persona-audit.md",
    "blob": "6e3499d6ef5be7e123050e1526946f6a40f99263"
  },
  "protocolIssueQuality": {
    "repo": "Reese-max/autodev-ng",
    "path": "docs/portfolio-audit/2026-09-14-issue-quality-v2.md",
    "blob": "8167e10798071d2276addaff6b201c6b0e904a2a"
  },
  "personas": [
    "A01", "A02", "A03", "A04", "A05",
    "B01", "B02", "B03", "B04", "B05",
    "C01", "C02", "C03", "C04", "C05",
    "D01", "D02", "D03", "D04", "D05",
    "E01", "E02", "E03", "E04", "E05",
    "F01", "F02", "F03", "F04", "F05",
    "G01", "G02", "G03", "G04", "G05",
    "H01", "H02", "H03", "H04", "H05",
    "I01", "I02", "I03", "I04", "I05",
    "J01", "J02", "J03", "J04", "J05"
  ],
  "rules": [
    "one-finding-per-issue",
    "implementation-not-authorized",
    "runtime-claims-need-receipts",
    "immutable-round-reports"
  ],
  "rounds": [
    {
      "round": 1,
      "date": "2026-09-06",
      "report": "docs/audits/50-persona-round-1-2026-09-06.md",
      "inspectedSha": null,
      "inspectedShaNote": "round-1 report records no inspected product SHA; it reviewed the then-current default branch",
      "result": "NOT CLEAN — static review pass while the repository was intentionally paused",
      "onDefaultBranch": true,
      "pr": null,
      "qualifyingClean": false,
      "newFindings": []
    },
    {
      "round": 2,
      "date": "2026-09-10",
      "report": "docs/audits/50-persona-round-2-2026-09-10.md",
      "inspectedSha": null,
      "inspectedShaNote": "round-2 report records no inspected product SHA; it reviewed the then-current default branch",
      "result": "NOT CLEAN — P1 #17 mapped to the existing operating-state issue",
      "onDefaultBranch": true,
      "pr": null,
      "qualifyingClean": false,
      "newFindings": [17]
    },
    {
      "round": 3,
      "date": "2026-09-11",
      "report": "docs/audits/50-persona-round-3-2026-09-11.md",
      "inspectedSha": "e60ffa079b35cc6d01f4a672242736b5b54c5716",
      "result": "NOT CLEAN — P1 #18 incorporated, P1 #17 still open",
      "onDefaultBranch": true,
      "pr": null,
      "qualifyingClean": false,
      "newFindings": [18]
    },
    {
      "round": 4,
      "date": "2026-09-17",
      "report": "docs/audits/50-persona-round-4-2026-09-17.md",
      "inspectedSha": "44eb775d3fe9e335b34b3e46be2bbffb42c572eb",
      "result": "NOT CLEAN — #38 reopened as REGRESSION / PARTIALLY_FIXED, no new distinct fingerprint",
      "onDefaultBranch": true,
      "pr": null,
      "qualifyingClean": false,
      "newFindings": []
    },
    {
      "round": 5,
      "date": "2026-09-17",
      "report": "docs/audits/50-persona-round-5-2026-09-17.md",
      "inspectedSha": "4521d46411a2944fea446ce90f6f83ab3506a0f0",
      "result": "NOT CLEAN — new P2 #47; #38 narrowed to the map first-paint path",
      "onDefaultBranch": false,
      "pr": 48,
      "prUrl": "https://github.com/Reese-max/taiwan-intel-dashboard/pull/48",
      "qualifyingClean": false,
      "newFindings": [47]
    },
    {
      "round": 6,
      "date": "2026-10-01",
      "report": "docs/audits/50-persona-round-6-2026-10-01.md",
      "inspectedSha": "df7cee191aa5f7cb21581e9e93844f6a57e1ea3a",
      "result": "NOT CLEAN — #38 boundary carried over verbatim (src/ identical to Round 5)",
      "onDefaultBranch": false,
      "pr": 71,
      "prUrl": "https://github.com/Reese-max/taiwan-intel-dashboard/pull/71",
      "qualifyingClean": false,
      "newFindings": []
    }
  ],
  "findings": [
    {
      "issue": 17,
      "severity": "P1",
      "state": "closed",
      "title": "Declared pause/restore state contradicted the scheduled deploy workflow",
      "since": 2,
      "note": "source fix merged; runtime-specific acceptance is not inferred from closure"
    },
    {
      "issue": 18,
      "severity": "P1",
      "state": "closed",
      "title": "Empty AI brief publishable as 暫無資料 while summary status stays green",
      "since": 3,
      "note": "source fix merged; runtime-specific acceptance is not inferred from closure"
    },
    {
      "issue": 36,
      "severity": "P2",
      "state": "closed",
      "title": "Candidate vs. verified relation state separated",
      "since": 4
    },
    {
      "issue": 37,
      "severity": "P2",
      "state": "closed",
      "title": "Location precision and place-role policy for geo clustering",
      "since": 4
    },
    {
      "issue": 38,
      "severity": "P2",
      "state": "regression",
      "title": "Relation load failure vs. zero-result, and same-cohort event/map/network promotion",
      "since": 4,
      "note": "REGRESSION / PARTIALLY_FIXED; map first paint still promotes an unverified cohort"
    },
    {
      "issue": 42,
      "severity": "P2",
      "state": "open",
      "title": "Protect main/production behind the full quality gate",
      "since": 5
    },
    {
      "issue": 43,
      "severity": "P2",
      "state": "open",
      "title": "Relation/location ground-truth benchmark",
      "since": 5
    },
    {
      "issue": 44,
      "severity": "P2",
      "state": "open",
      "title": "Persist human corrections across network rebuilds",
      "since": 5
    },
    {
      "issue": 47,
      "severity": "P2",
      "state": "open",
      "title": "Clean-checkout tooling gaps: test defect source-fixed, build still needs pipeline-state data",
      "since": 5,
      "note": "new fingerprint established in round 5; the npm test half was source-fixed at df7cee1 by 45cb168, residual build hermeticity tracked by #67/#69"
    }
  ],
  "clean": {
    "status": "NOT CLEAN",
    "streak": 0,
    "requiredStreak": 2,
    "coverage": {
      "scenarios": 50,
      "of": 50
    },
    "conditions": [false, false, false, false, false]
  }
}
```
