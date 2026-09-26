# Fixed 50-Persona Audit — Round 5 (2026-09-17)

Run ID: `2026-09-17T16:14:52Z-taiwan-intel-dashboard-r5-full`  
Default branch: `main`  
Inspected product SHA: `4521d46411a2944fea446ce90f6f83ab3506a0f0`  
(product code identical to `29a45b339ee257383073717105391757cd55ae70`; head delta is the audit-document commit only)  
Fixed-50 protocol blob: `6e3499d6ef5be7e123050e1526946f6a40f99263`  
Issue-quality-v2 blob: `8167e10798071d2276addaff6b201c6b0e904a2a`  
Umbrella: https://github.com/Reese-max/taiwan-intel-dashboard/issues/41

> A01–J05 below are the fixed 50 **synthetic simulated personas** from the portfolio protocol. They are not 50 human participants and are not independent votes.

## Executive result

**NOT CLEAN — 0/2. Full fixed-50 synthetic coverage completed for this round, but this is not a qualifying CLEAN round.**

Since Round 4 (inspected SHA `44eb775`), the default branch received the remediation package: `d092277` (#37 geo precision/role policy), `830b1dc` (#38 cross-deploy SHA-256 + fail-closed cohort matching), `e7f96a6` (#36 B2 source identity + transitive collapse constraint), `29a45b3` (#39 in-site place exploration + focus/filter interaction), and the targeted #38 post-fix re-verification document `4521d46`. #36 and #37 are now closed.

Two applicable blockers remain source-reproducible on this head, plus one new distinct P2 fingerprint established this round:

- **#38 — REGRESSION / PARTIALLY_FIXED / P2 (narrowed):** the refresh path now locks a `CohortManifest` and SHA-256-verifies event/network payloads before promotion, with one bounded manifest reload on mismatch and fail-closed relation disablement. The **map first-paint** at `src/main.ts:399` still calls `loadMapEvents(getState().scope)` with no manifest argument, so a slim `<scope>.map.json` from a different cohort can be promoted ahead of the verified refresh. Two competing fix PRs are open (#45, #46); neither is merged.
- **#47 — NEW / P2:** the `PR 檢查` quality gate is permanently red on clean checkouts. `tests/govintel-discovery.test.ts > 真實 domestic.json 產出符合 schema 的 feed` shells out to `scripts/govintel-discovery.mjs`, which requires `public/data/domestic.json`; `public/data/` is gitignored (state store lives on `gh-pages`), so every clean-checkout `npm test` fails on this single test. All four most recent `PR 檢查` runs failed on exactly this test, and the failure was reproduced locally on this head.

No production mixed-cohort incident was observed; frequency and actual user occurrence of the #38 first-paint path remain UNKNOWN.

## Evidence inspected

Current/default evidence reviewed:

- `README.md` — current scope, DEGRADED operating-state declaration, data sources, pipeline and developer path.
- `ops/operating-state.json` — versioned operating-state contract (`DEGRADED`, restore receipt outstanding).
- `package.json` — build/test/E2E/audit commands and dependencies.
- `scripts/lib/manifest.mjs` — manifest producer (hashes, scope paths, snapshot ID).
- `src/data/manifest.ts` — manifest consumer validation (version + non-empty snapshotId + per-scope file descriptors + files table).
- `src/data/loader.ts` — `loadEvents`/`loadMapEvents` SHA-256 verification when `manifest`/`expectedSha256` supplied; silent-null fallback otherwise.
- `src/data/network.ts` — relation states `ready|empty|error|stale`, bounded timeout, fail-closed on missing/mismatching `snapshotId` when expected.
- `src/main.ts` — manifest acquisition, parallel cohort fetch, single bounded manifest auto-retry, request sequencing, and the unguarded first-paint call at line 399.
- `tests/cohort-manifest.test.ts` — current D2 tests (manifest generation/readability; no cross-deploy consumer-promotion fixture).
- `tests/govintel-discovery.test.ts` + `scripts/govintel-discovery.mjs` — the clean-checkout failure boundary.
- `.github/workflows/pr-check.yml`, `.github/workflows/update-and-deploy.yml` — gate composition.
- Open/closed Issues, Issue comments, branches, open PRs (#45, #46, stale #3), previous fixed-persona reports.

Exact-head execution evidence for `4521d46...` (improvement over Round 4, which had `total_count: 0`):

- Actions run `35239076594` (`更新資料並部署`, scheduled, 2026-09-17T15:15Z): fetch → save-state → audit → deploy all `success`.
- Actions run `35209966286` (`更新資料並部署`, scheduled, 2026-09-17T10:20Z): fetch → save-state → audit → deploy all `success`.
- Actions run `35184870949` (`更新資料並部署`): `success`.
- Actions run `35203222033` (`資料來源健康度純檢查`): `success`.
- Actions run `35166169922` (`更新資料並部署`): `success`.
- Local execution receipt (this audit host, Linux, Node v20.19.2, clean worktree of `4521d46`): `npm test` → 106 test files / 813 tests, 812 passed, 1 failed (`govintel-discovery` clean-checkout defect, matching CI); `npx tsc --noEmit` → pass.

Relevant immutable links:

- manifest producer: https://github.com/Reese-max/taiwan-intel-dashboard/blob/4521d46411a2944fea446ce90f6f83ab3506a0f0/scripts/lib/manifest.mjs
- manifest consumer: https://github.com/Reese-max/taiwan-intel-dashboard/blob/4521d46411a2944fea446ce90f6f83ab3506a0f0/src/data/manifest.ts
- event/map loader: https://github.com/Reese-max/taiwan-intel-dashboard/blob/4521d46411a2944fea446ce90f6f83ab3506a0f0/src/data/loader.ts
- relation loader: https://github.com/Reese-max/taiwan-intel-dashboard/blob/4521d46411a2944fea446ce90f6f83ab3506a0f0/src/data/network.ts
- UI orchestration: https://github.com/Reese-max/taiwan-intel-dashboard/blob/4521d46411a2944fea446ce90f6f83ab3506a0f0/src/main.ts
- cohort tests: https://github.com/Reese-max/taiwan-intel-dashboard/blob/4521d46411a2944fea446ce90f6f83ab3506a0f0/tests/cohort-manifest.test.ts
- PR gate workflow: https://github.com/Reese-max/taiwan-intel-dashboard/blob/4521d46411a2944fea446ce90f6f83ab3506a0f0/.github/workflows/pr-check.yml

## Regression #38 — current boundary (narrowed)

### Fingerprint

`taiwan-intel-dashboard|network-load-state|empty-index-masks-errors-and-no-cohort-version` — now scoped to the **first-paint map** remainder.

### Current result

`REGRESSION / PARTIALLY_FIXED`.

What `830b1dc` fixed (retained, verified on this head):

1. `loadEvents`/`loadMapEvents` accept manifest descriptors and verify SHA-256 before returning data.
2. `loadNetwork` fails closed when an expected snapshot is known but the payload lacks/mismatches snapshot or hash identity.
3. `refresh()` loads the manifest once, fetches the event+network cohort pair in parallel, performs at most one manifest reload on mismatch, and disables the relation layer rather than promoting a mixed cohort.

What remains:

4. `src/main.ts:399` — `void loadMapEvents(getState().scope)` runs at startup with **no** manifest argument; `loadMapEvents` then falls back to `./data/${scope}.map.json` with no expected hash, and the result is rendered immediately.
5. A deployment/CDN propagation change between the slim map request and the manifest/full-cohort requests can promote cohort-S1 map points before the verified S2 refresh repaints.
6. `loadMapEvents` is called from exactly one site (line 399); the verified refresh path does not use it, so the residual surface is confined to startup first paint.

This is narrower than the pre-`830b1dc` defect but still violates #38's D2 acceptance condition that event/map/network projections are promoted from one locked snapshot. Triage: `BUG / P2 / NEEDS_REVIEW / auto_implementation=false / SOURCE_CONFIRMED`. Two fix PRs are open and unmerged: #45 (`fix/issue-38-first-paint-cohort-20260917`), #46 (`devin/issue-38`).

### Minimum safe correction (unchanged in direction)

Keep the existing manifest/loader design; require the slim first paint to use and verify the same manifest descriptor/hash before promotion, or skip early promotion until the verified refresh. No new DB, queue, scheduler, or framework. Deterministic browser/integration fixture (map S1, manifest+full cohort S2) remains the required regression evidence.

## New finding #47 — PR quality gate permanently red

### Fingerprint

`taiwan-intel-dashboard|pr-check|clean-checkout-govintel-test-always-red`

### What is broken

`tests/govintel-discovery.test.ts` (`CLI end-to-end > 真實 domestic.json 產出符合 schema 的 feed`) executes `node scripts/govintel-discovery.mjs` when `public/data/govintel-discovery.json` is absent. The script requires `public/data/domestic.json`, but `public/data/` is gitignored — real data lives on the `gh-pages` state branch and is only present where the pipeline generated it. On any clean checkout (CI `ubuntu-latest`, fresh worktree, new maintainer machine) the test therefore fails deterministically.

### Evidence

- `PR 檢查` failures on this exact test, consecutive: run `35113295826` (649 tests, 1 failed), `35141900045` (757/1), `35178980799` (PR #45 head), `35190598353` (PR #46 head, 823/1). Each log: `GOVINTEL_DISCOVERY_ERROR missing input: .../public/data/domestic.json`.
- Local reproduction on `4521d46`: `npm test` → 812/813 pass, sole failure identical to CI; `npx tsc --noEmit` passes, isolating the defect to this test.
- Prior partial remediation `c8146b7` added "generate feed if missing" but the generator itself needs the same missing input, so clean-checkout failure persists.

### Why P2

High-frequency friction + observability/maintainability: every PR's gate is red regardless of the change, which hides real regressions and trains merge-despite-red behavior. It is also a precondition blocker for #42 — a required-green quality gate cannot be enforced while it is always red. No data loss or core-task outage → not P1.

### Minimum safe correction

Keep the real-data verification path. Give the test a hermetic fixture path (run the discovery script against a fixture `public/data` tree or bundled sample), or split the real-data case into the pipeline job that already downloads candidate artifacts, with an explicit, reasoned skip in the default `npm test` path. Do not delete the real-data assertion. Triage: `BUG / P2 / NEEDS_REVIEW / auto_implementation=false / SOURCE_CONFIRMED` (CI log = runtime-confirmed).

## Runtime evidence boundary

- Exact-head Actions evidence now exists and is green for the pipeline path (fetch/audit/deploy + health check, runs listed above). This verifies the scheduled pipeline and deploy on `4521d46`; it does **not** exercise the browser first-paint deployment-race scenario.
- Local clean-worktree `npm test` execution on `4521d46` reproduced the #47 defect (812/813, sole failure = clean-checkout govtintel test) — this round's direct runtime receipt for the gate finding.
- Still not executed: exact-head browser run, cross-deploy cohort-mix fixture, mobile/touch/AT runtime paths, `npm run build` (requires gitignored candidate data by design; pipeline-audit runs it post-artifact).
- #17/#18 source remediations are not converted into runtime verification merely because their Issues are closed.

## Fixed A01–J05 matrix

Columns: persona/scenario → observation → evidence/confidence → result.

| ID | Fixed core scenario on current product | Observation | Evidence / confidence | Result |
|---|---|---|---|---|
| A01 | first-time mobile user opens dashboard, switches scope, opens an event | responsive/mobile navigation exists; unverified first-paint map can flash a stale cohort before correction | source review; runtime mobile not executed | **#38 P2** / runtime gap |
| A02 | non-CLI user understands current service/data state | README states DEGRADED and links the versioned operating-state contract | SOURCE_CONFIRMED | pass static understanding path |
| A03 | technical student traces relation/data provenance | manifest + SHA-256 consumer enforcement now on refresh path; first-paint map remains the one unverified path | SOURCE_CONFIRMED | **#38 P2 (narrowed)** |
| A04 | time-pressured user reads top brief then underlying events | summary degraded/empty states separated post-#18; exact-head degraded-provider runtime not re-run | source + Issue state | CANNOT_VERIFY runtime |
| A05 | visual learner follows state/relation notices | relation notice/state exists; a stale-cohort map can still be painted without any notice | SOURCE_CONFIRMED | **#38 P2** |
| B01 | office user filters and reads event/source information without code | no new static core-path blocker in inspected changes | static | NO_NEW_STATIC |
| B02 | junior engineer diagnoses load/build error | explicit error/stale states exist; clean-checkout `npm test` now has a permanent red test unrelated to their change | SOURCE_CONFIRMED | **#47 P2** |
| B03 | designer expects reversible filters/focus/navigation | request sequencing + focus/back semantics exist; no new distinct finding | static | NO_NEW_STATIC |
| B04 | research assistant traces source/export identity | provenance/rights paths exist; first-paint map cohort can still differ from displayed list | SOURCE_CONFIRMED | **#38 P2** |
| B05 | shift worker uses mobile in short sessions | mobile shell exists; first paint is exactly the short-session path that bypasses cohort lock | SOURCE_CONFIRMED | **#38 P2** / runtime gap |
| C01 | police/public-sector user needs correct auditable relation evidence | refresh path is cohort-locked; startup map can still show an unverified cohort | SOURCE_CONFIRMED | **#38 P2 REGRESSION (narrowed)** |
| C02 | teacher/shared users need low-learning-cost view | no account/multiuser requirement established for public read-only core | static | NO_NEW_STATIC |
| C03 | high-risk user checks disclaimers/source/error protection | data/source boundaries visible; no new distinct high-risk finding | static | NO_NEW_STATIC |
| C04 | creator keeps a long exploration flow through refreshes | request token limits stale async overwrite; startup-only cohort gap remains | SOURCE_CONFIRMED | **#38 P2** |
| C05 | DevOps/SRE exercises fail-closed, rollback, stale data | relation layer now fails closed on mismatch; first-paint map is not fail-closed; PR gate permanently red | SOURCE_CONFIRMED | **#38 P2 + #47 P2** |
| D01 | supervisor reads summary/anomaly and trusts current evidence | verified cohort governs refresh; first-paint map can briefly contradict it | SOURCE_CONFIRMED | **#38 P2** |
| D02 | PM traces version/responsibility/status | manifest producer trace exists; first-paint promotion remains untraceable; audit trail now includes per-round reports | SOURCE_CONFIRMED | **#38 P2** |
| D03 | IT admin evaluates deployment/restore boundary | operating-state contract versioned (DEGRADED); scheduled deploy runs green on this head; restore receipt still outstanding by design | source + Actions receipts | runtime gap (restore receipt) |
| D04 | cost-sensitive user expects bounded provider/retry behavior | network retry bounded; manifest auto-retry ≤1; no new cost defect | source | NO_NEW_STATIC |
| D05 | compliance/audit role reconstructs what dataset powered a relation | refresh path verifiable post-`830b1dc`; first-paint promotion leaves no cohort record; PR gate red weakens auditability of changes | SOURCE_CONFIRMED | **#38 P2 + #47 P2** |
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
| G05 | slow/high-latency network across deployment boundary | refresh requests are cohort-verified; the slim map request remains outside the lock | SOURCE_CONFIRMED | **#38 P2 REGRESSION (narrowed)** |
| H01 | Windows developer runs documented dev/test path | scripts platform-neutral in inspected core; Windows run not executed here | static | CANNOT_VERIFY runtime |
| H02 | macOS developer runs dev/test path | same as H01 | static | CANNOT_VERIFY runtime |
| H03 | Linux/CI non-interactive build/tests | clean-checkout `npm test` deterministically fails one test (govintel); tsc passes; scheduled pipeline green on head | SOURCE_CONFIRMED + CI logs | **#47 P2** |
| H04 | Cloudflare/self-host deployer swaps a static cohort | refresh path enforces manifest atomicity; startup slim map does not | SOURCE_CONFIRMED | **#38 P2 REGRESSION (narrowed)** |
| H05 | new maintainer diagnoses stale/mismatched data | manifest suggests stronger guarantee than the startup path enforces; permanent red gate misleads new maintainers about test health | SOURCE_CONFIRMED | **#38 P2 + #47 P2** |
| I01 | repeated click/resubmit/filter changes | request ID mitigates stale refresh result; no new duplicate-write path in read-only UI | static | NO_NEW_STATIC |
| I02 | close/reopen or deployment interruption recovery | previous relation index can be stale; startup map cohort unverified | SOURCE_CONFIRMED | **#38 P2** |
| I03 | malformed/invalid response input | network invalid JSON handled; slim map JSON parse errors degrade to null (no promotion) — safe; unverified-but-valid cross-cohort payload still promotes | SOURCE_CONFIRMED | **#38 P2** |
| I04 | timeout/429/5xx | network timeout/error path bounded; manifest fetch bounded at 3s; startup map failure → no paint (safe) | SOURCE_CONFIRMED | NO_NEW_STATIC |
| I05 | partial success then retry | event+network promoted as verified pair; first-paint map can still precede them from another cohort | SOURCE_CONFIRMED | **#38 P2 REGRESSION (narrowed)** |
| J01 | large data snapshot | manifest records bytes/count/hash; no new size defect; exact-head performance not executed | source | NEEDS_RUNTIME_VERIFICATION |
| J02 | concurrent users/refreshes | public static clients independent; deployment rollover can still yield startup cohort mismatch | SOURCE_CONFIRMED | **#38 P2** |
| J03 | long-running operation/resource pressure | bounded relation timeout; scheduled pipeline green on head; startup race remains | source + Actions | **#38 P2 / runtime gap** |
| J04 | security/privacy-sensitive user inspects provenance | no new secret/privacy exposure in inspected paths; rights/provenance boundaries retained | static | NO_NEW_STATIC |
| J05 | expert uses shortest/automated path and probes edge states | the one ungated consumer call (`main.ts:399`) is exactly the edge an expert would probe; permanent-red gate detectable from CI | SOURCE_CONFIRMED | **#38 P2 + #47 P2** |

Coverage: **50/50 persona IDs**. Each row applies at least one core scenario; none is hidden as N/A.

## Ten required dimensions

1. First understanding/success — A01/A02/A04/E01/F01.
2. Core task — event/filter/map/relation/summary covered across A–F.
3. Error recovery — B02/C05/E03/F04/I02–I05.
4. Data safety/trust — B04/C01/D05/J04 and #36/#37/#38 boundaries.
5. Observability — C05/D02/H05 plus operating-state/source status; #47 gate-red masking.
6. Accessibility/device — E02/F01–F03/G01–G05.
7. Performance/cost — D04/G05/J01/J03.
8. Maintainability — A03/B02/H01–H05; #47 clean-checkout test defect.
9. Failure injection — I01–I05 and the #38 deterministic cross-deploy fixture requirement.
10. Trust — C01/D01/D05/J04/J05, including candidate-vs-verified and same-cohort evidence.

## Existing blocker accounting

Confirmed current open fixed-severity work:

- #38 P2 — REGRESSION / PARTIALLY_FIXED, narrowed to first-paint map path; fix PRs #45/#46 open.
- #42 P2 — release protection / required quality gates (precondition-blocked by #47).
- #43 P2 — ground-truth benchmark for relation/location correctness.
- #44 P2 — persistent human-correction ledger.
- #47 P2 — NEW this round: clean-checkout test defect keeping `PR 檢查` permanently red.

Closed since Round 4: #36 (B2 landed), #37. Historical P1 #17 and #18 remain closed; runtime-specific acceptance still not inferred from closure. Stale Twinkle-removal PR #3 unchanged.

## Issue-quality gate for #47

- **Who is affected:** every contributor whose PR gate is red regardless of change; maintainers relying on `PR 檢查` as a signal; #42's required-gate objective.
- **Concrete failure:** deterministic `npm test` failure on clean checkout (gitignored `public/data/domestic.json`), reproduced locally and in 4 consecutive CI runs.
- **Existing alternative:** none — the gate cannot be green until the test is made hermetic or relocated.
- **Consequence if unchanged:** gate loses all discriminative power; real regressions blend into a permanently red signal; required-gate policy (#42) is unimplementable.
- **Minimum correction:** hermetic fixture or artifact-gated job for the real-data test; explicit reasoned skip in default path; keep real-data verification where data exists.
- **Complexity control:** no new service, DB, or CI platform; test-infrastructure fix only.

The finding satisfies Evidence, Distinctness, Actionability, Impact, Acceptance Criteria, Duplicate Check and Confidence gates; filed as new Issue #47 (no existing issue covers it — #42 is branch-protection policy, a distinct root cause).

## Round delta

Compared with Round 4:

- #36 and #37 source fixes landed and are closed.
- #38 narrowed from "event/map/network all unverified" to "startup slim-map only unverified"; same fingerprint, still REGRESSION / PARTIALLY_FIXED; two fix PRs in flight.
- #42/#43/#44 opened (release protection, GT benchmark, correction ledger) — now counted in applicable blockers.
- #47 NEW: PR gate permanently red on clean checkout — the round's one new distinct P2 fingerprint.
- Exact-head Actions evidence changed from `total_count: 0` to 5 successful runs; local suite execution receipt added (812/813 on `4521d46`).

## CLEAN accounting

- Complete fixed-50 coverage: **yes (50/50 synthetic scenarios)**.
- New P0/P1/P2 in this round: **one new distinct fingerprint (#47 P2)**; #38 remains open P2.
- Applicable P0/P1/P2 all resolved/dispositioned: **no** (#38, #42, #43, #44, #47 open).
- Required current runtime evidence complete: **partially improved** — exact-head pipeline/deploy receipts and local suite receipt now exist; browser/cross-deploy/mobile/AT paths still unexecuted.
- Qualifying round: **no**.
- Consecutive qualifying streak: **0/2**.
- Repository status: **NOT CLEAN**.

A future #38 closure requires merging a first-paint fix plus the deterministic cross-deploy fixture evidence described above; the two-round rule applies to repository/portfolio CLEAN accounting, not to individual Issue closure.
