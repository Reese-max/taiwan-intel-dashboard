# 50-Persona Audit — Round 3

Date: 2026-09-11  
Protocol: `Reese-max/autodev-ng/docs/portfolio-audit/2026-09-06-50-persona-audit.md`

> Fixed 50-persona model simulation plus current default-branch and GitHub Actions evidence review; not 50 human participants. Static evidence is not represented as live/runtime validation.

## Audited revision

Current default branch `main` before this report commit:

`e60ffa079b35cc6d01f4a672242736b5b54c5716`

No product-code remediation has landed after the previous persona report; the head itself is the Round-2 audit-document commit.

## Round 3 result

Status: **P1 #18 INCORPORATED; P1 #17 STILL OPEN — NOT CLEAN**

Round 2 formally tracked the operating-state contradiction in #17. Round 3 separately incorporates the already-actionable summary-integrity fingerprint in #18 into the fixed 50-persona CLEAN accounting.

## P1 #18 — non-empty evidence can be published as `暫無資料` while summary status is green

The current default-branch path remains directly reproducible from source:

1. `scripts/lib/nvidia.mjs::summarize()` retries narrative generation but ultimately maps an empty domestic result to `domestic: dom || "（暫無資料）"` and an empty international result to `international: intl || "（暫無資料）"`.
2. `scripts/fetch-live.mjs` calls `summarize(...)`, writes `summary.json`, then unconditionally sets `status.summary = { ok: true }` whenever the function returns. It does not distinguish usable generated narrative from an empty-result placeholder when event inputs are non-empty.
3. `.github/workflows/pipeline-audit.yml` validates network contract, source freshness, coverage, source health, tests, build, provenance, network quality, risk distribution and data size, but has no semantic/invariant gate for the summary artifact.

This means provider output can degrade without throwing, be converted into a literal no-data statement, and still pass the summary status boundary. For an intelligence dashboard whose top synthesis is used under time pressure, this satisfies the documented P1 criterion: a primary operational user can receive a materially false core-task interpretation despite available evidence.

### Fixed-persona scenarios

The complete fixed matrix was rerun; this root cause is most material to:

- A04 — time-pressured user reading the high-salience brief before details.
- C01/C02 — police/public-sector and analyst users relying on accurate synthesis of source evidence.
- D01/D05 — supervisor and audit/compliance roles relying on green pipeline state.
- E03 — low-confidence/low-literacy user likely to interpret `暫無資料` literally.
- F01 — screen-reader user encountering the summary early in semantic order.
- H05 — new maintainer diagnosing provider versus source failure.
- I04/I05 — provider degradation and partial-success paths.
- J04/J05 — trust-sensitive and expert automation users expecting content/status invariants.

The intended fix is not to invent narrative or hide source failure. Data availability and narrative-generation availability must be separate states. With non-empty evidence, empty/truncated narrative must become an explicit degraded/failed state and either a deterministic, clearly labeled local fallback or a policy-controlled deployment block.

## Runtime / execution evidence boundary

Issue #18 already preserves actual 2026-09-09 execution evidence: GitHub Actions run `34293170321` completed fetch, audit, deploy and post-deploy smoke for a candidate whose pipeline/source evidence was non-empty while both headline briefs were `（暫無資料）` and summary status was green. This is valid evidence of the historical failure mode.

For this Round-3 current-head check, GitHub Actions lists a scheduled `更新資料並部署` run `34544474067` on SHA `e60ffa079b35cc6d01f4a672242736b5b54c5716` as `in_progress` at inspection time. That proves only that the scheduled workflow is still executing on the current head; it is not treated as a success, and it is not used to claim that the exact #18 content mismatch recurred in this run.

No new browser inspection, controlled empty/truncated-provider run or post-fix runtime validation was performed in this round.

## Existing P1 #17

The Round-2 operating-state finding remains a separate blocker. The repository's declared paused/restore state and effective scheduled production control plane still require one authoritative machine-checked contract. The newly observed scheduled current-head workflow run is consistent with #17 remaining unresolved, but #17 is not counted as a new Round-3 fingerprint.

## Required next gates

1. Resolve #18 with a versioned summary-integrity contract that separates source/event availability from narrative status.
2. Add regression fixtures for empty, truncated, malformed, partial and provider-exception outputs over non-empty candidates; impossible combinations such as non-zero evidence plus both `暫無資料` placeholders must fail the audit.
3. Retain actual execution evidence for the degraded path and the intended default/`requireNarrative` policies, including accessible rendered state.
4. Resolve/disposition #17 and retain actual paused/restore/active execution receipts.
5. Re-run the same fixed 50 personas on the remediation default-branch SHA.

## CLEAN accounting

`taiwan-intel-dashboard` remains **NOT CLEAN**. P1 #17 remains open and Round 3 additionally incorporates P1 #18, so the consecutive no-new-P0/P1/P2 counter is **0/2**.

The repository cannot start a CLEAN streak until all P0/P1/P2 blockers are resolved or explicitly dispositioned under the protocol, required current/recent runtime paths have evidence, and a full fixed-persona rerun produces no new P0/P1/P2. Final CLEAN requires a second consecutive qualifying round.