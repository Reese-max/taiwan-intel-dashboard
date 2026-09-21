import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import {
  curationFingerprint,
  loadCurationLedger,
  resolveCuration,
} from "../scripts/lib/curation.mjs";
// @ts-expect-error — JS ESM module without types
import { correlateEvents } from "../scripts/lib/correlate.mjs";
// @ts-expect-error — JS ESM module without types
import { curateNewsEvents } from "../scripts/lib/curation.mjs";
// @ts-expect-error — JS ESM module without types
import { buildNetwork } from "../scripts/build-network.mjs";

// 最小事件工廠（同 tests/correlate.test.ts 慣例）
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

// 共享同一分局實體 → 自動 same-entity 邊 → 會 union 成同一 cluster 的兩事件
function clusterablePair(): [any, any] {
  return [
    ev({ id: "a", region: "高雄市", title: "鳳山分局破詐騙水房", source: { name: "來源A", type: "news-rss", recordRef: "https://example.com/a", fetchedAt: "" } }),
    ev({ id: "b", region: "臺南市", title: "鳳山分局協助查緝車手", timestamp: "2026-06-21T10:00:00+08:00", source: { name: "來源B", type: "news-rss", recordRef: "https://example.com/b", fetchedAt: "" } }),
  ];
}

// 完全無關的兩事件（不同區域、不同案類、無共享實體）→ 不會自動關聯
function unrelatedPair(): [any, any] {
  return [
    ev({ id: "u1", region: "臺北市", category: "治安", title: "信義區毒品案 查獲安非他命", source: { name: "來源A", type: "news-rss", recordRef: "https://example.com/u1", fetchedAt: "" } }),
    ev({ id: "u2", region: "嘉義縣", category: "交通", title: "國道追撞事故", timestamp: "2026-06-21T10:00:00+08:00", source: { name: "來源B", type: "news-rss", recordRef: "https://example.com/u2", fetchedAt: "" } }),
  ];
}

function pairRecord(decision: string, a: any, b: any, over: Record<string, unknown> = {}) {
  return {
    v: 1,
    decision,
    ids: [a.id, b.id],
    fingerprints: { [a.id]: curationFingerprint(a), [b.id]: curationFingerprint(b) },
    reason: "測試更正",
    evidence: "test-fixture",
    reviewedAt: "2026-09-17T00:00:00Z",
    ...over,
  };
}

describe("loadCurationLedger", () => {
  it("ledger 檔不存在 → 空 records、無 errors（clean checkout 不破）", () => {
    const dir = mkdtempSync(join(tmpdir(), "cur-"));
    try {
      const ledger = loadCurationLedger(join(dir, "missing.jsonl"));
      expect(ledger.records).toEqual([]);
      expect(ledger.errors).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("合法行收錄、壞行進 errors 附行號、缺欄位行被拒", () => {
    const dir = mkdtempSync(join(tmpdir(), "cur-"));
    try {
      const [a, b] = clusterablePair();
      const good = pairRecord("not_same_event", a, b);
      const path = join(dir, "ledger.jsonl");
      writeFileSync(path, [
        JSON.stringify(good),
        "{not json",
        JSON.stringify({ v: 1, decision: "same_event", ids: ["a"] }), // 缺 fingerprint/reason、ids 數量錯
        "",
      ].join("\n"));
      const ledger = loadCurationLedger(path);
      expect(ledger.records).toHaveLength(1);
      expect(ledger.records[0].decision).toBe("not_same_event");
      expect(ledger.errors).toHaveLength(2);
      expect(ledger.errors.map((e: any) => e.line).sort()).toEqual([2, 3]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveCuration + correlateEvents", () => {
  it("not_same_event：自動會併的 pair 不再產生邊、不成群；rebuild 不再重併", () => {
    const [a, b] = clusterablePair();
    const baseline = correlateEvents([a, b]);
    expect(baseline.clusters.length).toBeGreaterThan(0); // 前置確認：此 pair 本來會自動併

    const record = pairRecord("not_same_event", a, b);
    const resolution = resolveCuration([record], [a, b]);
    const net = correlateEvents([a, b], { corrections: resolution });
    expect(net.edges.find((e: any) => [e.a, e.b].sort().join("|") === "a|b")).toBeUndefined();
    expect(net.clusters).toEqual([]);
    expect(resolution.report.applied).toHaveLength(1);
  });

  it("not_same_event 只阻擋直接 pair，不影響其他邊", () => {
    const [a, b] = clusterablePair();
    const c = ev({ id: "c", region: "嘉義縣", title: "板橋分局事故後續追蹤", timestamp: "2026-06-21T11:00:00+08:00", source: { name: "來源C", type: "news-rss", recordRef: "https://example.com/c", fetchedAt: "" } });
    // b2 與 a 共享「鳳山分局」（被 override 抑制）、與 c 共享「板橋分局」（保留）——沿用 correlate.test.ts 已驗證的標題
    const b2 = ev({ id: "b", region: "臺南市", title: "鳳山分局 板橋分局中心事件", timestamp: "2026-06-21T10:00:00+08:00", source: { name: "來源B", type: "news-rss", recordRef: "https://example.com/b", fetchedAt: "" } });
    const record = pairRecord("not_same_event", a, b2);
    const resolution = resolveCuration([record], [a, b2, c]);
    const net = correlateEvents([a, b2, c], { corrections: resolution });
    // b-c（共享板橋分局）仍可成群；a 獨立
    const cluster = net.clusters.find((cl: any) => cl.members.includes("b"));
    expect(cluster?.members.sort()).toEqual(["b", "c"]);
    expect(net.edges.find((e: any) => [e.a, e.b].sort().join("|") === "a|b")).toBeUndefined();
  });

  it("same_event：無關 pair 被強制併入同一 cluster，邊標註人工來源", () => {
    const [u1, u2] = unrelatedPair();
    const baseline = correlateEvents([u1, u2]);
    expect(baseline.clusters).toEqual([]); // 前置確認：本來不會併

    const record = pairRecord("same_event", u1, u2);
    const resolution = resolveCuration([record], [u1, u2]);
    const net = correlateEvents([u1, u2], { corrections: resolution });
    expect(net.clusters.length).toBe(1);
    expect(net.clusters[0].members.sort()).toEqual(["u1", "u2"]);
    const edge = net.edges.find((e: any) => [e.a, e.b].sort().join("|") === "u1|u2");
    expect(edge.why).toContain("人工更正");
  });

  it("location_correction：不改寫原事件，patch 後的副本反映新地區", () => {
    const target = ev({ id: "loc1", region: "臺北市", title: "測試事件", source: { name: "來源A", type: "news-rss", recordRef: "https://example.com/loc1", fetchedAt: "" } });
    const record = {
      v: 1,
      decision: "location_correction",
      ids: ["loc1"],
      location: { region: "高雄市", lat: 22.6, lng: 120.3, locationPrecision: "city" },
      fingerprints: { loc1: curationFingerprint(target, { withLocation: true }) },
      reason: "地點標錯",
      evidence: "test-fixture",
      reviewedAt: "2026-09-17T00:00:00Z",
    };
    const resolution = resolveCuration([record], [target]);
    const patched = resolution.patchedById.get("loc1");
    expect(target.region).toBe("臺北市"); // 原物件不被改寫
    expect(patched.region).toBe("高雄市");
    expect(patched.lat).toBe(22.6);
    const net = correlateEvents([patched], { corrections: resolution });
    expect(net.nodes.find((n: any) => n.id === "loc1").region).toBe("高雄市");
  });

  it("follow_up：ids[0]=後續報導 → 產出 deterministic followUps 區段", () => {
    const [a, b] = clusterablePair();
    const record = pairRecord("follow_up", a, b);
    const resolution = resolveCuration([record], [a, b]);
    expect(resolution.followUps).toEqual([
      expect.objectContaining({ from: "a", to: "b", reason: "測試更正" }),
    ]);
    expect(resolution.report.applied).toHaveLength(1);
  });

  it("同一 ledger + 同一 snapshot → 輸出 deterministic", () => {
    const [a, b] = clusterablePair();
    const record = pairRecord("not_same_event", a, b);
    const r1 = resolveCuration([record], [a, b]);
    const r2 = resolveCuration([record], [a, b]);
    const net1 = correlateEvents([a, b], { corrections: r1 });
    const net2 = correlateEvents([a, b], { corrections: r2 });
    expect(JSON.stringify(net1)).toBe(JSON.stringify(net2));
    expect(JSON.stringify(r1.report)).toBe(JSON.stringify(r2.report));
  });

  it("fingerprint 不符 → needs_review、不套用（不錯套到改過的內容）", () => {
    const [a, b] = clusterablePair();
    const record = pairRecord("not_same_event", a, b, {
      fingerprints: { a: "sha256:stale", b: curationFingerprint(b) },
    });
    const resolution = resolveCuration([record], [a, b]);
    expect(resolution.report.applied).toHaveLength(0);
    expect(resolution.report.skipped).toHaveLength(1);
    expect(resolution.report.skipped[0].status).toBe("needs_review");
    expect(resolution.report.skipped[0].reason).toBe("evidence-changed");
    const net = correlateEvents([a, b], { corrections: resolution });
    expect(net.clusters.length).toBeGreaterThan(0); // 未套用 → 維持自動行為
  });

  it("id 不存在 → needs_review，不套用", () => {
    const [a, b] = clusterablePair();
    const record = pairRecord("not_same_event", a, b, { ids: ["a", "ghost"], fingerprints: { a: curationFingerprint(a), ghost: "sha256:x" } });
    const resolution = resolveCuration([record], [a, b]);
    expect(resolution.report.skipped[0].reason).toBe("event-not-found");
    expect(resolution.forbidden.size).toBe(0);
  });

  it("矛盾 override（同 pair same_event + not_same_event）→ conflict、兩者皆不套用", () => {
    const [a, b] = clusterablePair();
    const records = [pairRecord("same_event", a, b), pairRecord("not_same_event", a, b)];
    const resolution = resolveCuration(records, [a, b]);
    expect(resolution.report.conflicts).toHaveLength(1);
    expect(resolution.report.applied).toHaveLength(0);
    expect(resolution.forced.size).toBe(0);
    expect(resolution.forbidden.size).toBe(0);
    const net = correlateEvents([a, b], { corrections: resolution });
    expect(net.clusters.length).toBeGreaterThan(0); // 回歸自動行為
  });

  it("curateNewsEvents：記錄依 scope 分桶，跨 scope pair 標 needs_review", () => {
    const [a, b] = clusterablePair();
    const intl = ev({ id: "i1", region: "海外", scope: "international", title: "國際事件", source: { name: "外媒", type: "news-rss", recordRef: "https://example.com/i1", fetchedAt: "" } });
    const dir = mkdtempSync(join(tmpdir(), "cur-"));
    try {
      const ledgerPath = join(dir, "ledger.jsonl");
      writeFileSync(ledgerPath, [
        JSON.stringify(pairRecord("not_same_event", a, b)),                                        // → domestic
        JSON.stringify(pairRecord("same_event", a, intl)),                                          // 跨 scope
        JSON.stringify({ ...pairRecord("follow_up", a, b), ids: ["x1", "x2"], fingerprints: { x1: "sha256:0", x2: "sha256:0" } }), // 全缺 → event-not-found
      ].join("\n"));
      const curated = curateNewsEvents({ domestic: [a, b], international: [intl] }, { ledgerPath });
      expect(curated.corrections.domestic.forbidden.has("a|b")).toBe(true);
      expect(curated.corrections.international.forbidden.size).toBe(0);
      const overrides = curated.collectOverrides();
      const reasons = overrides.report.skipped.map((s: any) => s.reason).sort();
      expect(reasons).toEqual(["cross-scope", "event-not-found"]);
      expect(overrides.report.applied).toEqual([
        expect.objectContaining({ scope: "domestic", decision: "not_same_event" }),
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("buildNetwork：ledger 掛進 network.overrides，且更正實際生效", () => {
    const [a, b] = clusterablePair();
    const dir = mkdtempSync(join(tmpdir(), "cur-"));
    try {
      const ledgerPath = join(dir, "ledger.jsonl");
      writeFileSync(ledgerPath, JSON.stringify(pairRecord("not_same_event", a, b)) + "\n");
      const net = buildNetwork([a, b], [], "2026-09-17T00:00:00Z", { ledgerPath, snapshotId: "test-snap", rulesVersion: "test" });
      expect(net.overrides.schemaVersion).toBe(1);
      expect(net.overrides.report.applied).toHaveLength(1);
      expect(net.domestic.clusters).toEqual([]); // a|b 被抑制
      const baseline = buildNetwork([a, b], [], "2026-09-17T00:00:00Z", { ledgerPath: join(dir, "missing.jsonl"), snapshotId: "test-snap", rulesVersion: "test" });
      expect(baseline.domestic.clusters.length).toBeGreaterThan(0); // 無 ledger → 自動併
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("not_same_event 阻擋 transitive 合併：a-b 抑制後不得經 c 黏回同群", () => {
    // 三事件兩兩共享「鳳山分局」→ 三條 same-entity 邊；禁 a-b 後 b-c union 會把 b 黏進 {a,c}
    const a = ev({ id: "a", region: "高雄市", title: "鳳山分局破詐騙水房", source: { name: "來源A", type: "news-rss", recordRef: "https://example.com/a", fetchedAt: "" } });
    const b = ev({ id: "b", region: "臺南市", title: "鳳山分局協助查緝車手", timestamp: "2026-06-21T10:00:00+08:00", source: { name: "來源B", type: "news-rss", recordRef: "https://example.com/b", fetchedAt: "" } });
    const c = ev({ id: "c", region: "嘉義縣", title: "鳳山分局事故後續追蹤", timestamp: "2026-06-21T11:00:00+08:00", source: { name: "來源C", type: "news-rss", recordRef: "https://example.com/c", fetchedAt: "" } });
    const baseline = correlateEvents([a, b, c]);
    expect(baseline.clusters[0]?.size).toBe(3); // 前置確認：三者本來併一群

    const record = pairRecord("not_same_event", a, b);
    const resolution = resolveCuration([record], [a, b, c]);
    const net = correlateEvents([a, b, c], { corrections: resolution });
    expect(net.clusters.map((cl: any) => cl.members.sort())).toEqual([["a", "c"]]);
    expect(net.edges.find((e: any) => [e.a, e.b].sort().join("|") === "a|b")).toBeUndefined();
  });

  it("same_event 被 not_same_event 經第三事件間接擋下 → 邊移除、report 標 blocked", () => {
    // same_event(a,b)+same_event(a,c)+not_same_event(b,c)：a-c 的 union 會把 b,c 黏回 → 擋下
    const [u1, u2] = unrelatedPair();
    const u3 = ev({ id: "u3", region: "屏東縣", category: "其他", title: "無關事件", timestamp: "2026-06-22T10:00:00+08:00", source: { name: "來源C", type: "news-rss", recordRef: "https://example.com/u3", fetchedAt: "" } });
    const records = [
      pairRecord("same_event", u1, u2),
      pairRecord("same_event", u1, u3),
      pairRecord("not_same_event", u2, u3),
    ];
    const resolution = resolveCuration(records, [u1, u2, u3]);
    const net = correlateEvents([u1, u2, u3], { corrections: resolution });
    expect(net.edges.find((e: any) => [e.a, e.b].sort().join("|") === "u1|u2")).toBeTruthy();
    expect(net.edges.find((e: any) => [e.a, e.b].sort().join("|") === "u1|u3")).toBeUndefined(); // 被擋的邊不留在圖裡
    expect(net.clusters.map((cl: any) => cl.members.sort())).toEqual([["u1", "u2"]]);
    expect(resolution.report.applied).toHaveLength(2); // same_event(u1,u2) + not_same_event(u2,u3)
    expect(resolution.report.skipped).toEqual([
      expect.objectContaining({ decision: "same_event", reason: "blocked-by-not_same_event", status: "needs_review" }),
    ]);
  });

  it("follow_up 兩方向互斥 → conflict；同方向才輸出", () => {
    const [a, b] = clusterablePair();
    const fwd = pairRecord("follow_up", a, b);
    const rev = { ...fwd, ids: [b.id, a.id] };
    const resolution = resolveCuration([fwd, rev], [a, b]);
    expect(resolution.report.conflicts).toHaveLength(1);
    expect(resolution.followUps).toEqual([]);
  });

  it("follow_up 斷言不同事件 → 同時抑制自動合併", () => {
    const [a, b] = clusterablePair();
    const resolution = resolveCuration([pairRecord("follow_up", a, b)], [a, b]);
    const net = correlateEvents([a, b], { corrections: resolution });
    expect(net.clusters).toEqual([]); // 不再自動併
    expect(resolution.followUps).toHaveLength(1);
  });

  it("同 pair 先 stale 後 fresh → 採用 fresh，stale 逐筆 needs_review", () => {
    const [a, b] = clusterablePair();
    const stale = pairRecord("not_same_event", a, b, { fingerprints: { a: "sha256:stale", b: curationFingerprint(b) } });
    const fresh = pairRecord("not_same_event", a, b, { reason: "更新後的更正", reviewedAt: "2026-09-18T00:00:00Z" });
    const resolution = resolveCuration([stale, fresh], [a, b]);
    expect(resolution.forbidden.has("a|b")).toBe(true);
    expect(resolution.report.applied).toEqual([expect.objectContaining({ reviewedAt: fresh.reviewedAt })]);
    expect(resolution.report.skipped).toEqual([
      expect.objectContaining({ status: "needs_review", reason: "evidence-changed" }),
    ]);
  });

  it("location_correction：非法 payload 被 schema 擋下", () => {
    const dir = mkdtempSync(join(tmpdir(), "cur-"));
    try {
      const target = ev({ id: "loc1" });
      const base = { v: 1, decision: "location_correction", ids: ["loc1"], fingerprints: { loc1: curationFingerprint(target, { withLocation: true }) }, reason: "r", evidence: "e", reviewedAt: "2026-09-17T00:00:00Z" };
      const path = join(dir, "ledger.jsonl");
      writeFileSync(path, [
        JSON.stringify({ ...base, location: { lat: 22.6 } }),                    // 只給 lat → 成對檢查
        `{"v":1,"decision":"location_correction","ids":["loc1"],"location":{"lat":1e999,"lng":120},"fingerprints":{"loc1":"sha256:x"},"reason":"r","evidence":"e","reviewedAt":"2026-09-17T00:00:00Z"}`, // Infinity
        JSON.stringify({ ...base, location: { latt: 22.6 } }),                   // 未知 key（typo）
        JSON.stringify({ ...base, location: {} }),                               // 空物件
        JSON.stringify({ ...base, location: { region: "" } }),                   // 空 region
        JSON.stringify({ ...base, location: { locationPrecision: "exactt" } }),  // 未知 precision
        JSON.stringify({ ...base, ids: ["loc1", "loc1"] }),                      // 自環
        JSON.stringify({ ...pairRecord("same_event", target, target), ids: ["a|b", "c"] }), // id 含分隔符
      ].join("\n"));
      const ledger = loadCurationLedger(path);
      expect(ledger.records).toHaveLength(0);
      expect(ledger.errors).toHaveLength(8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("CURATION_LEDGER_PATH 環境變數可覆寫 ledger 位置（測試隔離）", () => {
    const [a, b] = clusterablePair();
    const dir = mkdtempSync(join(tmpdir(), "cur-"));
    const prev = process.env.CURATION_LEDGER_PATH;
    try {
      const ledgerPath = join(dir, "env-ledger.jsonl");
      writeFileSync(ledgerPath, JSON.stringify(pairRecord("not_same_event", a, b)) + "\n");
      process.env.CURATION_LEDGER_PATH = ledgerPath;
      const curated = curateNewsEvents({ domestic: [a, b] });
      expect(curated.corrections.domestic.forbidden.has("a|b")).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.CURATION_LEDGER_PATH;
      else process.env.CURATION_LEDGER_PATH = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("同 decision 重複記錄 → 視為同一筆套用（不衝突）", () => {
    const [a, b] = clusterablePair();
    const records = [pairRecord("not_same_event", a, b), pairRecord("not_same_event", a, b, { reason: "另一理由" })];
    const resolution = resolveCuration(records, [a, b]);
    expect(resolution.report.conflicts).toHaveLength(0);
    expect(resolution.forbidden.size).toBe(1);
  });
});
