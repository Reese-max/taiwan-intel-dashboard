import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runBenchmark } from "../scripts/ground-truth-benchmark.mjs";
import { runSample } from "../scripts/ground-truth-relations-sample.mjs";
import { assignSplit, computeLocationMetrics, computeRelationMetrics, groupCandidateFamilies } from "../scripts/lib/ground-truth-relations.mjs";
import { fingerprintEvent } from "../scripts/lib/curation-ledger.mjs";
import { RULES_VERSION } from "../scripts/lib/manifest.mjs";

// Synthetic labels exercise the runner; they are not the shipped human dataset.
const events = ["a", "b", "c", "d"].map((id) => ({
  id, title: `Synthetic report ${id}`, summary: "Synthetic fixture", region: "高雄市",
  timestamp: "2026-09-17T00:00:00Z", scope: "domestic", category: "治安",
  source: { name: id, type: "news-rss", recordRef: `https://example.invalid/${id}` },
  locationRole: "agency", locationPrecision: "city",
}));
const pair = (over = {}) => ({
  schema: "relation-pairs/1", a: "a", b: "b", family: "story-a", label: "same_event",
  evidence: "https://example.invalid/review#pair", labeledAt: "2026-09-17T00:00:00Z", labeledBy: "human", ...over,
});
const location = (over = {}) => ({
  schema: "location-labels/1", event: "a", family: "story-a", locationRole: "incident",
  locationPrecision: "city", region: "高雄市", evidence: "https://example.invalid/review#location",
  labeledAt: "2026-09-17T00:00:00Z", labeledBy: "human", ...over,
});
const dirs: string[] = [];
function fixture(pairs = [pair()], locations = [location()], inputEvents = events) {
  const dir = mkdtempSync(join(tmpdir(), "relation-benchmark-"));
  dirs.push(dir);
  const paths = { pairs: join(dir, "pairs.jsonl"), locations: join(dir, "locations.jsonl"), events: join(dir, "events.json") };
  writeFileSync(paths.pairs, pairs.map((row) => JSON.stringify(row)).join("\n"));
  writeFileSync(paths.locations, locations.map((row) => JSON.stringify(row)).join("\n"));
  writeFileSync(paths.events, JSON.stringify(inputEvents));
  return { dir, paths, args: Object.entries(paths).map(([key, value]) => `--${key}=${value}`) };
}
afterEach(() => {
  process.exitCode = 0;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("versioned relation/location benchmark", () => {
  it("publishes schemas matching the validation and split contract", () => {
    const root = "docs/ground-truth/relations";
    const schema = JSON.parse(readFileSync(`${root}/locations-v1.schema.json`, "utf8"));
    expect(schema.required).toEqual(expect.arrayContaining(["family", "region"]));
    expect(schema.properties.family).toEqual({ type: "string", minLength: 1 });
    expect(schema.properties.benchmark.enum).toEqual(["tuning", "holdout"]);
  });

  it("replays identical bytes, identifies inputs/policy and exposes uncertainty coverage", () => {
    const f = fixture([pair({ label: "uncertain" })]);
    const first = runBenchmark(f.args);
    expect(runBenchmark(f.args)).toEqual(first);
    expect(first.inputHashes.events).toMatch(/^[a-f0-9]{64}$/);
    expect(first.policy.rulesVersion).toBe(RULES_VERSION);
    expect(first.policy.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.relation.uncertainRate).toBe(1);
    expect(first.relation.sameEvent.precision).toBeNull();
  });

  it("fails closed on invalid annotations while retaining a report", () => {
    const f = fixture([pair({ a: "missing" }), pair({ label: "invalid" }), pair(), pair()]);
    const out = join(f.dir, "report.json");
    const result = spawnSync(process.execPath, ["scripts/ground-truth-benchmark.mjs", ...f.args, `--out=${out}`], { encoding: "utf8" });
    expect(result.status).toBe(1);
    const report = JSON.parse(readFileSync(out, "utf8"));
    expect(report.errors.pairs.map((row: any) => row.error)).toEqual(expect.arrayContaining([
      "missing-event-reference", "unknown-label", "duplicate-key",
    ]));
    expect(report.status).toBe("invalid");
  });

  it("rejects wrong-schema candidates and references missing from the snapshot", () => {
    const f = fixture([pair({ label: "", a: "missing" })], [location({ schema: "relation-pairs/1", label: "", a: "a", b: "b" })]);
    const report = runBenchmark(f.args);
    expect(report.errors.pairs).toContainEqual(expect.objectContaining({ error: "missing-event-reference" }));
    expect(report.errors.locations).toContainEqual(expect.objectContaining({ error: "unsupported-schema" }));
    expect(process.exitCode).toBe(1);
  });

  it("rejects event and original-source leakage between tuning and holdout", () => {
    const families = Array.from({ length: 20 }, (_, i) => `story-${i}`);
    const tuning = families.find((value) => assignSplit(value) === "tuning")!;
    const holdout = families.find((value) => assignSplit(value) === "holdout")!;
    const sourceEvents = events.map((event) => ({ ...event, source: { ...event.source } }));
    sourceEvents[2].source.recordRef = sourceEvents[0].source.recordRef;
    const f = fixture([pair({ family: tuning }), pair({ a: "c", b: "d", family: holdout })], [], sourceEvents);
    expect(runBenchmark(f.args).errors.pairs).toContainEqual(expect.objectContaining({ error: "split-leakage" }));
    const shared = fixture([pair({ family: tuning }), pair({ b: "c", family: holdout })], []);
    expect(runBenchmark(shared.args).errors.pairs).toContainEqual(expect.objectContaining({ error: "split-leakage" }));
    const crossKind = fixture([pair({ family: tuning })], [location({ family: holdout })]);
    expect(runBenchmark(crossKind.args).errors.locations).toContainEqual(expect.objectContaining({ error: "split-leakage" }));
  });

  it("excludes unknown predictions from accuracy and reports location splits/errors", () => {
    const result = computeLocationMetrics([location()], [{ ...events[0], locationRole: "unknown", locationPrecision: "unknown" }]);
    expect(result.role.total).toBe(0);
    expect(result.precision.total).toBe(0);
    expect(result.unknownRate).toBe(1);
    const report = runBenchmark(fixture().args);
    expect(report.location.splits.tuning.labeled + report.location.splits.holdout.labeled).toBe(1);
    expect(report.location.examples.roleErrors[0]).toMatchObject({ event: "a", expected: "incident", actual: "agency", evidence: location().evidence });
  });

  it("marks a human-labeled all-unknown location baseline as established", () => {
    const f = fixture([], [location({ locationRole: "unknown", locationPrecision: "unknown" })]);
    const predictions = join(f.dir, "predictions.json");
    writeFileSync(predictions, JSON.stringify(events.map((event) => ({ ...event, locationRole: "unknown", locationPrecision: "unknown" }))));
    const report = runBenchmark([...f.args, `--predictions=${predictions}`]);
    expect(report.location.labeled).toBe(1);
    expect(report.location.unknownRate).toBe(1);
    expect(report.status).toBe("baseline");
  });

  it("rejects duplicate pair keys across labeled and unlabeled rows", () => {
    const report = runBenchmark(fixture([pair({ label: "" }), pair({ label: "" }), pair()], []).args);
    expect(report.errors.pairs).toEqual([
      { line: 2, error: "duplicate-key" }, { line: 3, error: "duplicate-key" },
    ]);
    expect(report.counts.unlabeledPairs).toBe(1);
    expect(report.status).toBe("invalid");
  });

  it("does not accept same-topic as evidence that a follow-up was found", () => {
    const result = computeRelationMetrics([pair({ label: "follow_up" })], { edges: [{ a: "a", b: "b", type: "same-topic" }], clusters: [] });
    expect(result.missedRelation.count).toBe(1);
    expect(result.missedRelation.total).toBe(1);
  });

  it("supports location policy before/after with frozen source/label identities", () => {
    const f = fixture();
    const baseline = join(f.dir, "before.json");
    runBenchmark([...f.args, `--out=${baseline}`]);
    const predictions = join(f.dir, "predictions.json");
    writeFileSync(predictions, JSON.stringify(events.map((event) => ({ ...event, locationRole: "incident" }))));
    const after = runBenchmark([...f.args, `--predictions=${predictions}`, `--baseline=${baseline}`]);
    expect(after.diff).toContainEqual(expect.objectContaining({ metric: "location.role.accuracy", direction: "improved" }));
    expect(after.location.examples.roleErrors).toEqual([]);
    expect(after.errorChanges.roleErrors.resolved).toEqual(["a"]);
    expect(after.predictionsHash).toMatch(/^[a-f0-9]{64}$/);
    writeFileSync(f.paths.pairs, JSON.stringify(pair({ label: "different_event" })));
    expect(() => runBenchmark([...f.args, `--baseline=${baseline}`])).toThrow(/baseline.*input/i);
    writeFileSync(f.paths.pairs, JSON.stringify(pair()));
    writeFileSync(predictions, JSON.stringify(events.map((event) => ({ ...event, title: "Changed source" }))));
    expect(() => runBenchmark([...f.args, `--predictions=${predictions}`])).toThrow(/prediction.*identity/i);
  });

  it("keeps the first dataset honest about the missing human baseline", () => {
    const root = "docs/ground-truth/relations";
    const pairCandidates = readFileSync(`${root}/pairs-v1-candidates.jsonl`, "utf8").trim().split("\n").map(JSON.parse);
    const locationCandidates = readFileSync(`${root}/locations-v1-candidates.jsonl`, "utf8").trim().split("\n").map(JSON.parse);
    expect(pairCandidates.length).toBeGreaterThanOrEqual(100);
    expect(pairCandidates.length).toBeLessThanOrEqual(200);
    expect(locationCandidates.length).toBeGreaterThanOrEqual(30);
    expect(locationCandidates.length).toBeLessThanOrEqual(50);
    expect(pairCandidates.some((row) => row.candidateSource.endsWith("unlinked"))).toBe(true);
    expect(pairCandidates.every((row) => row.label === "")).toBe(true);
    expect(locationCandidates.every((row) => row.labeledBy === "agent-draft")).toBe(true);
    expect(locationCandidates.every((row) => row.family)).toBe(true);
    const report = runBenchmark([
      `--pairs=${root}/pairs-v1.jsonl`, `--locations=${root}/locations-v1.jsonl`, `--events=${root}/events-v1.json`,
    ]);
    expect(report.status).toBe("needs_review");
    expect(report.relation.evaluated).toBe(0);
    expect(report.location.labeled).toBe(0);
  });

  it("samples using the current ledger API and ignores unapproved benchmark records", async () => {
    const f = fixture();
    const ledger = join(f.dir, "ledger.jsonl");
    const record = (id: string, subjects: string[], benchmark: string) => ({
      schemaVersion: 1, id, subjects, benchmark, decision: "not_same_event", rulesVersion: RULES_VERSION,
      reviewedAt: "2026-09-17T00:00:00Z", reason: "Synthetic reviewed record", evidence: "https://example.invalid/review",
      expect: Object.fromEntries(subjects.map((id) => [id, fingerprintEvent(events.find((event) => event.id === id))])),
    });
    writeFileSync(ledger, [record("approved", ["a", "b"], "tuning"), record("unapproved", ["a", "c"], "none")].map((row) => JSON.stringify(row)).join("\n"));
    const out = join(f.dir, "candidates.jsonl");
    const eventsOut = join(f.dir, "snapshot.json");
    const sampled = await runSample([`--input=${f.paths.events}`, `--ledger=${ledger}`, `--out=${out}`, `--events-out=${eventsOut}`, "--max=20", "--date=20260917"]);
    expect(sampled.pairs.find((row: any) => [row.a, row.b].sort().join("|") === "a|b")).toMatchObject({ ledgerDecision: "not_same_event", ledgerId: "approved", benchmark: "tuning" });
    expect(sampled.pairs.find((row: any) => [row.a, row.b].sort().join("|") === "a|c").ledgerDecision).toBeUndefined();
    expect(sampled.pairs.every((row: any) => row.label === "")).toBe(true);
    const first = readFileSync(out, "utf8");
    await runSample([`--input=${f.paths.events}`, `--ledger=${ledger}`, `--out=${out}`, `--events-out=${eventsOut}`, "--max=20", "--date=20260917"]);
    expect(readFileSync(out, "utf8")).toBe(first);
    expect(readFileSync(eventsOut, "utf8")).not.toContain("Synthetic reviewed record");
  });

  it("does not tag stale benchmark ledger entries", async () => {
    const f = fixture();
    const ledger = join(f.dir, "ledger.jsonl");
    const stale = {
      schemaVersion: 1, id: "stale", subjects: ["a", "b"], benchmark: "holdout", decision: "not_same_event",
      rulesVersion: RULES_VERSION, reviewedAt: "2026-09-17T00:00:00Z", reason: "Stale synthetic record",
      evidence: "https://example.invalid/review", expect: { a: "stale", b: "stale" },
    };
    writeFileSync(ledger, JSON.stringify(stale));
    const sampled = await runSample([`--input=${f.paths.events}`, `--ledger=${ledger}`,
      `--out=${join(f.dir, "candidates.jsonl")}`, `--events-out=${join(f.dir, "snapshot.json")}`, "--max=20"]);
    expect(sampled.pairs.find((row: any) => [row.a, row.b].sort().join("|") === "a|b").ledgerId).toBeUndefined();
  });

  it("replays sampled transitive pairs with their unsampled correlation context", async () => {
    const sourceEvents = events.slice(0, 3).map((event, index) => ({
      ...event, aiEntities: [["甲乙集團"], ["丙丁集團"], ["甲乙集團", "丙丁集團"]][index],
    }));
    const f = fixture([], [], sourceEvents);
    const out = join(f.dir, "candidates.jsonl");
    const snapshot = join(f.dir, "snapshot.json");
    const sampled = await runSample([
      `--input=${f.paths.events}`, `--ledger=${join(f.dir, "empty-ledger.jsonl")}`,
      `--out=${out}`, `--events-out=${snapshot}`, "--max=1", "--seed=4",
    ]);
    expect(sampled.pairs).toEqual([expect.objectContaining({ a: "a", b: "b", candidateSource: "auto-cluster" })]);
    writeFileSync(out, JSON.stringify({ ...pair(), ...sampled.pairs[0], label: "same_event",
      evidence: pair().evidence, labeledAt: pair().labeledAt, labeledBy: "human" }));
    const report = runBenchmark([`--pairs=${out}`, `--events=${snapshot}`]);
    expect(report.relation.sameEvent.tp).toBe(1);
    expect(report.relation.sameEvent.fn).toBe(0);
  });

  it("samples correlations from the same truncated summaries saved in the snapshot", async () => {
    const sourceEvents = events.slice(0, 2).map((event, index) => ({
      ...event, summary: `${"前文".repeat(160)} 後段共同關鍵詞黑鷹行動${index}`,
    }));
    const f = fixture([], [], sourceEvents);
    const out = join(f.dir, "candidates.jsonl");
    const snapshot = join(f.dir, "snapshot.json");
    await runSample([`--input=${f.paths.events}`, `--ledger=${join(f.dir, "empty-ledger.jsonl")}`,
      `--out=${out}`, `--events-out=${snapshot}`, "--max=20"]);
    const savedEvents = JSON.parse(readFileSync(snapshot, "utf8")).events;
    expect(savedEvents.every((event: any) => event.summary.length <= 301)).toBe(true);
    expect(readFileSync(out, "utf8")).not.toContain('"candidateSource":"auto-cluster"');
  });

  it.each(["", "same_event"])("rejects split leakage in %j pairs with an extra event field", (label) => {
    const rows = [
      pair({ label, benchmark: "tuning", event: "other-a" }),
      pair({ label, b: "c", family: "story-c", benchmark: "holdout", event: "other-b" }),
    ];
    const f = fixture(rows, []);
    const report = runBenchmark(f.args);
    expect(report.errors.pairs).toEqual([
      { line: 1, error: "split-leakage" }, { line: 2, error: "split-leakage" },
    ]);
    expect(report.errors.locations).toEqual([]);
    expect(report.status).toBe("invalid");
    expect(process.exitCode).toBe(1);
    expect(new Set(groupCandidateFamilies(rows, events).map((row: any) => row.family)).size).toBe(1);
  });

  it("rejects invalid splits on unlabeled candidates", () => {
    const report = runBenchmark(fixture([pair({ label: "", benchmark: "production" })], []).args);
    expect(report.errors.pairs).toEqual([{ line: 1, error: "invalid-split" }]);
    expect(report.status).toBe("invalid");
    expect(process.exitCode).toBe(1);
  });

  it.each([false, true])("counts unmerged follow-ups as same-event true negatives (linked=%s)", (linked) => {
    const edges = linked ? [{ a: "a", b: "b", type: "follow-up" }] : [];
    const result = computeRelationMetrics([pair({ label: "follow_up" })], { edges, clusters: [] });
    expect(result.sameEvent).toMatchObject({ tp: 0, fp: 0, fn: 0, tn: 1 });
  });

  it.each([
    ["locationRole", "roleErrors"], ["locationPrecision", "precisionErrors"], ["region", "regionErrors"],
  ])("does not report an unknown %s prediction as a resolved error", (field, kind) => {
    const f = fixture([], [location({ locationPrecision: "exact", region: "臺北市" })]);
    const baseline = join(f.dir, "before.json");
    const before = runBenchmark([...f.args, `--out=${baseline}`]);
    expect(before.location.examples[kind]).toHaveLength(1);
    const predictions = join(f.dir, "predictions.json");
    writeFileSync(predictions, JSON.stringify(events.map((event) => ({ ...event, [field]: "unknown" }))));
    const after = runBenchmark([...f.args, `--predictions=${predictions}`, `--baseline=${baseline}`]);
    expect(after.location.examples[kind]).toEqual([]);
    expect(after.errorChanges[kind].resolved).toEqual([]);
  });

  it.each([false, true])("keeps admitted ledger splits consistent across a family (conflict=%s)", async (conflict) => {
    const f = fixture();
    const ledger = join(f.dir, "ledger.jsonl");
    const record = (id: string, subjects: string[], benchmark: string) => ({
      schemaVersion: 1, id, subjects, benchmark, decision: "not_same_event", rulesVersion: RULES_VERSION,
      reviewedAt: "2026-09-17T00:00:00Z", reason: "Synthetic reviewed record", evidence: pair().evidence,
      expect: Object.fromEntries(subjects.map((id) => [id, fingerprintEvent(events.find((event) => event.id === id))])),
    });
    writeFileSync(ledger, [record("holdout", ["a", "b"], "holdout"),
      ...(conflict ? [record("tuning", ["a", "c"], "tuning")] : [])].map((row) => JSON.stringify(row)).join("\n"));
    const out = join(f.dir, "candidates.jsonl");
    const snapshot = join(f.dir, "snapshot.json");
    const args = [`--input=${f.paths.events}`, `--ledger=${ledger}`, `--out=${out}`, `--events-out=${snapshot}`, "--max=20"];
    if (conflict) {
      await expect(runSample(args)).rejects.toThrow(/conflicting.*split/i);
      expect(existsSync(out)).toBe(false);
      expect(existsSync(snapshot)).toBe(false);
    } else {
      const sampled = await runSample(args);
      expect(sampled.pairs.every((row: any) => row.benchmark === "holdout")).toBe(true);
      const report = runBenchmark([`--pairs=${out}`, `--events=${snapshot}`]);
      expect(report.errors.pairs).toEqual([]);
      expect(report.status).toBe("needs_review");
    }
  });
});
