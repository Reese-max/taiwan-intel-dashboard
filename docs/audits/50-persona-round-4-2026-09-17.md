# Fixed 50-Persona Audit — Round 4 (2026-09-17)

Run ID: `2026-09-16T20:25:03Z-taiwan-intel-dashboard-r4-regression`  
Default branch: `main`  
Inspected product SHA: `44eb775d3fe9e335b34b3e46be2bbffb42c572eb`  
Fixed-50 protocol blob: `6e3499d6ef5be7e123050e1526946f6a40f99263`  
Issue-quality-v2 blob: `8167e10798071d2276addaff6b201c6b0e904a2a`  
Umbrella: https://github.com/Reese-max/taiwan-intel-dashboard/issues/41

> A01–J05 below are the fixed 50 **synthetic simulated personas** from the portfolio protocol. They are not 50 human participants and are not independent votes.

## Executive result

**NOT CLEAN — 0/2. Full fixed-50 synthetic coverage completed for this round, but this is not a qualifying CLEAN round.**

Current default branch contains substantial product changes since Round 3, including source fixes for historical P1 #17 and #18 and new geo/network work. The fixed scenarios were therefore re-applied to current source, current Issue state, recent execution evidence, and failure boundaries.

One previously closed P2 was confirmed still source-reproducible under its own acceptance contract:

- **#38 — REGRESSION / PARTIALLY_FIXED / P2**: D1 error-state separation is present, but D2 same-cohort promotion is incomplete. `manifest.json` records event/map/network identity and hashes, yet the browser consumer only uses the manifest snapshot ID to constrain `network.json`; event/map loads remain hard-coded and are not verified against the manifest before promotion. A network response with a missing `snapshotId` is also accepted even when an expected snapshot is known.
- #38 was reopened rather than duplicated: https://github.com/Reese-max/taiwan-intel-dashboard/issues/38

No new distinct P0/P1 fingerprint was established in this round.

## Evidence inspected

Current/default evidence reviewed:

- `README.md` — current product scope, DEGRADED operating-state declaration, data sources, pipeline and developer path.
- `package.json` — build/test/E2E/audit commands and runtime/development dependencies.
- `scripts/lib/manifest.mjs` — manifest producer, hashes, scope paths and snapshot ID.
- `src/data/manifest.ts` — manifest consumer validation.
- `src/data/loader.ts` — event/map fetch path.
- `src/data/network.ts` — relation state, timeout, stale/error behavior, expected-snapshot check.
- `src/main.ts` — manifest acquisition, parallel event/network load, request sequencing, mobile/accessibility shell.
- `tests/cohort-manifest.test.ts` — current D2 tests.
- current open/closed Issues, Issue comments, branches, open PRs, previous fixed-persona reports.
- exact-head Actions query for `44eb775...`: `total_count: 0` at inspection time.

Relevant immutable links:

- manifest producer: https://github.com/Reese-max/taiwan-intel-dashboard/blob/44eb775d3fe9e335b34b3e46be2bbffb42c572eb/scripts/lib/manifest.mjs
- manifest consumer: https://github.com/Reese-max/taiwan-intel-dashboard/blob/44eb775d3fe9e335b34b3e46be2bbffb42c572eb/src/data/manifest.ts
- event/map loader: https://github.com/Reese-max/taiwan-intel-dashboard/blob/44eb775d3fe9e335b34b3e46be2bbffb42c572eb/src/data/loader.ts
- relation loader: https://github.com/Reese-max/taiwan-intel-dashboard/blob/44eb775d3fe9e335b34b3e46be2bbffb42c572eb/src/data/network.ts
- UI orchestration: https://github.com/Reese-max/taiwan-intel-dashboard/blob/44eb775d3fe9e335b34b3e46be2bbffb42c572eb/src/main.ts
- cohort tests: https://github.com/Reese-max/taiwan-intel-dashboard/blob/44eb775d3fe9e335b34b3e46be2bbffb42c572eb/tests/cohort-manifest.test.ts

## Regression #38 — source-confirmed boundary

### Fingerprint

`taiwan-intel-dashboard|network-load-state|empty-index-masks-errors-and-no-cohort-version`

### Current result

`REGRESSION / PARTIALLY_FIXED`.

D1 is present: network loading distinguishes `ready | empty | error | stale`, surfaces failure state, uses a bounded timeout, and supports previous-index degradation.

D2 remains incomplete against the Issue's own acceptance criteria:

1. The producer records file hashes and scope paths in `manifest.json`.
2. `loadManifest()` only validates manifest version and a non-empty snapshot ID.
3. `main.ts` calls `loadEvents(scope)` independently and passes only `expectedSnapshotId` to `loadNetwork()`.
4. `loadEvents` and `loadMapEvents` fetch fixed paths and do not validate the manifest hash/snapshot before promotion.
5. `loadNetwork` rejects mismatch only when the fetched network also contains a truthy `snapshotId`; a missing snapshot ID does not fail closed when an expected one exists.
6. Current cohort tests validate manifest generation/readability but do not execute the required deployment-between-requests cohort-mixing scenario.

This leaves a reachable static path where manifest/network belong to one deployment while event/map payloads belong to another deployment. The round did **not** observe a production mixed-cohort incident; frequency and actual user occurrence remain UNKNOWN.

### Minimum safe correction

Reuse the existing manifest and loaders. No new service/database/state-machine framework is required:

- pass manifest scope descriptors into event/map/network loading;
- validate actual responses against the expected cohort identity/hash before atomically promoting them;
- when expected snapshot is known, treat network responses without snapshot identity as stale/error rather than compatible success;
- on mismatch reload manifest at most once, then retain the previous consistent cohort or disable relation data while preserving independently usable news;
- add a deterministic integration fixture for M2 manifest + M1/M3 event/map/network, missing network snapshot ID, slow response and rapid scope change.

Triage: `BUG / P2 / NEEDS_REVIEW / auto_implementation=false / SOURCE_CONFIRMED`.

## Runtime evidence boundary

No GitHub Actions workflow run was returned for exact SHA `44eb775d3fe9e335b34b3e46be2bbffb42c572eb` during this inspection. The #38 closure comment reports 104 test files / 771 tests and `npm run check`, but no exact-head GitHub Actions receipt is available and the current test file does not cover cross-deploy consumer promotion. Therefore:

- source behavior and test coverage gaps are **SOURCE_CONFIRMED**;
- no production mixed-version occurrence is claimed;
- no exact-head browser, cross-deploy, or accessibility runtime path is marked verified;
- #17/#18 source remediations are not converted into full runtime verification merely because their Issues are closed.

Required safe runtime follow-up for #38: deterministic local/CI integration test first; browser test against an isolated static server that swaps fixture cohorts between requests; no production failure injection required.

## Fixed A01–J05 matrix

Columns: persona/scenario → observation → evidence/confidence → result.

| ID | Fixed core scenario on current product | Observation | Evidence / confidence | Result |
|---|---|---|---|---|
| A01 | first-time mobile user opens dashboard, switches scope, opens an event | responsive/mobile navigation exists; no new static blocker found | source review; runtime mobile not re-executed | NO_NEW_STATIC / runtime gap |
| A02 | non-CLI user understands current service/data state | README states DEGRADED and links operating-state contract | SOURCE_CONFIRMED | pass static understanding path |
| A03 | technical student traces relation/data provenance | manifest adds hashes/IDs, but consumer enforcement incomplete | SOURCE_CONFIRMED | **#38 P2** |
| A04 | time-pressured user reads top brief then underlying events | historical #18 source path is changed; exact-head degraded-provider runtime not re-run | source + Issue state | CANNOT_VERIFY runtime |
| A05 | visual learner follows state/relation notices | relation notice/state exists; mixed-cohort truth can still undermine the shown relation | SOURCE_CONFIRMED | **#38 P2** |
| B01 | office user filters and reads event/source information without code | no new static core-path blocker identified in inspected changes | static | NO_NEW_STATIC |
| B02 | junior engineer diagnoses load/build error | explicit network error/stale states improve diagnosis; cohort mismatch still incomplete | SOURCE_CONFIRMED | **#38 P2** |
| B03 | designer expects reversible filters/focus/navigation | request sequencing exists; no new distinct finding established | static | NO_NEW_STATIC |
| B04 | research assistant traces source/export identity | current provenance/rights paths exist; relation cohort can still mix versions | SOURCE_CONFIRMED | **#38 P2** |
| B05 | shift worker uses mobile in short sessions | mobile shell exists; exact-head mobile runtime not executed | static | NEEDS_RUNTIME_VERIFICATION |
| C01 | police/public-sector user needs correct auditable relation evidence | different event/network cohorts can be promoted together | SOURCE_CONFIRMED | **#38 P2 REGRESSION** |
| C02 | teacher/shared users need low-learning-cost view | no account/multiuser requirement established for this public read-only core | static | NO_NEW_STATIC |
| C03 | high-risk user checks disclaimers/source/error protection | data/source boundaries visible; no new distinct high-risk finding established | static | NO_NEW_STATIC |
| C04 | creator keeps a long exploration flow through refreshes | request token limits stale async overwrite, but cohort atomicity remains incomplete | SOURCE_CONFIRMED | **#38 P2** |
| C05 | DevOps/SRE exercises fail-closed, rollback, stale data | network fail states exist; event/map identity is not fail-closed against manifest | SOURCE_CONFIRMED | **#38 P2 REGRESSION** |
| D01 | supervisor reads summary/anomaly and trusts current evidence | relation/cluster interpretation may be built from mixed cohorts | SOURCE_CONFIRMED | **#38 P2** |
| D02 | PM traces version/responsibility/status | manifest producer trace exists but consumer promotion not fully traceable | SOURCE_CONFIRMED | **#38 P2** |
| D03 | IT admin evaluates deployment/restore boundary | #17 source contract landed; exact-current-head controlled runtime receipts not revalidated here | source + Issue closure | CANNOT_VERIFY runtime |
| D04 | cost-sensitive user expects bounded provider/retry behavior | network retry is bounded; no new cost defect established in inspected path | source | NO_NEW_STATIC |
| D05 | compliance/audit role reconstructs what dataset powered a relation | event/map response is not cryptographically/cohort-verified at consumer promotion | SOURCE_CONFIRMED | **#38 P2** |
| E01 | less-Web-familiar user follows ordinary list/filter path | no new distinct static blocker found | static | NO_NEW_STATIC |
| E02 | desktop/large-text public servant reads status/content | exact-head zoom/large-text runtime not executed | static | NEEDS_RUNTIME_VERIFICATION |
| E03 | low-digital-skill user encounters error and needs safe recovery | relation error notice/retry improved; mixed cohort may appear without recovery trigger | SOURCE_CONFIRMED | **#38 P2** |
| E04 | Excel-familiar user reviews data/source meaning without deployment knowledge | no new distinct blocker; provenance remains available | static | NO_NEW_STATIC |
| E05 | long-session user runs repeated refreshes | long-session exact-head runtime not executed; cross-deploy cohort remains relevant | SOURCE_CONFIRMED | **#38 P2 / runtime gap** |
| F01 | older first-time user needs clear controls/status | no new distinct source blocker in inspected changes; browser runtime absent | static | NEEDS_RUNTIME_VERIFICATION |
| F02 | low-vision user uses contrast/zoom | exact-head visual/200% behavior not executed | static | NEEDS_RUNTIME_VERIFICATION |
| F03 | lower motor precision uses touch controls | mobile/touch runtime not executed this round | static | NEEDS_RUNTIME_VERIFICATION |
| F04 | memory-sensitive user returns after state changes | stale/error states exist, but data cohort continuity is not fully guaranteed | SOURCE_CONFIRMED | **#38 P2** |
| F05 | setup assisted, daily use independent | current README/operator state clearer; no new distinct blocker | static | NO_NEW_STATIC |
| G01 | keyboard-only navigation/filter/retry | source exposes semantic controls; exact-head keyboard E2E not executed | static | NEEDS_RUNTIME_VERIFICATION |
| G02 | screen-reader reads status, summary and relation degradation | relation notice uses status semantics; exact-head AT run absent | source | NEEDS_RUNTIME_VERIFICATION |
| G03 | color-limited user must receive textual status | relation error/stale text exists; no new color-only regression established | SOURCE_CONFIRMED | NO_NEW_STATIC |
| G04 | 200% zoom / narrow viewport | mobile/narrow shell exists; exact-head runtime absent | static | NEEDS_RUNTIME_VERIFICATION |
| G05 | slow/high-latency network across deployment boundary | manifest/event/network requests can span deployments without atomic cohort validation | SOURCE_CONFIRMED | **#38 P2 REGRESSION** |
| H01 | Windows developer runs documented dev/test path | npm scripts are platform-neutral enough in inspected core; no current execution receipt here | static | CANNOT_VERIFY runtime |
| H02 | macOS developer runs dev/test path | same as H01 | static | CANNOT_VERIFY runtime |
| H03 | Linux/CI non-interactive build/tests | scripts exist; exact current SHA has no Actions run | source + Actions query | NEEDS_RUNTIME_VERIFICATION |
| H04 | Cloudflare/self-host deployer swaps a static cohort | consumer does not guarantee manifest/event/map/network atomicity | SOURCE_CONFIRMED | **#38 P2 REGRESSION** |
| H05 | new maintainer diagnoses stale/mismatched data | manifest suggests stronger guarantee than consumer actually enforces | SOURCE_CONFIRMED | **#38 P2** |
| I01 | repeated click/resubmit/filter changes | request ID mitigates stale refresh result; no new duplicate-write path in read-only UI | static | NO_NEW_STATIC |
| I02 | close/reopen or deployment interruption recovery | previous relation index can be stale, but event cohort is independently replaced without hash gate | SOURCE_CONFIRMED | **#38 P2** |
| I03 | malformed/invalid response input | network invalid JSON handled; event/map contract/hash validation remains incomplete | SOURCE_CONFIRMED | **#38 P2** |
| I04 | timeout/429/5xx | network timeout/error path is bounded; cross-layer cohort after partial success remains incomplete | SOURCE_CONFIRMED | **#38 P2** |
| I05 | partial success then retry | event success + relation retry can cross versions; no atomic cohort promotion | SOURCE_CONFIRMED | **#38 P2 REGRESSION** |
| J01 | large data snapshot | manifest records bytes/count/hash; no new size defect established; exact-head performance not executed | source | NEEDS_RUNTIME_VERIFICATION |
| J02 | concurrent users/refreshes | public static clients are independent; deployment concurrency can still yield cohort mismatch | SOURCE_CONFIRMED | **#38 P2** |
| J03 | long-running operation/resource pressure | bounded relation timeout exists; long-run current-head evidence absent and deployment rollover remains relevant | source | **#38 P2 / runtime gap** |
| J04 | security/privacy-sensitive user inspects provenance | no new secret/privacy exposure established in inspected D2 path; rights/provenance boundaries retained | static | NO_NEW_STATIC |
| J05 | expert uses shortest/automated path and probes edge states | missing network snapshot ID is accepted despite known expected ID; event/map hash unused | SOURCE_CONFIRMED | **#38 P2 REGRESSION** |

Coverage: **50/50 persona IDs**. Each row applies at least one core scenario; none is hidden as N/A.

## Ten required dimensions

1. First understanding/success — covered by A01/A02/A04/E01/F01.
2. Core task — event/filter/map/relation/summary covered across A–F.
3. Error recovery — B02/C05/E03/F04/I02–I05.
4. Data safety/trust — B04/C01/D05/J04 and #36/#37/#38 boundaries.
5. Observability — C05/D02/H05 plus operating-state/source status.
6. Accessibility/device — E02/F01–F03/G01–G05.
7. Performance/cost — D04/G05/J01/J03.
8. Maintainability — A03/B02/H01–H05.
9. Failure injection — I01–I05 and #38 deterministic cross-deploy fixture requirement.
10. Trust — C01/D01/D05/J04/J05, including candidate-vs-verified and same-cohort evidence.

## Existing blocker accounting

Confirmed current open fixed-severity work includes at least:

- #36 P2 — candidate/verification semantics; B1 landed but Issue retains remaining B2 scope.
- #37 P2 — location role/precision policy for geo clustering.
- #38 P2 — reopened this round as REGRESSION / PARTIALLY_FIXED.

Historical P1 #17 and #18 are closed after source changes on default branch. This report does not reopen them because their original source fingerprints were not re-established; however, their runtime-specific acceptance is not treated as independently verified for current SHA merely from closure.

No existing open PR was found for #38. The only open PR observed is stale Twinkle-removal PR #3, which was not modified. Existing branches belonging to other work were not treated as authorization to change #38.

## Issue-quality gate for #38 regression

- **Who is affected:** users and operators relying on relation/cluster provenance during deploy rollover or slow network conditions.
- **Concrete failure:** event/map payload can be from a different cohort than the manifest/network payload without detection.
- **Existing alternative:** user can still read individual news/original links; relation layer can be disabled on mismatch once the guard is corrected.
- **Consequence if unchanged:** correlation/cluster interpretation can lose version traceability; exact frequency is unknown.
- **Minimum correction:** consume and enforce the existing manifest identity in existing loaders; no new platform.
- **Complexity control:** explicitly rejects a new database, queue, general transaction framework or monitoring service.

The finding satisfies Evidence, Distinctness, Actionability, Impact, Acceptance Criteria, Duplicate Check and Confidence gates. Because it is the same closed fingerprint, the original #38 was reopened instead of creating a duplicate.

## Round delta

Compared with Round 3:

- #17 operating-state source contradiction is no longer reproduced on current README/source and is closed.
- #18 empty-summary source path has a default-branch remediation and is closed; current exact-head degraded-provider execution was not re-run here.
- #36/#37/#38 introduce/retain current geo/relation trust work.
- #38 closure is invalidated by current-source review of its D2 acceptance contract and is therefore a confirmed regression.
- No exact-head Actions run exists for `44eb775...` at inspection time.

## CLEAN accounting

- Complete fixed-50 coverage: **yes (50/50 synthetic scenarios)**.
- New P0/P1/P2 in this round: **one confirmed regression (#38 P2); no new distinct fingerprint**.
- Applicable P0/P1/P2 all resolved/dispositioned: **no** (#36/#37/#38 currently block).
- Required current runtime evidence complete: **no**.
- Qualifying round: **no**.
- Consecutive qualifying streak: **0/2**.
- Repository status: **NOT CLEAN**.

A future #38 closure requires source fix plus the narrow regression/runtime evidence described above. It does not require two full portfolio rounds to close the individual Issue; the two-round rule applies to repository/portfolio CLEAN accounting.
