import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  fingerprintEvent,
  ledgerBenchmarkEvidence,
  loadCurationLedger,
  parseLedgerText,
  resolveCurationLedger,
} from "../scripts/lib/curation-ledger.mjs";
import { correlateEvents } from "../scripts/lib/correlate.mjs";
import { buildNetwork } from "../scripts/build-network.mjs";
import { RULES_VERSION } from "../scripts/lib/manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// 最小事件工廠（只填關聯引擎會用到的欄位）
function ev(over: Record<string, unknown> = {}): any {
  return {
    id: "twnews-x",
    title: "標題",
    region: "臺北市",
    timestamp: "2026-06-20T10:00:00+08:00",
    category: "治安",
    scope: "domestic",
    riskLevel: "medium",
    summary: "",
    source: { name: "中央社 社會", type: "news-rss", fetchedAt: "2026-06-20T10:00:00+08:00" },
    ...over,
  };
}

// 兩個會被自動判為 same-incident 的事件（同縣市、案類詞+實體重疊、跨源、時間相近）。
function autoPair() {
  return [
    ev({ id: "twnews-aa", title: "信義分局破獲毒品水房 查獲安非他命", timestamp: "2026-06-20T10:00:00+08:00", source: { name: "來源A", type: "news-rss", fetchedAt: "" } }),
    ev({ id: "twnews-bb", title: "信義分局緝毒案 起獲海洛因毒品", timestamp: "2026-06-20T14:00:00+08:00", source: { name: "來源B", type: "news-rss", fetchedAt: "" } }),
  ];
}

function rec(over: Record<string, unknown> = {}): any {
  return {
    schemaVersion: 1,
    id: "cur-test-001",
    decision: "not_same_event",
    subjects: ["twnews-aa", "twnews-bb"],
    reason: "人工檢視後判定不同事件",
    evidence: "https://example.invalid/review/1",
    reviewedAt: "2026-09-30T00:00:00.000Z",
    rulesVersion: RULES_VERSION,
    ...over,
  };
}

function expectOf(events: any[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of events) out[e.id] = fingerprintEvent(e);
  return out;
}

function edgeBetween(net: any, a: string, b: string) {
  return net.edges.find((e: any) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
}

describe("curation ledger — 解析", () => {
  it("跳過空行與 # 註解；壞 JSON 行記為 parse error", () => {
    const text = [
      "# curation ledger",
      "",
      '{"schemaVersion":1,"id":"a"}',
      "   ",
      "not-json",
      "# 尾行註解",
    ].join("\n");
    const { entries, errors } = parseLedgerText(text);
    expect(errors).toEqual([]);
    expect(entries).toHaveLength(2);
    expect(entries[0].record.id).toBe("a");
    expect(entries[1].error).toBeTruthy();
    expect(entries[1].line).toBe(5);
  });

  it("ledger 檔案不存在時回傳空清單（可選檔）", () => {
    const { entries, exists } = loadCurationLedger(join(HERE, "fixtures", "no-such-ledger.jsonl"));
    expect(exists).toBe(false);
    expect(entries).toEqual([]);
  });

  it("載入 repo 內的正式 ledger 檔（docs/curation/correlation-overrides.jsonl 為純註解種子）", () => {
    const { entries, exists } = loadCurationLedger(join(HERE, "..", "docs", "curation", "correlation-overrides.jsonl"));
    expect(exists).toBe(true);
    expect(entries.filter((e: any) => e.error)).toEqual([]);
  });
});

describe("fingerprintEvent — 來源版本指紋", () => {
  it("[PR68 regression] reviewed evidence changes become needs_review, while fetch time alone remains valid", () => {
    const events = autoPair();
    const record = rec({ expect: expectOf(events) });
    const changes = [
      { summary: "原文更正：另一起案件" },
      { category: "司法" },
      { lat: 25.03, lng: 121.56 },
      { locationRole: "agency" },
      { locationPrecision: "exact" },
      { locationNote: "機關所在地" },
      { locationSourceBasis: "官方更正座標" },
      { aiEntities: ["不同組織"] },
      { aiTopic: "另一事件" },
      { source: { ...events[0].source, recordRef: "https://example.invalid/changed" } },
    ];
    for (const change of changes) {
      const changed = [{ ...events[0], ...change }, events[1]];
      const result = resolveCurationLedger([record], changed);
      expect(result.decisions[0], JSON.stringify(change)).toMatchObject({ status: "needs_review", note: "fingerprint_mismatch" });
      expect(result.blockedPairs).toEqual([]);
    }
    const fetched = events.map((e) => ({ ...e, source: { ...e.source, fetchedAt: "2026-10-01T00:00:00Z" } }));
    expect(resolveCurationLedger([record], fetched).decisions[0].status).toBe("applied");
  });

  it("同一事件指紋穩定；關鍵欄位改變則指紋改變", () => {
    const a = ev({ id: "twnews-aa", title: "信義分局破案" });
    expect(fingerprintEvent(a)).toBe(fingerprintEvent({ ...a }));
    expect(fingerprintEvent(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintEvent({ ...a, title: "改標題" })).not.toBe(fingerprintEvent(a));
    expect(fingerprintEvent({ ...a, region: "高雄市" })).not.toBe(fingerprintEvent(a));
    expect(fingerprintEvent({ ...a, timestamp: "2026-06-21T10:00:00+08:00" })).not.toBe(fingerprintEvent(a));
  });
});

describe("resolveCurationLedger — 驗證與狀態", () => {
  it("[PR68 regression] transitive manual contradictions fail closed without affecting unrelated decisions", () => {
    const events = ["a", "b", "c", "d", "e"].map((id) => ev({ id: `twnews-${id}`, title: id }));
    const pair = (id: string, decision: string, a: number, b: number) => rec({
      id, decision, subjects: [events[a].id, events[b].id], expect: expectOf([events[a], events[b]]),
    });
    for (const decision of ["not_same_event", "follow_up"]) {
      const records = [pair("ab", "same_event", 0, 1), pair("bc", "same_event", 1, 2), pair("ac", decision, 0, 2), pair("de", "same_event", 3, 4)];
      const withDirectConflict = [...records, pair("direct", "same_event", 0, 2)];
      for (const curation of [records, [...records].reverse(), withDirectConflict, [...withDirectConflict].reverse()]) {
        const result = resolveCurationLedger(curation, events);
        expect(result.stats.conflicts).toBe(curation.length - 1);
        expect(result.decisions.filter((d: any) => d.id !== "de").every((d: any) => d.status === "conflict")).toBe(true);
        expect(result.sameEventPairs.map((p: any) => p.recordId)).toEqual(["de"]);
        expect(result.blockedPairs).toEqual([]);
        expect(result.followUps).toEqual([]);
        expect(correlateEvents(events, { curation }).clusters.map((c: any) => c.members)).toEqual([["twnews-d", "twnews-e"]]);
      }
    }
  });

  it("[PR68 regression] equivalent location patches ignore JSON key order", () => {
    const events = autoPair();
    const record = rec({ decision: "location_correction", subjects: [events[0].id], expect: expectOf([events[0]]) });
    const result = resolveCurationLedger([
      { ...record, id: "loc1", patch: { region: "高雄市", locationRole: "agency" } },
      { ...record, id: "loc2", patch: { locationRole: "agency", region: "高雄市" } },
    ], events);
    expect(result.stats.conflicts).toBe(0);
    expect(result.stats.applied).toBe(2);
    expect(result.locationPatches.get(events[0].id)?.patch).toEqual({ region: "高雄市", locationRole: "agency" });
  });

  it("有效 not_same_event 記錄套用成功", () => {
    const events = autoPair();
    const r = resolveCurationLedger([rec({ expect: expectOf(events) })], events, { rulesVersion: RULES_VERSION });
    expect(r.decisions[0].status).toBe("applied");
    expect(r.stats.applied).toBe(1);
    expect(r.blockedPairs).toHaveLength(1);
    expect(r.blockedPairs[0].ids).toContain("cur-test-001");
  });

  it("subject 不存在於本 scope → needs_review（subject_not_found），不套用", () => {
    const events = autoPair();
    const expect_ = expectOf(events);
    expect_["twnews-zz"] = expect_["twnews-bb"];
    delete expect_["twnews-bb"];
    const r = resolveCurationLedger([rec({ subjects: ["twnews-aa", "twnews-zz"], expect: expect_ })], events, {
      rulesVersion: RULES_VERSION,
    });
    expect(r.decisions[0].status).toBe("needs_review");
    expect(r.decisions[0].note).toBe("subject_not_found");
    expect(r.blockedPairs).toHaveLength(0);
  });

  it("指紋不符 → needs_review（fingerprint_mismatch），不默默套用到已變內容", () => {
    const events = autoPair();
    const expect_ = expectOf(events);
    expect_["twnews-bb"] = "0".repeat(64);
    const r = resolveCurationLedger([rec({ expect: expect_ })], events, { rulesVersion: RULES_VERSION });
    expect(r.decisions[0].status).toBe("needs_review");
    expect(r.decisions[0].note).toBe("fingerprint_mismatch");
    expect(r.blockedPairs).toHaveLength(0);
  });

  it("rulesVersion 不符 → needs_review（rules_version_mismatch）", () => {
    const events = autoPair();
    const r = resolveCurationLedger(
      [rec({ expect: expectOf(events), rulesVersion: "correlate-v0" })],
      events,
      { rulesVersion: RULES_VERSION },
    );
    expect(r.decisions[0].status).toBe("needs_review");
    expect(r.decisions[0].note).toBe("rules_version_mismatch");
  });

  it("schema 缺欄位／非法值 → invalid，不套用", () => {
    const events = autoPair();
    const base = rec({ expect: expectOf(events) });
    const cases = [
      { ...base, schemaVersion: 2 },
      { ...base, decision: "merge_them" },
      { ...base, subjects: ["twnews-aa"] }, // pair 決策必須 2 主體
      { ...base, subjects: ["twnews-aa", "標題不是 id 的 鍵"] }, // 自由文字標題禁作鍵
      { ...base, expect: undefined },
      { ...base, expect: { "twnews-aa": "x" } }, // expect 未覆蓋全部 subjects
      { ...base, reason: "" },
      { ...base, evidence: "" },
      { ...base, reviewedAt: "not-a-date" },
      { ...base, id: "" },
      { ...base, benchmark: "always" },
    ];
    const r = resolveCurationLedger(cases, events, { rulesVersion: RULES_VERSION });
    expect(r.decisions.map((d: any) => d.status)).toEqual(cases.map(() => "invalid"));
    expect(r.stats.invalid).toBe(cases.length);
    expect(r.blockedPairs).toHaveLength(0);
  });

  it("同一 pair 的矛盾 override（same_event × not_same_event）→ 雙雙 conflict，不取最後一筆", () => {
    const events = autoPair();
    const r = resolveCurationLedger(
      [
        rec({ id: "cur-1", decision: "same_event", expect: expectOf(events) }),
        rec({ id: "cur-2", decision: "not_same_event", expect: expectOf(events) }),
      ],
      events,
      { rulesVersion: RULES_VERSION },
    );
    expect(r.decisions.map((d: any) => d.status)).toEqual(["conflict", "conflict"]);
    expect(r.stats.conflicts).toBe(2);
    expect(r.blockedPairs).toHaveLength(0);
    expect(r.sameEventPairs).toHaveLength(0);
  });

  it("follow_up 同 pair 但方向相反 → conflict；not_same_event + follow_up 相容", () => {
    const events = autoPair();
    const [a, b] = events;
    const expect_ = expectOf(events);
    const contra = resolveCurationLedger(
      [
        rec({ id: "f1", decision: "follow_up", subjects: [a.id, b.id], expect: expect_ }),
        rec({ id: "f2", decision: "follow_up", subjects: [b.id, a.id], expect: expect_ }),
      ],
      events,
      { rulesVersion: RULES_VERSION },
    );
    expect(contra.decisions.map((d: any) => d.status)).toEqual(["conflict", "conflict"]);

    const ok = resolveCurationLedger(
      [
        rec({ id: "n1", decision: "not_same_event", subjects: [a.id, b.id], expect: expect_ }),
        rec({ id: "f1", decision: "follow_up", subjects: [a.id, b.id], expect: expect_ }),
      ],
      events,
      { rulesVersion: RULES_VERSION },
    );
    expect(ok.decisions.map((d: any) => d.status)).toEqual(["applied", "applied"]);
    expect(ok.blockedPairs).toHaveLength(1);
    expect(ok.followUps).toHaveLength(1);
    expect(ok.followUps[0]).toMatchObject({ from: a.id, to: b.id, recordId: "f1" });
  });

  it("location_correction 同主體不同 patch → conflict", () => {
    const events = autoPair();
    const [a] = events;
    const r = resolveCurationLedger(
      [
        rec({ id: "l1", decision: "location_correction", subjects: [a.id], expect: expectOf([a]), patch: { locationRole: "agency" } }),
        rec({ id: "l2", decision: "location_correction", subjects: [a.id], expect: expectOf([a]), patch: { locationRole: "incident" } }),
      ],
      events,
      { rulesVersion: RULES_VERSION },
    );
    expect(r.decisions.map((d: any) => d.status)).toEqual(["conflict", "conflict"]);
    expect(r.locationPatches.size).toBe(0);
  });

  it("parse error 行 → invalid 審計項，不影響其他記錄", () => {
    const events = autoPair();
    const r = resolveCurationLedger(
      [{ line: 3, error: "json_parse_error" }, rec({ id: "ok-1", expect: expectOf(events) })],
      events,
      { rulesVersion: RULES_VERSION },
    );
    expect(r.decisions[0].status).toBe("invalid");
    expect(r.decisions[1].status).toBe("applied");
  });

  it("scope 隔離：intl 主體在 domestic resolve 中不評估", () => {
    const events = autoPair();
    const r = resolveCurationLedger([rec({ subjects: ["intl-x", "intl-y"], expect: { "intl-x": "f", "intl-y": "g" } })], events, {
      rulesVersion: RULES_VERSION,
    });
    expect(r.decisions).toHaveLength(0);
    expect(r.stats.outOfScope).toBe(1);
  });
});

describe("correlateEvents + curation — 人工更正層", () => {
  it("[PR68 regression] manual same_event unions take priority over automatic candidates", () => {
    const events = ["a", "b", "c"].map((id, i) => ev({
      id: `twnews-${id}`, title: `信義分局毒品案 ${id}`, source: { name: `來源${i}`, type: "news-rss" },
    }));
    const pair = (decision: string, a: number, b: number) => rec({
      id: decision, decision, subjects: [events[a].id, events[b].id], expect: expectOf([events[a], events[b]]),
    });
    const net = correlateEvents(events, { curation: [pair("same_event", 1, 2), pair("not_same_event", 0, 2)] });
    expect(net.clusters.map((c: any) => c.members)).toEqual([["twnews-b", "twnews-c"]]);
    expect(net.curation.applied).toBe(2);
    expect(net.curation.vetoes).toEqual([expect.objectContaining({ a: "twnews-a", b: "twnews-b" })]);
  });

  it("[PR68 regression] follow_up replaces a pre-existing automatic same-incident relation", () => {
    const events = autoPair();
    expect(correlateEvents(events).clusters).toHaveLength(1);
    const net = correlateEvents(events, { curation: [rec({ decision: "follow_up", expect: expectOf(events) })] });
    expect(net.edges).toEqual([expect.objectContaining({ type: "follow-up", origin: "manual", from: events[0].id, to: events[1].id })]);
    expect(net.clusters).toEqual([]);
    expect(net.curation.removedAutoEdges).toBe(1);
    expect(net.nodes.map((n: any) => n.degree)).toEqual([1, 1]);
  });

  it("[PR68 regression] follow_up cannot be re-merged through an automatic third report", () => {
    const events = ["a", "b", "c"].map((id, i) => ev({
      id: `twnews-${id}`, title: `信義分局毒品案 ${id}`, source: { name: `來源${i}`, type: "news-rss" },
    }));
    const net = correlateEvents(events, { curation: [rec({
      decision: "follow_up", subjects: [events[0].id, events[2].id], expect: expectOf([events[0], events[2]]),
    })] });
    expect(net.clusters.some((c: any) => c.members.includes(events[0].id) && c.members.includes(events[2].id))).toBe(false);
    expect(net.edges.filter((e: any) => e.type === "follow-up")).toHaveLength(1);
    expect(net.curation.vetoedUnions).toBe(1);
  });

  it("not_same_event：重建後不再自動合併（邊移除 + 不再同群）", () => {
    const events = autoPair();
    const before = correlateEvents(events);
    expect(edgeBetween(before, "twnews-aa", "twnews-bb")).toBeTruthy();

    const net = correlateEvents(events, {
      curation: [rec({ id: "cur-ns", expect: expectOf(events) })],
      rulesVersion: RULES_VERSION,
    });
    expect(edgeBetween(net, "twnews-aa", "twnews-bb")).toBeFalsy();
    expect(net.clusters).toEqual([]);
    expect(net.curation.applied).toBe(1);
    expect(net.curation.decisions[0]).toMatchObject({ id: "cur-ns", status: "applied" });
  });

  it("not_same_event 傳遞約束：A-B 被禁後，即使 A-C、B-C 各自可連也不會把 A,B 併同群", () => {
    const a = ev({ id: "twnews-a1", title: "鳳山分局 毒品案 A", source: { name: "來源A", type: "news-rss", fetchedAt: "" } });
    const b = ev({ id: "twnews-b1", title: "鳳山分局 毒品案 B", source: { name: "來源B", type: "news-rss", fetchedAt: "" } });
    const c = ev({ id: "twnews-c1", title: "鳳山分局 毒品案 C", source: { name: "來源A", type: "news-rss", fetchedAt: "" }, timestamp: "2026-06-20T12:00:00+08:00" });
    const events = [a, b, c];
    const net = correlateEvents(events, {
      curation: [rec({ id: "cur-ns", subjects: [a.id, b.id], expect: expectOf([a, b]) })],
      rulesVersion: RULES_VERSION,
    });
    const cluster = (id: string) => net.clusters.find((cl: any) => cl.members.includes(id));
    expect(cluster(a.id)).toBeTruthy();
    expect(cluster(a.id).members).not.toContain(b.id);
    expect(cluster(b.id)?.members ?? []).not.toContain(a.id);
  });

  it("same_event：自動引擎未連的兩事件被人工確認後進同群，邊標記 origin=manual", () => {
    const a = ev({ id: "twnews-sa", title: "河堤公園發現可疑包裹", region: "臺北市" });
    const b = ev({ id: "twnews-sb", title: "爆炸物處理小組到場移除", region: "高雄市", timestamp: "2026-06-21T09:00:00+08:00", source: { name: "來源B", type: "news-rss", fetchedAt: "" } });
    const events = [a, b];
    const net = correlateEvents(events, {
      curation: [rec({ id: "cur-se", decision: "same_event", subjects: [a.id, b.id], expect: expectOf(events) })],
      rulesVersion: RULES_VERSION,
    });
    const edge = edgeBetween(net, a.id, b.id);
    expect(edge).toBeTruthy();
    expect(edge.type).toBe("same-incident");
    expect(edge.origin).toBe("manual");
    expect(edge.curationId).toBe("cur-se");
    expect(net.clusters).toHaveLength(1);
    expect(net.clusters[0].members.sort()).toEqual([a.id, b.id].sort());
  });

  it("follow_up：產生有向 follow-up 邊但不併群", () => {
    const a = ev({ id: "twnews-fa", title: "河堤公園發現可疑包裹", region: "臺北市" });
    const b = ev({ id: "twnews-fb", title: "包裹移除 列為刑事案件偵辦", region: "高雄市", timestamp: "2026-06-21T09:00:00+08:00", source: { name: "來源B", type: "news-rss", fetchedAt: "" } });
    const events = [a, b];
    const net = correlateEvents(events, {
      curation: [rec({ id: "cur-fu", decision: "follow_up", subjects: [a.id, b.id], expect: expectOf(events) })],
      rulesVersion: RULES_VERSION,
    });
    const edge = net.edges.find((e: any) => e.type === "follow-up");
    expect(edge).toBeTruthy();
    expect(edge.from).toBe(a.id);
    expect(edge.to).toBe(b.id);
    expect(edge.origin).toBe("manual");
    expect(edge.curationId).toBe("cur-fu");
    expect(net.clusters).toEqual([]);
    expect(net.stats.byType["follow-up"]).toBe(1);
  });

  it("location_correction：改寫衍生層的地點角色，地理群集與節點隨之更新，原始事件不改", () => {
    const a = ev({
      id: "twnews-la",
      title: "鳳山分局 毒品案 A",
      lat: 22.62,
      lng: 120.35,
      locationRole: "incident",
      locationPrecision: "exact",
      source: { name: "來源A", type: "news-rss", fetchedAt: "" },
    });
    const b = ev({ id: "twnews-lb", title: "鳳山分局 毒品案 B", timestamp: "2026-06-20T12:00:00+08:00", source: { name: "來源B", type: "news-rss", fetchedAt: "" } });
    const events = [a, b];
    const beforeJson = JSON.stringify(events);
    const net = correlateEvents(events, {
      curation: [
        rec({ id: "cur-lc", decision: "location_correction", subjects: [a.id], expect: expectOf([a]), patch: { locationRole: "agency", region: "高雄市" } }),
      ],
      rulesVersion: RULES_VERSION,
    });
    const cluster = net.clusters[0];
    expect(cluster).toBeTruthy();
    const ids = cluster.geoClusters.flatMap((g: any) => g.members.map((m: any) => m.id));
    expect(ids).not.toContain(a.id);
    expect(cluster.degraded.nonIncidentLocationRole.ids).toContain(a.id);
    const node = net.nodes.find((n: any) => n.id === a.id);
    expect(node.locationRole).toBe("agency");
    expect(node.region).toBe("高雄市");
    expect(node.curated).toMatchObject({ id: "cur-lc", decision: "location_correction" });
    // 原始資料不被改寫
    expect(JSON.stringify(events)).toBe(beforeJson);
  });

  it("stale override（指紋不符）→ needs_review 且自動邊原樣保留（fail closed）", () => {
    const events = autoPair();
    const expect_ = expectOf(events);
    expect_["twnews-bb"] = "f".repeat(64);
    const net = correlateEvents(events, {
      curation: [rec({ id: "cur-stale", expect: expect_ })],
      rulesVersion: RULES_VERSION,
    });
    const edge = edgeBetween(net, "twnews-aa", "twnews-bb");
    expect(edge).toBeTruthy();
    expect(edge.origin).toBe("auto");
    expect(net.curation.needsReview).toBe(1);
    expect(net.curation.decisions[0].status).toBe("needs_review");
  });

  it("conflict override：自動產物原樣輸出 + conflict 審計訊息", () => {
    const events = autoPair();
    const exp = expectOf(events);
    const net = correlateEvents(events, {
      curation: [
        rec({ id: "c1", decision: "same_event", expect: exp }),
        rec({ id: "c2", decision: "not_same_event", expect: exp }),
      ],
      rulesVersion: RULES_VERSION,
    });
    expect(edgeBetween(net, "twnews-aa", "twnews-bb")).toBeTruthy();
    expect(net.curation.conflicts).toBe(2);
    expect(net.curation.decisions.every((d: any) => d.status === "conflict")).toBe(true);
  });

  it("同一 ledger + 同一 snapshot → 輸出 deterministic", () => {
    const events = autoPair();
    const curation = [rec({ id: "cur-d1", expect: expectOf(events) })];
    const n1 = correlateEvents(events, { curation, rulesVersion: RULES_VERSION });
    const n2 = correlateEvents(events, { curation, rulesVersion: RULES_VERSION });
    expect(JSON.stringify(n1)).toBe(JSON.stringify(n2));
  });

  it("自動候選邊標記 origin=auto（三層可追溯）", () => {
    const net = correlateEvents(autoPair());
    expect(net.edges.every((e: any) => e.origin === "auto")).toBe(true);
  });
});

describe("benchmark evidence（#43 介面）", () => {
  it("只有明確 benchmark=holdout/tuning 的記錄可被 benchmark 引用，預設不當 holdout", () => {
    const events = autoPair();
    const exp = expectOf(events);
    const entries = [
      rec({ id: "b0", expect: exp }),
      rec({ id: "b1", expect: exp, benchmark: "holdout" }),
      rec({ id: "b2", decision: "same_event", expect: exp, benchmark: "tuning" }),
    ];
    const evidence = ledgerBenchmarkEvidence(entries);
    expect(evidence.map((d: any) => d.id)).toEqual(["b1", "b2"]);
    expect(evidence[0].benchmark).toBe("holdout");
  });
});

describe("buildNetwork 整合", () => {
  it("ledger 經 buildNetwork 進入產物：scope 帶 curation 審計區塊", () => {
    const events = autoPair();
    const net = buildNetwork(events, [], "2026-09-30T00:00:00.000Z", {
      curation: [rec({ id: "cur-bn", expect: expectOf(events) })],
    });
    expect(net.domestic.curation.applied).toBe(1);
    expect(edgeBetween(net.domestic, "twnews-aa", "twnews-bb")).toBeFalsy();
    expect(net.domestic.stats.byType["follow-up"]).toBe(0);
  });

  it("fixture：tests/fixtures/curation 事件與 ledger 產出確定性結果", () => {
    const fixtureEvents = JSON.parse(readFileSync(join(HERE, "fixtures", "curation-events.json"), "utf8"));
    const { entries } = loadCurationLedger(join(HERE, "fixtures", "correlation-overrides.jsonl"));
    const net = buildNetwork(fixtureEvents, [], "2026-09-30T00:00:00.000Z", { curation: entries });
    expect(net.domestic.curation.applied).toBe(3);
    expect(net.domestic.stats.byType["follow-up"]).toBe(1);
    // 重播一致
    const net2 = buildNetwork(fixtureEvents, [], "2026-09-30T00:00:00.000Z", { curation: entries });
    expect(JSON.stringify(net)).toBe(JSON.stringify(net2));
  });
});
