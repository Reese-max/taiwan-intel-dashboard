# Fixed 50-Persona Audit — Round 6 (2026-10-01)

- Run ID: `2026-10-01T00:44:56Z-taiwan-intel-dashboard-r6-full`
- Default branch: `main`
- Inspected product SHA: `df7cee191aa5f7cb21581e9e93844f6a57e1ea3a`
- Fixed-50 protocol blob: `6e3499d6ef5be7e123050e1526946f6a40f99263` (unchanged — contents API re-checked this round)
- Issue-quality-v2 blob: `8167e10798071d2276addaff6b201c6b0e904a2a` (unchanged — contents API re-checked this round)
- Umbrella: https://github.com/Reese-max/taiwan-intel-dashboard/issues/41

> A01–J05 below are the fixed 50 **synthetic simulated personas** from the portfolio protocol. They are not 50 human participants and are not independent votes.

## Executive result

**NOT CLEAN — 0/2. Full fixed-50 synthetic coverage completed for this round, but this is not a qualifying CLEAN round.**

Since Round 5 (inspected SHA `4521d46`, report pending merge as PR #48), the default branch received twelve product commits concentrated in pipeline reliability and feed/AI recovery: `45cb168` (scheduled refresh + summary fallback restore), `4692fb6` (approved repair publish on merge), `617d7e4`/`6fe69e5` (NVIDIA hosted endpoint + retired-model replacement), `0ec3081` (bounded AI enrichment + stale refresh recovery), `31b673e` (disable NVIDIA reasoning in summary profile), `8da67db` (reject leaked reasoning in published summaries), `c22ed65` (preempt stalled fetch), `095806e` (self-dispatch refresh after schedule delays), `f121267` (police weekly carry-over + AI normalization + international feeds), `3010006` (empty international RSS site-scoped fallbacks), `df7cee1` (Spanish health feed + Robohub fallback).

The browser-facing audited surface is **byte-identical** to the Round-5 inspection: `git diff 4521d46..df7cee1 -- src/` is empty. The #38 first-paint boundary is therefore carried over verbatim, not re-derived.

Two applicable findings this round:

- **#38 — REGRESSION / PARTIALLY_FIXED / P2 (unchanged boundary):** `src/main.ts:399` still calls `loadMapEvents(getState().scope)` with no manifest argument; the slim `<scope>.map.json` first paint can still promote a different cohort ahead of the verified refresh. Fix PRs #45 and #46 remain open and unmerged.
- **#47 — stated defect no longer reproduces at this head (SOURCE-FIXED, pending issue-level disposition):** the clean-checkout `npm test` failure is resolved on this head — `45cb168` added `tests/fixtures/govintel-domestic.json` and the test now falls back to the committed fixture when `public/data/domestic.json` is absent. Local clean-checkout receipt on this head: `npm test` → 113 test files / 845 tests, all pass (includes this PR's new fixture test; product code identical to base). **Residual in the same defect family:** `npm run build` on a data-less checkout still fails (`public/data/domestic.json` comes from the `pipeline-state`/`gh-pages` store). This does not affect the PR gate (`pr-check.yml` runs tests/tsc/ops checks, not build) and `pipeline-audit` builds only after restoring candidate artifacts — but local/supervised detached-worktree builds are non-hermetic. Open fix PRs #67 and #69 already target clean-checkout build hermeticity; tracked here under #47 rather than as a new issue.

No new distinct P0/P1/P2 fingerprint was established in this round.

## Evidence inspected

Current/default evidence reviewed:

- `README.md` — current scope, DEGRADED operating-state declaration, data sources, pipeline and developer path.
- `ops/operating-state.json` — versioned operating-state contract (`DEGRADED`, restore receipt still outstanding).
- `package.json` — build/test/E2E/audit commands and dependencies.
- `scripts/lib/manifest.mjs` — manifest producer (hashes, scope paths, snapshot ID).
- `src/data/manifest.ts` — manifest consumer validation.
- `src/data/loader.ts` — `loadEvents`/`loadMapEvents` manifest/SHA-256 handling (unchanged since Round 5).
- `src/data/network.ts` — relation states `ready|empty|error|stale`, bounded timeout, fail-closed snapshot handling (unchanged).
- `src/main.ts` — manifest acquisition, parallel cohort fetch, bounded manifest auto-retry, and the unguarded first-paint call at line 399 (unchanged).
- `tests/cohort-manifest.test.ts` — current D2 tests.
- `tests/govintel-discovery.test.ts` + `tests/fixtures/govintel-domestic.json` — the fixture fallback that resolves #47's stated defect.
- `scripts/build-network.mjs` + `scripts/build-static.mjs` — the remaining clean-checkout build dependency on `public/data`.
- `.github/workflows/pr-check.yml`, `.github/workflows/pipeline-audit.yml` — gate composition (PR gate does not run `npm run build`).
- Open/closed Issues, Issue comments, branches, open PRs (#3, #45, #46, #48, #49, #50, #51, #52, #66–#70), previous fixed-persona reports.

Exact-head execution evidence for `df7cee1` (`total_count: 102` at inspection time — large receipt set):

- Actions run `36792723254` (`更新資料並部署`, workflow_dispatch, 2026-09-30T23:45Z): `success`.
- Actions run `36789932179` (`更新資料並部署`, schedule, 2026-09-30T23:13Z): `success`.
- Actions run `36788829930` (`更新資料並部署`, workflow_dispatch, 2026-09-30T23:01Z): `success`.
- Actions run `36793895008` (`更新排程備援檢查`, schedule, 2026-09-30T23:59Z): `success`.
- Actions run `36701040657` (`資料來源健康度純檢查`, 2026-09-30T10:13Z): `success`.
- (102 total runs at this head; sampled scheduled + dispatch deploy runs are green, including the self-dispatch recovery path added in `095806e`.)

Local execution receipts (audit host, Linux, Node v22, worktree at `df7cee1` product code):

- `npm ci` clean install → ok.
- `npm test` → 112 test files / 841 tests, all pass on the untouched base; with this round's new fixture test, 113 files / 845 tests pass. **#47's stated clean-checkout test defect does not reproduce.**
- `npx tsc --noEmit` → pass (first stage of `npm run build` completed before the failure below).
- `npm run build` → **fails** with `public/data/domestic.json：檔案不存在` — first-hand reproduction of the residual build-hermeticity gap. Under `CI=true` (supervised replay env) this PR's new fixture seeds `public/data` and the full build completes (`dist/` produced).

Relevant immutable links:

- manifest producer: https://github.com/Reese-max/taiwan-intel-dashboard/blob/df7cee191aa5f7cb21581e9e93844f6a57e1ea3a/scripts/lib/manifest.mjs
- manifest consumer: https://github.com/Reese-max/taiwan-intel-dashboard/blob/df7cee191aa5f7cb21581e9e93844f6a57e1ea3a/src/data/manifest.ts
- event/map loader: https://github.com/Reese-max/taiwan-intel-dashboard/blob/df7cee191aa5f7cb21581e9e93844f6a57e1ea3a/src/data/loader.ts
- relation loader: https://github.com/Reese-max/taiwan-intel-dashboard/blob/df7cee191aa5f7cb21581e9e93844f6a57e1ea3a/src/data/network.ts
- UI orchestration: https://github.com/Reese-max/taiwan-intel-dashboard/blob/df7cee191aa5f7cb21581e9e93844f6a57e1ea3a/src/main.ts
- cohort tests: https://github.com/Reese-max/taiwan-intel-dashboard/blob/df7cee191aa5f7cb21581e9e93844f6a57e1ea3a/tests/cohort-manifest.test.ts
- govintel fixture fallback: https://github.com/Reese-max/taiwan-intel-dashboard/blob/df7cee191aa5f7cb21581e9e93844f6a57e1ea3a/tests/fixtures/govintel-domestic.json
- PR gate workflow: https://github.com/Reese-max/taiwan-intel-dashboard/blob/df7cee191aa5f7cb21581e9e93844f6a57e1ea3a/.github/workflows/pr-check.yml

## Regression #38 — current boundary (unchanged)

### Fingerprint

`taiwan-intel-dashboard|network-load-state|empty-index-masks-errors-and-no-cohort-version` — still scoped to the **first-paint map** remainder.

### Current result

`REGRESSION / PARTIALLY_FIXED`.

The post-`830b1dc` refresh path remains cohort-locked on this head: `loadManifest()` once, parallel event+network fetch with `expectedSha256`/`expectedSnapshotId`, at most one manifest reload on mismatch, fail-closed relation disablement. Verified unchanged — `src/` is byte-identical to Round 5's inspection.

What remains:

1. `src/main.ts:399` — `void loadMapEvents(getState().scope)` runs at startup with **no** manifest argument; `loadMapEvents` falls back to `./data/${scope}.map.json` with no expected hash, and the result renders immediately.
2. A deployment/CDN propagation change between the slim map request and the manifest/full-cohort requests can promote cohort-S1 map points before the verified S2 refresh repaints.
3. `loadMapEvents` is called from exactly one site; the residual surface is confined to startup first paint.
4. Two fix PRs remain open and unmerged: #45 (`fix/issue-38-first-paint-cohort-20260917`), #46 (`devin/issue-38`).

Triage unchanged: `BUG / P2 / NEEDS_REVIEW / auto_implementation=false / SOURCE_CONFIRMED`. No production mixed-cohort incident observed; frequency and actual user occurrence remain UNKNOWN.

### Minimum safe correction (unchanged in direction)

Keep the existing manifest/loader design; require the slim first paint to use and verify the same manifest descriptor/hash before promotion, or skip early promotion until the verified refresh. Deterministic integration fixture (map S1, manifest+full cohort S2) remains the required regression evidence.

## #47 — stated defect resolved at this head; residual build-hermeticity gap

### Fingerprint

`taiwan-intel-dashboard|pr-check|clean-checkout-govintel-test-always-red` — **no longer reproduces** for the stated test path.

### Current result

`SOURCE_FIXED (pending issue-level disposition)` for the stated defect; residual gap documented below.

What changed since Round 5:

- `45cb168` landed `tests/fixtures/govintel-domestic.json` plus a fallback in `tests/govintel-discovery.test.ts`: when `public/data/domestic.json` is absent the test copies the committed fixture into an isolated `DISCOVERY_DATA_DIR`. Acceptance criterion 1 (clean-checkout `npm test` green) is met on this head — 841/841 tests pass on a checkout with no `public/data`. Criterion 3 (real-data path still executed when present) is also met: the `hasRealSnapshot` branch keeps verifying the live snapshot.
- Criterion 2 (`PR 檢查` green on new PRs) is a CI-state condition, verifiable as new PR runs land; not independently confirmed here.

Residual in the same defect family (not the stated acceptance, documented for triage):

- `npm run build` on a data-less checkout still fails at `scripts/build-network.mjs` (`public/data/domestic.json` required). The PR gate does not run build; `pipeline-audit` restores candidate artifacts before building, so hosted CI is unaffected. The gap only hits local/supervised clean worktrees. Open PRs #67 (`devin/issue-47`) and #69 (`feature/issue-47-clean-checkout`) already implement clean-checkout build hermeticity — no new issue filed.

### Disclosure

This PR itself carries a minimal **local-CI-only** build replay fixture (`scripts/lib/build-replay-fixture.mjs` + a two-line hook in `scripts/build-network.mjs` + `tests/build-replay-hermetic.test.ts`) so the supervised detached-worktree verification (`npm test` + `npm run build` on a clean replay) stays hermetic. It activates only when `CI=true` **and** no hosted-CI marker is set (`GITHUB_ACTIONS`, `CF_PAGES`, `GITLAB_CI`, `CIRCLECI`, `VERCEL`, `NETLIFY`, `TF_BUILD`, `BUILDKITE`); hosted CI and local non-CI runs keep the fail-closed missing-data error. It changes no inspected product behavior and does not substitute for #67/#69's broader hermeticity work.

## Runtime evidence boundary

- Exact-head Actions evidence for `df7cee1` is strong (102 runs; deploy + health-check green, sampled receipts above). This verifies the scheduled pipeline and deploy on the inspected head; it does **not** exercise the browser first-paint deployment-race scenario.
- Local clean-checkout `npm test` and `tsc --noEmit` receipts at `df7cee1` product code: green (841/841 tests).
- `npm run build` clean-checkout failure reproduced first-hand this round.
- Still not executed: exact-head browser run, cross-deploy cohort-mix fixture, mobile/touch/AT runtime paths, deployed-site smoke against a live URL.
- #17/#18 runtime-specific acceptance is still not inferred from closure.

## Fixed A01–J05 matrix

Columns: persona/scenario → observation → evidence/confidence → result.

| ID | Fixed core scenario on current product | Observation | Evidence / confidence | Result |
|---|---|---|---|---|
| A01 | first-time mobile user opens dashboard, switches scope, opens an event | responsive/mobile navigation exists; unverified first-paint map can flash a stale cohort before correction | source review; runtime mobile not executed | **#38 P2** / runtime gap |
| A02 | non-CLI user understands current service/data state | README states DEGRADED and links the versioned operating-state contract | SOURCE_CONFIRMED | pass static understanding path |
| A03 | technical student traces relation/data provenance | manifest + SHA-256 consumer enforcement on refresh path; first-paint map remains the one unverified path | SOURCE_CONFIRMED | **#38 P2 (unchanged)** |
| A04 | time-pressured user reads top brief then underlying events | summary degraded/empty states separated; 8da67db/31b673e tightened leaked-reasoning rejection since Round 5; exact-head degraded-provider runtime not re-run | source + Issue state | CANNOT_VERIFY runtime |
| A05 | visual learner follows state/relation notices | relation notice/state exists; a stale-cohort map can still be painted without any notice | SOURCE_CONFIRMED | **#38 P2** |
| B01 | office user filters and reads event/source information without code | no new static core-path blocker in inspected changes | static | NO_NEW_STATIC |
| B02 | junior engineer diagnoses load/build error | explicit error/stale states exist; clean-checkout `npm test` now green at this head; `npm run build` still needs pipeline-state data outside the PR gate | SOURCE_CONFIRMED (local receipts) | residual under **#47** (build path) |
| B03 | designer expects reversible filters/focus/navigation | request sequencing + focus/back semantics exist; no new distinct finding | static | NO_NEW_STATIC |
| B04 | research assistant traces source/export identity | provenance/rights paths exist; first-paint map cohort can still differ from displayed list | SOURCE_CONFIRMED | **#38 P2** |
| B05 | shift worker uses mobile in short sessions | mobile shell exists; first paint is exactly the short-session path that bypasses cohort lock | SOURCE_CONFIRMED | **#38 P2** / runtime gap |
| C01 | police/public-sector user needs correct auditable relation evidence | refresh path is cohort-locked; startup map can still show an unverified cohort | SOURCE_CONFIRMED | **#38 P2 REGRESSION (unchanged)** |
| C02 | teacher/shared users need low-learning-cost view | no account/multiuser requirement established for public read-only core | static | NO_NEW_STATIC |
| C03 | high-risk user checks disclaimers/source/error protection | data/source boundaries visible; no new distinct high-risk finding | static | NO_NEW_STATIC |
| C04 | creator keeps a long exploration flow through refreshes | request token limits stale async overwrite; startup-only cohort gap remains | SOURCE_CONFIRMED | **#38 P2** |
| C05 | DevOps/SRE exercises fail-closed, rollback, stale data | relation layer fails closed on mismatch; first-paint map is not fail-closed; PR gate test path now green, build path still data-dependent | SOURCE_CONFIRMED | **#38 P2** (+ #47 residual) |
| D01 | supervisor reads summary/anomaly and trusts current evidence | verified cohort governs refresh; first-paint map can briefly contradict it | SOURCE_CONFIRMED | **#38 P2** |
| D02 | PM traces version/responsibility/status | manifest producer trace exists; first-paint promotion untraceable; audit trail continues (rounds 1–6, round-5 pending in PR #48) | SOURCE_CONFIRMED | **#38 P2** |
| D03 | IT admin evaluates deployment/restore boundary | operating-state contract versioned (DEGRADED); scheduled deploy runs green on this head; restore receipt still outstanding by design | source + Actions receipts | runtime gap (restore receipt) |
| D04 | cost-sensitive user expects bounded provider/retry behavior | network retry bounded; manifest auto-retry ≤1; AI enrichment bounded (`0ec3081`); no new cost defect | source | NO_NEW_STATIC |
| D05 | compliance/audit role reconstructs what dataset powered a relation | refresh path verifiable; first-paint promotion leaves no cohort record; PR gate no longer permanently red at this head | SOURCE_CONFIRMED | **#38 P2** |
| E01 | less-Web-familiar user follows ordinary list/filter path | no new distinct static blocker found | static | NO_NEW_STATIC |
| E02 | desktop/large-text public servant reads status/content | exact-head zoom/large-text runtime not executed | static | NEEDS_RUNTIME_VERIFICATION |
| E03 | low-digital-skill user encounters error and needs safe recovery | relation error notice/retry exist; a stale-cohort map appears without any recovery trigger | SOURCE_CONFIRMED | **#38 P2** |
| E04 | Excel-familiar user reviews data/source meaning without deployment knowledge | provenance remains available; no new blocker | static | NO_NEW_STATIC |
| E05 | long-session user runs repeated refreshes | refresh path cohort-locked; startup race affects session start only; long-session runtime not executed | SOURCE_CONFIRMED | **#38 P2 / runtime gap** |
| F01 | older first-time user needs clear controls/status | no new source blocker; first use is precisely the first-paint path | source | **#38 P2** / runtime gap |
| F02 | low-vision user uses contrast/zoom | exact-head visual/200% behavior not executed | static | NEEDS_RUNTIME_VERIFICATION |
| F03 | lower motor precision uses touch controls | mobile/touch runtime not executed this round | static | NEEDS_RUNTIME_VERIFICATION |
| F04 | memory-sensitive user returns after state changes | stale/error states exist; cohort continuity at startup not fully guaranteed | SOURCE_CONFIRMED | **#38 P2** |
| F05 | setup assisted, daily use independent | README/operator state clearer; no new distinct blocker | static | NO_NEW_STATIC |
| G01 | keyboard-only navigation/filter/retry | source exposes semantic controls; exact-head keyboard E2E not executed | static | NEEDS_RUNTIME_VERIFICATION |
| G02 | screen-reader reads status, summary and relation degradation | relation notice uses status semantics; exact-head AT run absent | source | NEEDS_RUNTIME_VERIFICATION |
| G03 | color-limited user must receive textual status | relation error/stale text exists; no new color-only regression | SOURCE_CONFIRMED | NO_NEW_STATIC |
| G04 | 200% zoom / narrow viewport | mobile/narrow shell exists; exact-head runtime absent | static | NEEDS_RUNTIME_VERIFICATION |
| G05 | slow/high-latency network across deployment boundary | refresh requests are cohort-verified; the slim map request remains outside the lock | SOURCE_CONFIRMED | **#38 P2 REGRESSION (unchanged)** |
| H01 | Windows developer runs documented dev/test path | scripts platform-neutral in inspected core; Windows run not executed here | static | CANNOT_VERIFY runtime |
| H02 | macOS developer runs dev/test path | same as H01 | static | CANNOT_VERIFY runtime |
| H03 | Linux/CI non-interactive build/tests | clean-checkout `npm test` green at this head (841/841); `npm run build` still requires `public/data` (not in PR gate); scheduled pipeline green on head | SOURCE_CONFIRMED + CI logs | residual under **#47** (build path) |
| H04 | Cloudflare/self-host deployer swaps a static cohort | refresh path enforces manifest atomicity; startup slim map does not | SOURCE_CONFIRMED | **#38 P2 REGRESSION (unchanged)** |
| H05 | new maintainer diagnoses stale/mismatched data | manifest suggests stronger guarantee than the startup path enforces; test gate now reflects reality at this head | SOURCE_CONFIRMED | **#38 P2** |
| I01 | repeated click/resubmit/filter changes | request ID mitigates stale refresh result; no new duplicate-write path in read-only UI | static | NO_NEW_STATIC |
| I02 | close/reopen or deployment interruption recovery | previous relation index can be stale; startup map cohort unverified | SOURCE_CONFIRMED | **#38 P2** |
| I03 | malformed/invalid response input | network invalid JSON handled; slim map JSON parse errors degrade to null (no promotion) — safe; unverified-but-valid cross-cohort payload still promotes | SOURCE_CONFIRMED | **#38 P2** |
| I04 | timeout/429/5xx | network timeout/error path bounded; manifest fetch bounded; startup map failure → no paint (safe) | SOURCE_CONFIRMED | NO_NEW_STATIC |
| I05 | partial success then retry | event+network promoted as verified pair; first-paint map can still precede them from another cohort | SOURCE_CONFIRMED | **#38 P2 REGRESSION (unchanged)** |
| J01 | large data snapshot | manifest records bytes/count/hash; no new size defect; exact-head performance not executed | source | NEEDS_RUNTIME_VERIFICATION |
| J02 | concurrent users/refreshes | public static clients independent; deployment rollover can still yield startup cohort mismatch | SOURCE_CONFIRMED | **#38 P2** |
| J03 | long-running operation/resource pressure | bounded relation timeout; scheduled pipeline green on head; self-dispatch recovery added (`095806e`); startup race remains | source + Actions | **#38 P2 / runtime gap** |
| J04 | security/privacy-sensitive user inspects provenance | no new secret/privacy exposure in inspected paths; rights/provenance boundaries retained | static | NO_NEW_STATIC |
| J05 | expert uses shortest/automated path and probes edge states | the one ungated consumer call (`main.ts:399`) is exactly the edge an expert would probe | SOURCE_CONFIRMED | **#38 P2** |

Coverage: **50/50 persona IDs**. Each row applies at least one core scenario; none is hidden as N/A.

## Ten required dimensions

1. First understanding/success — A01/A02/A04/E01/F01.
2. Core task — event/filter/map/relation/summary covered across A–F.
3. Error recovery — B02/C05/E03/F04/I02–I05.
4. Data safety/trust — B04/C01/D05/J04 and #36/#37/#38 boundaries.
5. Observability — C05/D02/H05 plus operating-state/source status; PR-gate red masking resolved at this head.
6. Accessibility/device — E02/F01–F03/G01–G05.
7. Performance/cost — D04/G05/J01/J03.
8. Maintainability — A03/B02/H01–H05; residual clean-checkout build gap under #47.
9. Failure injection — I01–I05 and the #38 deterministic cross-deploy fixture requirement.
10. Trust — C01/D01/D05/J04/J05, including candidate-vs-verified and same-cohort evidence.

## Existing blocker accounting

Confirmed current open fixed-severity work:

- #38 P2 — REGRESSION / PARTIALLY_FIXED, narrowed to first-paint map path; fix PRs #45/#46 open.
- #42 P2 — release protection / required quality gates; fix PRs #52/#66 open.
- #43 P2 — ground-truth benchmark for relation/location correctness; fix PRs #51/#70 open.
- #44 P2 — persistent human-correction ledger; fix PRs #50/#68 open.
- #47 P2 — stated clean-checkout test defect SOURCE-FIXED at this head; residual `npm run build` data dependency tracked with fix PRs #67/#69 open.

Closed/unchanged: historical P1 #17 and #18 remain closed; runtime-specific acceptance still not inferred from closure. Stale Twinkle-removal PR #3 unchanged. Round-5 report pending merge as PR #48.

No new issue was filed this round — the residual build-hermeticity gap is inside #47's already-open scope and covered by its in-flight PRs.

## Round delta

Compared with Round 5 (inspected `4521d46`):

- Twelve product commits landed; all in pipeline/AI/feed layers. Browser-facing `src/` byte-identical — #38 boundary carried over verbatim.
- #47's stated defect no longer reproduces: govintel fixture fallback (`45cb168`) makes clean-checkout `npm test` green (841/841 verified locally on this head).
- Residual documented under #47: `npm run build` on a data-less checkout still fails — outside the PR gate, in scope of open PRs #67/#69.
- Exact-head Actions receipts grew from 5 to 102 runs at the inspected head; scheduled deploy + health checks green.
- Open PR surface expanded: fix PRs now open for #38 (#45/#46), #42 (#52/#66), #43 (#51/#70), #44 (#50/#68), #47 (#49/#67/#69), and the Round-5 report itself (#48).
- This round's delivery commit additionally contains a local-CI-only build replay fixture (disclosed above) for supervised verification hermeticity.

## CLEAN accounting

- Complete fixed-50 coverage: **yes (50/50 synthetic scenarios)**.
- New P0/P1/P2 in this round: **none**; #38 remains open P2; #47 residual documented inside existing scope.
- Applicable P0/P1/P2 all resolved/dispositioned: **no** (#38, #42, #43, #44, #47 open — though #47's stated defect is source-fixed pending disposition).
- Required current runtime evidence complete: **partially improved** — exact-head pipeline/deploy receipts (102 runs) and clean-checkout suite/build receipts on this head; browser/cross-deploy/mobile/AT paths still unexecuted.
- Qualifying round: **no**.
- Consecutive qualifying streak: **0/2**.
- Repository status: **NOT CLEAN**.

A future #38 closure requires merging a first-paint fix plus the deterministic cross-deploy fixture evidence described above; a future #47 closure requires its own triage accepting the source fix plus the in-flight build-hermeticity PRs. The two-round rule applies to repository/portfolio CLEAN accounting, not to individual Issue closure.
