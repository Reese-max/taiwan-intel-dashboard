# Fixed 50-Persona targeted post-fix re-verification — Issue #38

- Run ID: `2026-09-16T23:06:29Z-r11-ti38-firstpaint`
- Date: 2026-09-17 (Asia/Taipei)
- Repository: `Reese-max/taiwan-intel-dashboard`
- Default branch: `main`
- Inspected HEAD: `29a45b339ee257383073717105391757cd55ae70`
- Fix under re-verification: `830b1dc518672a2203fdcba1c70140cf0eefa6f8`
- Fixed-50 rules blob: `6e3499d6ef5be7e123050e1526946f6a40f99263`
- Issue Quality v2 blob: `8167e10798071d2276addaff6b201c6b0e904a2a`
- Tracking issue: https://github.com/Reese-max/taiwan-intel-dashboard/issues/38
- Classification: `REGRESSION / PARTIALLY_FIXED / BUG / P2`
- Confidence: `CONFIRMED`
- Evidence level: `SOURCE_CONFIRMED`
- Runtime reproduction: `NEEDS_RUNTIME_VERIFICATION`
- Triage: `NEEDS_REVIEW`
- `auto_implementation=false`
- Full-round qualification: **false** — this is a targeted re-verification of the already-tracked #38 regression scenario, not a replacement for a new 50/50 round.
- CLEAN streak effect: remains `0/2`; no round is added.

## Why this re-verification pre-empted the fairness cursor

The prior portfolio continuation left the fairness cursor at `tick-stock-panel`, but #38 had a product fix merged to the default branch after the previous audit. Portfolio priority rules require re-running the same finding scenario when a fix lands before advancing discovery. The fairness cursor is therefore preserved at `tick-stock-panel` for the next continuation.

## What the fix actually solved

Commit `830b1dc518672a2203fdcba1c70140cf0eefa6f8` materially narrows the earlier defect:

- `loadEvents` / `loadMapEvents` can consume manifest file descriptors and verify SHA-256 before returning data.
- `loadNetwork` fails closed when the expected snapshot is known but the payload is missing/mismatching the snapshot/hash contract.
- the full refresh path uses a bounded cohort fetch/retry path rather than independently promoting event/network artifacts.

These are real source changes and should be retained. This re-verification does not revert the finding to its pre-fix scope.

## Remaining supported path: first-paint map bypasses the locked cohort

Current `src/main.ts` still performs a pre-refresh map first paint with no manifest argument:

```ts
void loadMapEvents(getState().scope).then((pts) => {
  if (pts && !cache[getState().scope]) void mapView.render(filterEvents(pts, getState()), getState().scope);
});
```

Source: https://github.com/Reese-max/taiwan-intel-dashboard/blob/29a45b339ee257383073717105391757cd55ae70/src/main.ts

In `src/data/loader.ts`, `loadMapEvents(scope, options?)` only receives a manifest file path and expected SHA-256 when `options.manifest` is supplied. With the call above, it falls back to `./data/${scope}.map.json` and has no expected cohort hash to verify before returning data.

Source: https://github.com/Reese-max/taiwan-intel-dashboard/blob/29a45b339ee257383073717105391757cd55ae70/src/data/loader.ts

The later full refresh can repaint with the verified cohort, but a deploy race can still make first paint briefly promote map S1 while the subsequently selected manifest/full cohort is S2. That is narrower than the pre-`830b1dc` mixed-cohort defect, but it still violates #38's D2 acceptance condition that event/map/network projections are promoted from one locked snapshot.

## Same-fingerprint regression scenario

Precondition: deployment or CDN/static propagation changes between the slim map request and the manifest/full-data request.

1. startup requests `domestic.map.json` without a locked manifest and receives cohort S1;
2. `mapView.render()` promotes S1 because no verified cohort/hash was supplied;
3. refresh locks manifest S2 and loads verified event/network data for S2;
4. the later refresh may correct the map, but S1 was already promoted on a supported user-visible first-paint path.

Expected: once cohort identity is part of the product contract, no map artifact should be promoted unless it is verified for the selected cohort; if verification is unavailable, skip early map promotion and wait for the verified refresh.

Observed from source: the first-paint call does not provide the manifest, while the loader only has an expected hash when a manifest is supplied.

## Affected fixed-persona regression subset

This targeted pass re-ran the existing deployment-race/trust scenario for: `C01, C05, D01, D02, D05, G05, H04, H05, I04, I05, J02, J03, J05`.

The baseline identities and success conditions are unchanged from the fixed A01–J05 rules. These are synthetic personas, not independent human tests. The remaining personas were **not** re-run in this targeted post-fix pass; therefore this report cannot count as a complete 50-persona round.

## Severity / issue-quality gate

- **Who is affected:** users relying on map/event/relation consistency during a deploy race, slow static propagation, or startup refresh.
- **Concrete failure:** a user-visible slim map from a different cohort can be promoted before the verified cohort refresh completes.
- **Existing workaround:** wait for the subsequent full refresh; this can correct the view, but the user cannot know whether the first paint belonged to the same cohort.
- **Consequence if unchanged:** transient misleading map/event consistency and weakened traceability/recovery trust during the exact cross-deploy condition #38 is meant to guard.
- **Why P2, not P1:** no data loss, privilege boundary failure, or proven core-task outage; no production mixed-cohort incident was reproduced in this pass.
- **Minimum safe change:** keep the existing manifest/loader design and require the slim first paint to use/verify the same manifest descriptor/hash before promotion, or skip early promotion until the verified refresh. No new DB, queue, scheduler, service, or generic state-machine framework is required.

## Runtime evidence boundary

The exact inspected HEAD has successful GitHub Actions runs. In particular, scheduled run https://github.com/Reese-max/taiwan-intel-dashboard/actions/runs/35155636279 completed successfully on `29a45b339ee257383073717105391757cd55ae70`.

That execution verifies that the scheduled update/deploy workflow ran successfully for this SHA. It does **not** prove the browser first-paint deployment-race scenario. Required regression execution remains a deterministic browser/integration fixture with staggered artifacts (map S1, manifest/full cohort S2) confirming that S1 is never visibly promoted after the selected cohort is S2.

## Tracking / coordination

Issue #38 was closed after fix `830b1dc...`. The same fingerprint remained reachable on current default source, so the original Issue was reopened rather than creating a duplicate. Audit lease was obtained before the write. No product code, CI/config, secrets, repository settings, merge, deployment, worker, GOAL, or paid operation was changed by this audit.

## Result

`REGRESSION / PARTIALLY_FIXED` for Issue #38. Repository remains `NOT CLEAN`; CLEAN streak remains `0/2`. This targeted re-verification is not a complete fixed-50 qualifying round.