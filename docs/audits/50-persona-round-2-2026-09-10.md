# 50-Persona Audit — Round 2

Date: 2026-09-10
Protocol: `Reese-max/autodev-ng/docs/portfolio-audit/2026-09-06-50-persona-audit.md`

> Fixed 50-persona model simulation plus current default-branch and GitHub Actions evidence review; not 50 human participants.

## Round 2 result

Status: **P1 OPEN — NOT CLEAN**

New fixed-persona finding is mapped to existing Issue #17: the declared operating state and the effective production control plane disagree.

On the current default branch, `README.md` says the service is **paused**, canonical returns HTTP 503, and the automatic updater is disabled. The current `.github/workflows/update-and-deploy.yml` still contains recurring `schedule` triggers and a path that fetches data, updates the pipeline-state branch, audits, deploys to Cloudflare Pages, and performs a post-deploy smoke check.

This is not only a documentation mismatch. GitHub Actions run `34293170321` is actual execution evidence: `fetch / fetch`, `save-state`, `audit / audit`, `deploy`, and `部署後線上 smoke` all completed successfully. This round does not independently claim what a browser currently sees at the canonical URL; it claims only what the checked-in control plane and recorded workflow execution prove.

## Fixed-persona rerun

The same 50 IDs from the portfolio protocol were re-evaluated against the current state. The mismatch materially blocks or misleads these scenarios:

- C01 police/public-sector user: cannot reliably know whether intelligence is paused or being refreshed/published.
- C05 DevOps/SRE: prose says automation is disabled while the workflow control plane remains scheduled and deploy-capable.
- D01 supervisor: the headline status can be wrong relative to actual pipeline activity.
- D02 project manager: restore/pause responsibility and transition evidence are not traceable to one authoritative state.
- D03 IT administrator: cannot safely infer whether production mutation is intentionally enabled.
- D04 cost-sensitive owner: may expect no recurring fetch/LLM/deploy activity during a declared pause.
- D05 compliance/audit role: operating-state evidence is internally contradictory.
- H04 Cloudflare deployer / H05 new maintainer: following README/runbook can produce a different mental model from the actual scheduled workflow.
- I05 partial-success/retry: a restore or accidental reactivation cannot be distinguished from the declared paused state by one machine-checked contract.
- J03 long-running operation / J05 expert automation user: scheduled activity can continue despite the documented stop state.

No distinct additional P0/P1/P2 fingerprint was confirmed in this round after deduplication against current open issues.

## Actionable issue

- #17 — `[P1][RELIABILITY] Make the declared pause/restore state match the production schedule`

Required direction remains: one versioned operating-state contract must drive or verify workflow mutation/deployment behavior, current status text, and restore receipts. A `PAUSED` state must fail closed/skip before production mutation; transition to `ACTIVE` must require and retain actual restore evidence.

## Runtime evidence boundary

**Actual execution evidence:** GitHub Actions run `34293170321` completed the fetch, state-save, audit, Cloudflare Pages deploy, and deployed smoke jobs successfully.

**Not claimed:** this audit did not independently browse the current production UI, did not run a new pause-state workflow fixture, and did not verify a post-fix transition because no #17 remediation has landed on the current default branch.

## CLEAN gate

1. Resolve #17 with one authoritative, machine-checked operating-state contract.
2. Record actual execution evidence for all three relevant states: paused, controlled restore, active scheduled run.
3. Re-run the same fixed 50 personas on the remediation default-branch SHA.
4. Resolve any remaining P0/P1/P2 findings.
5. Require two consecutive no-new-P0/P1/P2 rounds after remediation before `CLEAN`.

Consecutive no-new-P0/P1/P2 count: **0/2** because this round confirms P1 #17.