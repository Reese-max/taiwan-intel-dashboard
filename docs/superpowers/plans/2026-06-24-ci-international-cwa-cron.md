# CI International and CWA Cron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore CI cron updates for international RSS/LLM news, CWA earthquakes, and CWA weather warnings while keeping police/news/missing updates intact.

**Architecture:** Move GitHub Actions fetch-mode selection out of inline shell into a small tested Node ESM resolver. Both hourly and daily cron modes must include `cwa` and `rss`; a post-fetch assertion reads `public/data/provenance.json` and fails CI if required sources were skipped or failed.

**Tech Stack:** GitHub Actions, Node.js 22 ESM scripts, Vitest, existing `scripts/fetch-live.mjs` source flags, existing `provenance.json.pipeline` status contract.

---

## Current State

- `.github/workflows/update-and-deploy.yml` already injects `CWA_API_KEY`, `LLM_*`, `NVIDIA_*`, and Twinkle secrets into `.env`.
- The workflow currently chooses only:
  - hourly: `--sources=police,missing,twnews`
  - daily refresh: `--sources=police,missing,twnews --exclusive`
- Because `scripts/fetch-live.mjs` only runs sources listed in `--sources`, current CI skips:
  - `cwa` → earthquake + weather warnings
  - `rss` → international RSS + LLM normalization
- `fetch-live.mjs` already supports `cwa`, `rss`, carry-over, `provenance.json.pipeline`, and source-level status. The fix is orchestration + regression guards, not a new fetcher.

## File Structure

- Create: `scripts/ci-fetch-mode.mjs`
  - Pure resolver for hourly/daily/manual fetch args.
  - CLI writes `args=` and `label=` to `$GITHUB_OUTPUT` when requested.
- Create: `tests/ci-fetch-mode.test.ts`
  - Verifies cron/manual mappings include `cwa` and `rss`.
- Create: `scripts/assert-pipeline-sources.mjs`
  - Reads `public/data/provenance.json` after fetch.
  - Fails when required pipeline entries are missing, skipped, or `ok:false`.
- Create: `tests/assert-pipeline-sources.test.ts`
  - Verifies assertion behavior with in-memory pipeline fixtures.
- Modify: `.github/workflows/update-and-deploy.yml`
  - Use `scripts/ci-fetch-mode.mjs` in the “決定抓取模式” step.
  - Run `scripts/assert-pipeline-sources.mjs --require=cwa,cwaWarnings,international` after fetch.
  - Update workflow_dispatch description/options.
- Modify: `package.json`
  - Add local convenience scripts for CI-equivalent source sets.

---

### Task 1: Add tested CI fetch-mode resolver

**Files:**
- Create: `scripts/ci-fetch-mode.mjs`
- Create: `tests/ci-fetch-mode.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ci-fetch-mode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveFetchMode } from "../scripts/ci-fetch-mode.mjs";

describe("resolveFetchMode", () => {
  it("maps hourly cron to CWA + police + missing + Taiwan news + international RSS", () => {
    const mode = resolveFetchMode({ schedule: "5 * * * *" });
    expect(mode.label).toBe("hourly");
    expect(mode.args).toBe("--sources=cwa,police,missing,twnews,rss");
  });

  it("maps daily refresh cron to full exclusive refresh including CWA and international RSS", () => {
    const mode = resolveFetchMode({ schedule: "30 18 * * *" });
    expect(mode.label).toBe("refresh");
    expect(mode.args).toBe("--sources=cwa,pcc,police,missing,twnews,rss,judicial --exclusive");
  });

  it("keeps legacy manual police mode as hourly-compatible mode", () => {
    const mode = resolveFetchMode({ mode: "police" });
    expect(mode.label).toBe("hourly");
    expect(mode.args).toContain("cwa");
    expect(mode.args).toContain("rss");
  });

  it("maps manual refresh to full exclusive refresh", () => {
    const mode = resolveFetchMode({ mode: "refresh" });
    expect(mode.label).toBe("refresh");
    expect(mode.args).toContain("cwa");
    expect(mode.args).toContain("rss");
    expect(mode.args).toContain("--exclusive");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/ci-fetch-mode.test.ts
```

Expected: FAIL with import error because `scripts/ci-fetch-mode.mjs` does not exist yet.

- [ ] **Step 3: Implement the resolver**

Create `scripts/ci-fetch-mode.mjs`:

```js
import { appendFileSync } from "node:fs";

export const HOURLY_ARGS = "--sources=cwa,police,missing,twnews,rss";
export const REFRESH_ARGS = "--sources=cwa,pcc,police,missing,twnews,rss,judicial --exclusive";

const DAILY_REFRESH_CRON = "30 18 * * *";

function argValue(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

export function resolveFetchMode({ schedule = "", mode = "" } = {}) {
  const normalizedMode = String(mode || "").trim();
  const normalizedSchedule = String(schedule || "").trim();

  if (normalizedSchedule === DAILY_REFRESH_CRON || normalizedMode === "refresh") {
    return {
      label: "refresh",
      args: REFRESH_ARGS,
      message: "選用 refresh（完整，含 CWA、國際 RSS、新聞、LLM、警政、失蹤人口、司法）",
    };
  }

  return {
    label: "hourly",
    args: HOURLY_ARGS,
    message: "選用 hourly（每小時，含 CWA、國際 RSS、警政、台灣新聞、失蹤人口；非 exclusive 保留其他資料）",
  };
}

export function writeGithubOutput(result, outputPath) {
  if (!outputPath) return;
  appendFileSync(outputPath, `label=${result.label}\nargs=${result.args}\n`, "utf8");
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  const result = resolveFetchMode({
    schedule: argValue("schedule"),
    mode: argValue("mode"),
  });
  writeGithubOutput(result, argValue("github-output") || process.env.GITHUB_OUTPUT);
  console.log(result.message);
  console.log(`args=${result.args}`);
}
```

- [ ] **Step 4: Run resolver test to verify it passes**

Run:

```bash
npm test -- tests/ci-fetch-mode.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit checkpoint**

```bash
git add scripts/ci-fetch-mode.mjs tests/ci-fetch-mode.test.ts
git commit -m "test: cover CI fetch mode source sets"
```

---

### Task 2: Add post-fetch pipeline assertion

**Files:**
- Create: `scripts/assert-pipeline-sources.mjs`
- Create: `tests/assert-pipeline-sources.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/assert-pipeline-sources.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertRequiredPipelineSources } from "../scripts/assert-pipeline-sources.mjs";

describe("assertRequiredPipelineSources", () => {
  it("accepts required sources that are ok, including zero weather warnings", () => {
    expect(() =>
      assertRequiredPipelineSources(
        {
          cwa: { ok: true, count: 10 },
          cwaWarnings: { ok: true, count: 0 },
          international: { ok: true, count: 8 },
        },
        ["cwa", "cwaWarnings", "international"],
      ),
    ).not.toThrow();
  });

  it("rejects skipped sources", () => {
    expect(() =>
      assertRequiredPipelineSources(
        {
          cwa: { skipped: true },
          cwaWarnings: { ok: true, count: 0 },
          international: { ok: true, count: 8 },
        },
        ["cwa", "cwaWarnings", "international"],
      ),
    ).toThrow("Required pipeline source cwa was skipped");
  });

  it("rejects failed sources with the upstream error", () => {
    expect(() =>
      assertRequiredPipelineSources(
        {
          cwa: { ok: true, count: 10 },
          cwaWarnings: { ok: true, count: 0 },
          international: { ok: false, error: "缺少 API key" },
        },
        ["cwa", "cwaWarnings", "international"],
      ),
    ).toThrow("Required pipeline source international failed: 缺少 API key");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/assert-pipeline-sources.test.ts
```

Expected: FAIL with import error because `scripts/assert-pipeline-sources.mjs` does not exist yet.

- [ ] **Step 3: Implement assertion script**

Create `scripts/assert-pipeline-sources.mjs`:

```js
import { readFileSync } from "node:fs";

function argValue(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

export function assertRequiredPipelineSources(pipeline, requiredSources) {
  for (const name of requiredSources) {
    const status = pipeline?.[name];
    if (!status) throw new Error(`Required pipeline source ${name} is missing`);
    if (status.skipped) throw new Error(`Required pipeline source ${name} was skipped`);
    if (status.ok !== true) {
      const suffix = status.error ? `: ${status.error}` : "";
      throw new Error(`Required pipeline source ${name} failed${suffix}`);
    }
  }
}

export function readPipeline(path = "public/data/provenance.json") {
  const provenance = JSON.parse(readFileSync(path, "utf8"));
  return provenance.pipeline || {};
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  const required = argValue("require")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const path = argValue("file") || "public/data/provenance.json";
  assertRequiredPipelineSources(readPipeline(path), required);
  console.log(`Required pipeline sources ok: ${required.join(", ")}`);
}
```

- [ ] **Step 4: Run assertion test to verify it passes**

Run:

```bash
npm test -- tests/assert-pipeline-sources.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit checkpoint**

```bash
git add scripts/assert-pipeline-sources.mjs tests/assert-pipeline-sources.test.ts
git commit -m "test: assert CI required data sources"
```

---

### Task 3: Wire CI cron to include CWA and international RSS

**Files:**
- Modify: `.github/workflows/update-and-deploy.yml:7-15`
- Modify: `.github/workflows/update-and-deploy.yml:82-95`

- [ ] **Step 1: Update workflow dispatch copy and options**

Replace lines 11-15 with:

```yaml
      mode:
        description: "hourly（CWA+國際+警政+新聞）或 refresh（每日完整，含 LLM）"
        default: hourly
        type: choice
        options: [hourly, police, refresh]
```

Keep `police` as a legacy manual option; `scripts/ci-fetch-mode.mjs` maps it to the new hourly source set.

- [ ] **Step 2: Replace inline shell mode selection with tested resolver**

Replace the current “決定抓取模式” step with:

```yaml
      - name: 決定抓取模式
        id: mode
        run: |
          node scripts/ci-fetch-mode.mjs \
            --schedule="${{ github.event.schedule }}" \
            --mode="${{ github.event.inputs.mode }}" \
            --github-output="$GITHUB_OUTPUT"
```

- [ ] **Step 3: Add required-source assertion after fetch**

Immediately after “抓取即時資料”, add:

```yaml
      - name: 驗證必要來源已更新
        run: node scripts/assert-pipeline-sources.mjs --require=cwa,cwaWarnings,international
```

- [ ] **Step 4: Keep fetch command unchanged**

Confirm the fetch step still reads the resolver output:

```yaml
      - name: 抓取即時資料
        run: node --env-file=.env scripts/fetch-live.mjs ${{ steps.mode.outputs.args }}
```

- [ ] **Step 5: Commit checkpoint**

```bash
git add .github/workflows/update-and-deploy.yml
git commit -m "ci: include CWA and international feeds in cron refresh"
```

---

### Task 4: Add local scripts for CI-equivalent runs

**Files:**
- Modify: `package.json:10-13`

- [ ] **Step 1: Update `package.json` scripts**

Add two scripts without changing existing commands:

```json
{
  "scripts": {
    "refresh:ci:hourly": "node --env-file=.env scripts/fetch-live.mjs --sources=cwa,police,missing,twnews,rss",
    "refresh:ci:daily": "node --env-file=.env scripts/fetch-live.mjs --sources=cwa,pcc,police,missing,twnews,rss,judicial --exclusive"
  }
}
```

Expected final scripts block keeps existing entries and includes:

```json
"fetch:police": "node --env-file=.env scripts/fetch-live.mjs --sources=police",
"refresh": "node --env-file=.env scripts/fetch-live.mjs --sources=police,missing,twnews --exclusive",
"refresh:news": "node --env-file=.env scripts/fetch-live.mjs --sources=twnews,missing",
"refresh:ci:hourly": "node --env-file=.env scripts/fetch-live.mjs --sources=cwa,police,missing,twnews,rss",
"refresh:ci:daily": "node --env-file=.env scripts/fetch-live.mjs --sources=cwa,pcc,police,missing,twnews,rss,judicial --exclusive"
```

- [ ] **Step 2: Run package JSON parse smoke**

Run:

```bash
node -e "const p=require('./package.json'); console.log(p.scripts['refresh:ci:hourly']); console.log(p.scripts['refresh:ci:daily'])"
```

Expected output includes `--sources=cwa,police,missing,twnews,rss` and `--sources=cwa,pcc,police,missing,twnews,rss,judicial --exclusive`.

- [ ] **Step 3: Commit checkpoint**

```bash
git add package.json
git commit -m "chore: add CI refresh source scripts"
```

---

### Task 5: Verify locally before pushing

**Files:**
- No new files unless verification changes reveal a bug.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/ci-fetch-mode.test.ts tests/assert-pipeline-sources.test.ts
```

Expected: both new test files pass.

- [ ] **Step 2: Run full tests**

Run:

```bash
npm test
```

Expected: all tests pass. Current baseline before this plan is 21 files / 90 tests; after adding two test files expect at least 23 files / 97 tests.

- [ ] **Step 3: Run a live hourly-equivalent fetch**

Run:

```bash
npm run refresh:ci:hourly
```

Expected command output includes:

```txt
本次來源：cwa, police, missing, twnews, rss
地震 CWA：... 筆
天氣警特報 CWA：... 筆
國際正規化：... 筆
```

- [ ] **Step 4: Run required-source assertion against fresh provenance**

Run:

```bash
node scripts/assert-pipeline-sources.mjs --require=cwa,cwaWarnings,international
```

Expected:

```txt
Required pipeline sources ok: cwa, cwaWarnings, international
```

- [ ] **Step 5: Run static build**

Run:

```bash
npm run build
```

Expected: `tsc --noEmit` passes and `dist/` is updated.

- [ ] **Step 6: Inspect generated data counts**

Run:

```bash
node -e "const p=require('./public/data/provenance.json'); console.log(JSON.stringify({cwa:p.pipeline.cwa,cwaWarnings:p.pipeline.cwaWarnings,international:p.pipeline.international}, null, 2))"
```

Expected:

```json
{
  "cwa": { "ok": true, "count": 10 },
  "cwaWarnings": { "ok": true, "count": 0 },
  "international": { "ok": true, "count": 1 }
}
```

Counts may differ by live conditions; acceptance is `ok: true` for all three. `cwaWarnings.count` may legitimately be `0` when no active weather warning exists.

- [ ] **Step 7: Commit final verification note if needed**

If verification generated only expected data changes, do not commit `public/data/*.json` unless this repository intentionally tracks generated snapshots for deployment. If generated data is tracked and expected in this repo, commit it separately:

```bash
git add public/data dist/data
git commit -m "data: refresh CI source snapshots"
```

---

## Rollback Plan

If CI starts failing due LLM quota or CWA upstream outage:

1. Keep `scripts/ci-fetch-mode.mjs` and tests.
2. Temporarily remove `international` from the assertion command only:

```yaml
run: node scripts/assert-pipeline-sources.mjs --require=cwa,cwaWarnings
```

3. Do not remove `rss` from fetch args unless international LLM cost or quota becomes unacceptable.
4. If CWA upstream is down, the fetcher carry-over still protects deployed data, but assertion will fail to prevent silently stale CI. Decide explicitly whether to loosen assertion for outage windows.

## Self-Review

- Spec coverage:
  - International news restored in CI cron: Task 1 + Task 3 include `rss` in hourly and daily source args.
  - Earthquakes restored in CI cron: Task 1 + Task 3 include `cwa`, which triggers `fetchCwa`.
  - Weather warnings restored in CI cron: Task 1 + Task 3 include `cwa`, which also triggers `fetchCwaWarnings`.
  - Regression guard: Task 2 + Task 3 fail CI if `cwa`, `cwaWarnings`, or `international` are skipped/failed.
- Placeholder scan: no `TBD`, no unexpanded “add tests”, no unspecified file paths.
- Type consistency:
  - `resolveFetchMode` return fields `label`, `args`, `message` are used consistently by tests and CLI.
  - `assertRequiredPipelineSources` accepts `pipeline` object and `requiredSources` array consistently across tests and CLI.
