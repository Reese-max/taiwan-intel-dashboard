import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { join, relative } from "node:path";

// @ts-expect-error — JS ESM module without types
import {
  RELATION_LABELS,
  LOCATION_ROLES,
  LOCATION_PRECISIONS,
  validatePairRow,
  validateLocationRow,
  loadLabeledJsonl,
  assignSplit,
  enumerateCandidatePairs,
  computeRelationMetrics,
  computeLocationMetrics,
  diffBenchmarkReports,
} from "../scripts/lib/ground-truth-relations.mjs";
// @ts-expect-error — JS ESM module without types
import { correlateEvents } from "../scripts/lib/correlate.mjs";
// @ts-expect-error — JS ESM module without types
import { runBenchmark } from "../scripts/ground-truth-benchmark.mjs";
// @ts-expect-error — JS ESM module without types
import { runSample } from "../scripts/ground-truth-relations-sample.mjs";

function ev(over: Record<string, unknown> = {}): any {
  return {
    id: "x",
    title: "標題",
    region: "臺北市",
    timestamp: "2026-06-20T10:00:00+08:00",
    category: "治安",
    scope: "domestic",
    riskLevel: "medium",
    summary: "",
    source: { name: "中央社 社會", type: "news-rss", recordRef: "https://example.com/n1", fetchedAt: "2026-06-20T10:00:00+08:00" },
    ...over,
  };
}

// 會自動併群的一對（共享「鳳山分局」實體）
function mergeablePair(): [any, any] {
  return [
    ev({ id: "a", region: "高雄市", title: "鳳山分局破詐騙水房", source: { name: "來源A", type: "news-rss", recordRef: "https://example.com/a", fetchedAt: "" } }),
    ev({ id: "b", region: "臺南市", title: "鳳山分局協助查緝車手", timestamp: "2026-06-21T10:00:00+08:00", source: { name: "來源B", type: "news-rss", recordRef: "https://example.com/b", fetchedAt: "" } }),
  ];
}

function pairRow(over: Record<string, unknown> = {}) {
  return {
    schema: "relation-pairs/1",
    a: "a",
    b: "b",
    familyA: "fam-1",
    familyB: "fam-1",
    label: "same_event",
    evidence: "https://example.com/proof",
    labeledAt: "2026-09-17T00:00:00Z",
    labeledBy: "human",
    ...over,
  };
}

function writeReplaySnapshot(dir: string, events: any[], contexts = events) {
  const cohort = gzipSync(Buffer.from(JSON.stringify({ schema: "ground-truth-cohort/1", count: events.length, events })), { level: 9, mtime: 0 });
  writeFileSync(join(dir, "events.cohort.json.gz"), cohort);
  writeFileSync(join(dir, "events.json"), JSON.stringify({
    schema: "ground-truth-events/1",
    cohortFile: "events.cohort.json.gz",
    cohortSha256: createHash("sha256").update(cohort).digest("hex"),
    cohortCount: events.length,
    count: contexts.length,
    events: contexts,
  }));
}

describe("validatePairRow / validateLocationRow", () => {
  it("合法 row 通過；缺欄位、未知 label、非 human 標註者被拒或標註", () => {
    expect(validatePairRow(pairRow())).toBeNull();
    expect(validatePairRow(pairRow({ label: "same_thing" }))).toBe("unknown-label");
    expect(validatePairRow(pairRow({ a: "" }))).toBe("invalid-pair");
    expect(validatePairRow(pairRow({ a: "b", b: "b" }))).toBe("invalid-pair"); // 自環
    expect(validatePairRow(pairRow({ familyA: "" }))).toBe("missing-endpoint-family");
    expect(validatePairRow(pairRow({ familyB: "other" }))).toBe("related-family-mismatch");
    expect(validatePairRow(pairRow({ labeledBy: "" }))).toBe("invalid-labeledBy");
    expect(validatePairRow(pairRow({ evidence: "" }))).toBe("missing-evidence");
    expect(validatePairRow(pairRow({ labeledBy: "agent-draft" }))).toBeNull(); // 允許但下游可分開計
    expect(validatePairRow(pairRow({ labeledBy: "agent-draft", familyA: "", familyB: "" }))).toBeNull();
    expect(validatePairRow(pairRow({ label: "uncertain", familyA: "", familyB: "" }))).toBeNull();
    expect(validatePairRow(pairRow({ labeledAt: "not-a-date" }))).toBe("invalid-labeledAt");
    expect(validatePairRow({ ...pairRow(), schema: "relation-pairs/0" })).toBe("unsupported-schema");
  });

  it("location row：role/precision 走 geo-policy 列舉，缺 evidence 被拒", () => {
    const row = {
      schema: "location-labels/1",
      event: "a",
      locationRole: "incident",
      locationPrecision: "exact",
      region: "高雄市",
      evidence: "https://example.com/p",
      labeledAt: "2026-09-17T00:00:00Z",
      labeledBy: "human",
    };
    expect(validateLocationRow(row)).toBeNull();
    expect(validateLocationRow({ ...row, locationRole: "somewhere" })).toBe("invalid-locationRole");
    expect(validateLocationRow({ ...row, locationPrecision: "approx" })).toBe("invalid-locationPrecision");
    expect(validateLocationRow({ ...row, evidence: "" })).toBe("missing-evidence");
    expect(validateLocationRow({ ...row, labeledBy: "" })).toBe("invalid-labeledBy");
    expect(LOCATION_ROLES.has("agency")).toBe(true);
    expect(LOCATION_PRECISIONS.has("county-center")).toBe(true);
  });
});

describe("unlabeled candidates", () => {
  it("pair/location 候選的空人工欄位保留待標註，不偷用系統推測", () => {
    const pairCandidate = { ...pairRow(), label: "", familyA: "", familyB: "", suggestedFamilyA: "single:a", suggestedFamilyB: "single:b", evidence: "", labeledAt: "", labeledBy: "" };
    const locationCandidate = { schema: "location-labels/1", event: "a", locationRole: "", locationPrecision: "", region: "", evidence: "", labeledAt: "", labeledBy: "", suggestedLocationRole: "incident" };
    const pairs = loadLabeledJsonl(JSON.stringify(pairCandidate), validatePairRow);
    const locations = loadLabeledJsonl(JSON.stringify(locationCandidate), validateLocationRow);
    expect(pairs).toMatchObject({ rows: [], errors: [], unlabeled: [expect.objectContaining({ familyA: "", familyB: "" })] });
    expect(locations).toMatchObject({ rows: [], errors: [], unlabeled: [expect.objectContaining({ locationRole: "" })] });
  });
});

describe("assignSplit — family 隔離防洩漏", () => {
  it("同 family 的 pair 永遠落在同一 split", () => {
    const s1 = assignSplit("fam-x");
    const s2 = assignSplit("fam-x");
    expect(s1).toBe(s2);
    expect(["tuning", "holdout"]).toContain(s1);
  });
  it("不同 family 可能分到不同 split；分派 deterministic", () => {
    const splits = new Set(["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"].map(assignSplit));
    expect(assignSplit("f1")).toBe(assignSplit("f1"));
    expect(splits.size).toBe(2); // 足夠多的 family 會兩邊都有
  });
});

describe("enumerateCandidatePairs — 抽樣涵蓋未連線候選", () => {
  it("輸出含已連線邊與同區未連線 pair（false negative 來源）", () => {
    const [a, b] = mergeablePair();
    const c = ev({ id: "c", region: "高雄市", category: "交通", title: "國道一號事故", timestamp: "2026-06-20T11:00:00+08:00", source: { name: "來源C", type: "news-rss", recordRef: "https://example.com/c", fetchedAt: "" } });
    const pairs = enumerateCandidatePairs([a, b, c], correlateEvents([a, b, c]), { maxPairs: 50, seed: 7 });
    const key = (x: string, y: string) => [x, y].sort().join("|");
    const found = new Set(pairs.map((p: any) => key(p.a, p.b)));
    expect(found.has("a|b")).toBe(true); // 已連線 pair
    // a-c 同縣市但未連線 → 漏連候選應被枚舉
    expect(found.has("a|c")).toBe(true);
    // 系統 family 只做提示；人工確認前不得影響 split。
    const ab = pairs.find((p: any) => key(p.a, p.b) === "a|b");
    expect(ab.autoRelation).toBeTruthy();
    expect(ab.familyA).toBe("");
    expect(ab.familyB).toBe("");
    expect(typeof ab.suggestedFamilyA).toBe("string");
    expect(typeof ab.suggestedFamilyB).toBe("string");
  });

  it("不同縣市同名道路進入獨立 hard-negative 候選層，不自動連邊", () => {
    const a = ev({ id: "road-a", region: "臺北市", title: "中山路追撞事故", source: { name: "A", type: "news-rss", recordRef: "https://example.com/road-a" } });
    const b = ev({ id: "road-b", region: "高雄市", title: "中山路行人跌倒", source: { name: "B", type: "news-rss", recordRef: "https://example.com/road-b" } });
    const net = correlateEvents([a, b]);
    expect(net.edges).toHaveLength(0);
    const pairs = enumerateCandidatePairs([a, b], net, { maxPairs: 10, seed: 7 });
    expect(pairs).toEqual([expect.objectContaining({ a: "road-a", b: "road-b", candidateSource: "cross-region-local-entity", matchedEntity: "中山路", autoRelation: null })]);
  });
});

describe("computeRelationMetrics", () => {
  it("same_event 命中 + different_event 被誤併 → P/R、falseMerge 各就各位", () => {
    // a,b,c 三事件兩兩共享「鳳山分局」→ 全併一群；d 無關
    const a = ev({ id: "a", region: "高雄市", title: "鳳山分局破詐騙水房", source: { name: "來源A", type: "news-rss", recordRef: "https://example.com/a", fetchedAt: "" } });
    const b = ev({ id: "b", region: "臺南市", title: "鳳山分局協助查緝車手", timestamp: "2026-06-21T10:00:00+08:00", source: { name: "來源B", type: "news-rss", recordRef: "https://example.com/b", fetchedAt: "" } });
    const c = ev({ id: "c", region: "嘉義縣", title: "鳳山分局事故後續追蹤", timestamp: "2026-06-21T11:00:00+08:00", source: { name: "來源C", type: "news-rss", recordRef: "https://example.com/c", fetchedAt: "" } });
    const d = ev({ id: "d", region: "花蓮縣", category: "交通", title: "國道追撞", timestamp: "2026-06-22T10:00:00+08:00", source: { name: "D", type: "news-rss", recordRef: "https://example.com/d", fetchedAt: "" } });
    const net = correlateEvents([a, b, c, d]);
    const rows = [
      pairRow({ a: "a", b: "b", label: "same_event" }),          // TP：真併群
      pairRow({ a: "a", b: "c", label: "different_event" }),     // FP：a-c 被併同群 → false merge
      pairRow({ a: "c", b: "d", label: "different_event" }),     // TN
      pairRow({ a: "c", b: "d", familyA: "", familyB: "", label: "uncertain" }), // 不計入分母
    ];
    const metrics = computeRelationMetrics(rows, net);
    expect(metrics.sameEvent.tp).toBe(1);
    expect(metrics.sameEvent.precision).toBeCloseTo(0.5); // a-b 對 + a-c 誤併 → 1/2
    expect(metrics.sameEvent.recall).toBe(1);
    expect(metrics.falseMerge.count).toBe(1);
    expect(metrics.uncertain).toBe(1);
    expect(metrics.evaluated).toBe(3); // uncertain 不計
  });

  it("follow_up label：有邊但未同群 = 命中；同群 = false merge；無邊 = missed relation", () => {
    const [a, b] = mergeablePair();
    const net = correlateEvents([a, b]);
    const same = computeRelationMetrics([pairRow({ label: "follow_up" })], net);
    expect(same.falseMerge.count).toBe(1); // follow_up 被併群 → false merge
    const c = ev({ id: "c", region: "屏東縣", title: "無關", source: { name: "C", type: "news-rss", recordRef: "https://x/c", fetchedAt: "" } });
    const net2 = correlateEvents([a, c]); // 無邊
    const missed = computeRelationMetrics([pairRow({ b: "c", label: "follow_up" })], net2);
    expect(missed.missedRelation.count).toBe(1);
  });

  it("九筆正確分開的 follow_up 也進 false-merge 分母", () => {
    const rows = [pairRow({ label: "follow_up" })];
    const edges = [];
    for (let i = 0; i < 9; i += 1) {
      rows.push(pairRow({ a: `x${i}`, b: `y${i}`, familyA: `family-${i}`, familyB: `family-${i}`, label: "follow_up" }));
      edges.push({ a: `x${i}`, b: `y${i}`, type: "follow-up" });
    }
    const nodes = ["a", "b", ...edges.flatMap((edge) => [edge.a, edge.b])].map((id) => ({ id }));
    const result = computeRelationMetrics(rows, { nodes, clusters: [{ id: "merged", members: ["a", "b"] }], edges });
    expect(result.falseMerge).toMatchObject({ count: 1, rate: 0.1 });
    expect(result.missedRelation.count).toBe(0);
  });

  it("agent-draft 不得改變人工 precision/recall，並分開計數", () => {
    const result = computeRelationMetrics([
      pairRow(),
      pairRow({ a: "a", b: "c", familyA: "", familyB: "", label: "different_event", labeledBy: "agent-draft" }),
    ], { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], clusters: [{ id: "merged", members: ["a", "b", "c"] }], edges: [] });
    expect(result.sameEvent.precision).toBe(1);
    expect(result.evaluated).toBe(1);
    expect(result.draftsExcluded).toBe(1);
  });

  it("同一已確認故事的相關 pair 若 family 不一致就拒絕切分", () => {
    expect(() => computeRelationMetrics([
      pairRow({ a: "a", b: "b", familyA: "story-1", familyB: "story-1" }),
      pairRow({ a: "a", b: "c", familyA: "story-2", familyB: "story-2", label: "follow_up" }),
    ], { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], clusters: [], edges: [] })).toThrow(/Conflicting human story families for event a/);
  });

  it("跨 tuning/holdout 的 different_event 保留全體指標，但不放進任一 split", () => {
    const first = "story-a";
    const second = ["story-b", "story-c", "story-d", "story-e"].find((family) => assignSplit(family) !== assignSplit(first));
    expect(second).toBeDefined();
    const rows = [
      pairRow({ a: "a", b: "b", familyA: first, familyB: first }),
      pairRow({ a: "c", b: "d", familyA: second, familyB: second }),
      pairRow({ a: "a", b: "c", familyA: first, familyB: second, label: "different_event" }),
    ];
    const net = { nodes: ["a", "b", "c", "d"].map((id) => ({ id })), clusters: [{ id: "ab", members: ["a", "b"] }, { id: "cd", members: ["c", "d"] }], edges: [] };
    const m = computeRelationMetrics(rows, net);
    expect(m.evaluated).toBe(3);
    expect(m.crossSplitExcluded).toBe(1);
    expect(m.splits.tuning.evaluated + m.splits.holdout.evaluated).toBe(2);
  });

  it("pair 事件 ID 不在重播快照時拒絕計分", () => {
    expect(() => computeRelationMetrics([
      pairRow({ a: "a", b: "missing", familyA: "fam-a", familyB: "fam-b", label: "different_event" }),
    ], { nodes: [{ id: "a" }], clusters: [], edges: [] })).toThrow(/event missing absent from benchmark snapshot/);
  });
});

describe("computeLocationMetrics", () => {
  it("role/precision 準確率；unknown 標籤不計成錯誤也不計成成功", () => {
    const events = [
      ev({ id: "e1", locationRole: "incident", locationPrecision: "city", region: "高雄市" }),
      ev({ id: "e2", locationRole: "agency", locationPrecision: "exact", region: "臺北市" }),
    ];
    const labels = [
      { schema: "location-labels/1", event: "e1", locationRole: "incident", locationPrecision: "exact", region: "高雄市", evidence: "x", labeledAt: "2026-09-17T00:00:00Z", labeledBy: "human" },
      { schema: "location-labels/1", event: "e2", locationRole: "unknown", locationPrecision: "exact", region: "臺北市", evidence: "x", labeledAt: "2026-09-17T00:00:00Z", labeledBy: "human" },
    ];
    const m = computeLocationMetrics(labels, events);
    expect(m.role.correct).toBe(1); // e1 對、e2 unknown 不計
    expect(m.role.total).toBe(1);
    expect(m.precision.correct).toBe(1); // e2 precision 對、e1 city≠exact 錯
    expect(m.precision.total).toBe(2);
    expect(m.unknownRate).toBeCloseTo(0.5); // e2 role 是 unknown → 1/2
  });

  it("agent-draft 地點不進 accuracy/unknownRate", () => {
    const rows = [
      { schema: "location-labels/1", event: "e1", locationRole: "incident", locationPrecision: "city", region: "高雄市", evidence: "x", labeledAt: "2026-09-17T00:00:00Z", labeledBy: "human" },
      { schema: "location-labels/1", event: "e1", locationRole: "agency", locationPrecision: "unknown", region: "臺北市", evidence: "x", labeledAt: "2026-09-17T00:00:00Z", labeledBy: "agent-draft" },
    ];
    const m = computeLocationMetrics(rows, [ev({ id: "e1", locationRole: "incident", locationPrecision: "city", region: "高雄市" })]);
    expect(m).toMatchObject({ labeled: 1, draftsExcluded: 1, unknownRate: 0, role: { accuracy: 1 }, precision: { accuracy: 1 } });
  });

  it("人工地點標註的事件若不在重播 cohort，拒絕計分", () => {
    const row = { schema: "location-labels/1", event: "missing", locationRole: "incident", locationPrecision: "city", region: "高雄市", evidence: "x", labeledAt: "2026-09-17T00:00:00Z", labeledBy: "human" };
    expect(() => computeLocationMetrics([row], [ev({ id: "a" })])).toThrow(/event missing absent from benchmark snapshot/);
  });
});

describe("benchmark CLI report", () => {
  it("--out 建立目錄且同一固定快照產出位元相同的報告", () => {
    const dir = mkdtempSync(join(process.cwd(), ".ground-truth-test-"));
    try {
      writeReplaySnapshot(dir, [ev({ id: "a" }), ev({ id: "b" })]);
      writeFileSync(join(dir, "pairs.jsonl"), JSON.stringify(pairRow()) + "\n");
      const input = relative(process.cwd(), dir);
      const args = [`--events=${input}/events.json`, `--pairs=${input}/pairs.jsonl`, `--out=${input}/nested/report.json`];
      runBenchmark(args);
      const first = readFileSync(join(dir, "nested", "report.json"), "utf8");
      runBenchmark(args);
      expect(readFileSync(join(dir, "nested", "report.json"), "utf8")).toBe(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("重播完整 cohort，保留未標註橋接事件造成的 A-C 群集", () => {
    const dir = mkdtempSync(join(process.cwd(), ".ground-truth-test-"));
    try {
      const a = ev({ id: "a", region: "高雄市", title: "甲公司查獲詐騙", aiEntities: ["甲公司"] });
      const bridge = ev({ id: "bridge", region: "臺南市", title: "中介案件", aiEntities: ["甲公司", "乙公司"] });
      const c = ev({ id: "c", region: "臺北市", title: "乙公司追查車手", aiEntities: ["乙公司"] });
      const full = correlateEvents([a, bridge, c]);
      expect(full.edges.map((edge: any) => [edge.a, edge.b])).toEqual([["a", "bridge"], ["bridge", "c"]]);
      expect(full.clusters[0].members).toEqual(["a", "bridge", "c"]);
      writeReplaySnapshot(dir, [a, bridge, c], [a, c]);
      writeFileSync(join(dir, "pairs.jsonl"), JSON.stringify(pairRow({ b: "c" })) + "\n");
      const input = relative(process.cwd(), dir);
      const report = runBenchmark([`--events=${input}/events.json`, `--pairs=${input}/pairs.jsonl`]);
      expect(report.relation.sameEvent).toMatchObject({ tp: 1, recall: 1 });
      expect(report.counts.events).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("重播 cohort SHA 不符時拒絕計分", () => {
    const dir = mkdtempSync(join(process.cwd(), ".ground-truth-test-"));
    try {
      writeReplaySnapshot(dir, [ev({ id: "a" }), ev({ id: "b" })]);
      writeFileSync(join(dir, "events.cohort.json.gz"), "corrupt");
      writeFileSync(join(dir, "pairs.jsonl"), JSON.stringify(pairRow()) + "\n");
      const input = relative(process.cwd(), dir);
      expect(() => runBenchmark([`--events=${input}/events.json`, `--pairs=${input}/pairs.jsonl`])).toThrow(/cohort SHA-256 mismatch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("candidate sampler", () => {
  it("產出固定 2 筆地點候選，人工欄位留空且重跑位元相同", async () => {
    const dir = mkdtempSync(join(process.cwd(), ".ground-truth-sample-test-"));
    try {
      const input = relative(process.cwd(), dir);
      writeFileSync(join(dir, "events.json"), JSON.stringify([
        ev({ id: "a", region: "高雄市" }),
        ev({ id: "b", region: "高雄市" }),
        ev({ id: "c", region: "高雄市" }),
      ]));
      const args = [
        `--input=${input}/events.json`,
        `--out=${input}/pairs.jsonl`,
        `--events-out=${input}/snapshot.json`,
        `--locations-out=${input}/locations.jsonl`,
        "--max=3", "--max-locations=2", "--seed=43",
      ];
      await runSample(args);
      const first = readFileSync(join(dir, "locations.jsonl"), "utf8");
      const cohortFirst = readFileSync(join(dir, "snapshot.cohort.json.gz"));
      const rows = first.trim().split("\n").map((line) => JSON.parse(line));
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ schema: "location-labels/1", locationRole: "", locationPrecision: "", labeledBy: "", sourceIdentity: expect.stringContaining("example.com") });
      await runSample(args);
      expect(readFileSync(join(dir, "locations.jsonl"), "utf8")).toBe(first);
      expect(readFileSync(join(dir, "snapshot.cohort.json.gz"))).toEqual(cohortFirst);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("過長新聞摘要拒絕截斷重播，也不留下部分候選輸出", async () => {
    const dir = mkdtempSync(join(process.cwd(), ".ground-truth-sample-test-"));
    try {
      const input = relative(process.cwd(), dir);
      writeFileSync(join(dir, "source.json"), JSON.stringify([ev({ id: "a", summary: "甲".repeat(301) })]));
      await expect(runSample([
        `--input=${input}/source.json`, `--out=${input}/pairs.jsonl`,
        `--events-out=${input}/snapshot.json`, `--locations-out=${input}/locations.jsonl`,
      ])).rejects.toThrow(/summary exceeds 300 characters/);
      expect(existsSync(join(dir, "pairs.jsonl"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("沒有任何 relation pair 時仍從全部事件抽地點並存入重播快照", async () => {
    const dir = mkdtempSync(join(process.cwd(), ".ground-truth-sample-test-"));
    try {
      const input = relative(process.cwd(), dir);
      const events = [
        ev({ id: "a", region: "臺北市", title: "機場航班調整" }),
        ev({ id: "b", region: "高雄市", title: "港區貨輪到港" }),
        ev({ id: "c", region: "花蓮縣", title: "山區道路整修" }),
      ];
      writeFileSync(join(dir, "events.json"), JSON.stringify(events));
      writeFileSync(join(dir, "network.json"), JSON.stringify({ nodes: events.map(({ id }) => ({ id })), edges: [], clusters: [] }));
      const result = await runSample([
        `--input=${input}/events.json`, `--network=${input}/network.json`,
        `--out=${input}/pairs.jsonl`, `--events-out=${input}/snapshot.json`,
        `--locations-out=${input}/locations.jsonl`, "--max=3", "--max-locations=2", "--seed=43",
      ]);
      const snapshot = JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8"));
      expect(result.pairs).toHaveLength(0);
      expect(result.locationCandidates).toHaveLength(2);
      expect(snapshot.events).toHaveLength(2);
      expect(snapshot.cohortCount).toBe(3);
      expect(new Set(snapshot.events.map(({ id }: { id: string }) => id))).toEqual(new Set(result.locationCandidates.map(({ event }: { event: string }) => event)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("抽樣重播完整保留 aiTopic，僅此線索建立的 edge 不會消失", async () => {
    const dir = mkdtempSync(join(process.cwd(), ".ground-truth-sample-test-"));
    try {
      const input = relative(process.cwd(), dir);
      const events = [
        ev({ id: "a", title: "航班調整", aiTopic: "共同議題甲" }),
        ev({ id: "b", title: "港區開發", aiTopic: "共同議題甲" }),
      ];
      expect(correlateEvents(events).edges).toEqual([expect.objectContaining({ type: "same-topic" })]);
      writeFileSync(join(dir, "source.json"), JSON.stringify(events));
      await runSample([
        `--input=${input}/source.json`, `--out=${input}/pairs.jsonl`,
        `--events-out=${input}/snapshot.json`, `--locations-out=${input}/locations.jsonl`,
        "--max=1", "--max-locations=1", "--seed=43",
      ]);
      const snapshot = JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8"));
      const cohort = JSON.parse(gunzipSync(readFileSync(join(dir, snapshot.cohortFile))).toString("utf8"));
      expect(cohort.events.map(({ aiTopic }: { aiTopic: string }) => aiTopic)).toEqual(["共同議題甲", "共同議題甲"]);
      expect(correlateEvents(cohort.events).edges).toEqual(correlateEvents(events).edges);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("diffBenchmarkReports — before/after 可比較", () => {
  it("指出改善與退化方向", () => {
    const before = { relation: { sameEvent: { precision: 0.5, recall: 0.8 } } };
    const after = { relation: { sameEvent: { precision: 0.9, recall: 0.7 } } };
    const diff = diffBenchmarkReports(before, after);
    expect(diff.find((d: any) => d.metric === "relation.sameEvent.precision").direction).toBe("improved");
    expect(diff.find((d: any) => d.metric === "relation.sameEvent.recall").direction).toBe("regressed");
  });
});
