import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import {
  buildDiscoveryFeed,
  discoveryId,
  loadOperatingState,
  originalSourceIdentity,
  projectItem,
  sourceUrl,
} from "../scripts/govintel-discovery.mjs";

const NOW = new Date("2026-09-16T12:00:00Z");
const ACTIVE = { state: "ACTIVE", stale: false, origin: "contract" };
const PAUSED = { state: "PAUSED", stale: true, origin: "contract" };

const item = (extra: Record<string, unknown> = {}) => ({
  id: "twnews-x1",
  title: "測試事件",
  region: "台北市",
  lat: 25.0,
  lng: 121.5,
  timestamp: "2026-09-16T09:00:00Z",
  category: "治安",
  scope: "domestic",
  riskLevel: "medium",
  summary: "摘要",
  locationPrecision: "city",
  source: {
    name: "某新聞",
    type: "news-rss",
    datasetId: "tw-news",
    recordRef: "https://example.com/news/1",
    fetchedAt: "2026-09-16T09:30:00Z",
    publisherName: "某新聞",
    ingestMethod: "direct-rss",
    sourceConfidence: "verified",
  },
  ...extra,
});

const writeState = (dir: string, name: string, doc: unknown) => {
  const p = join(dir, name);
  writeFileSync(p, typeof doc === "string" ? doc : JSON.stringify(doc));
  return p;
};
const contract = (state: string, extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  state,
  effectiveAt: "2026-09-16T00:00:00Z",
  ...extra,
});

describe("loadOperatingState", () => {
  const dir = mkdtempSync(join(tmpdir(), "os-state-"));

  it("契約缺失 → fail closed PAUSED+stale", () => {
    const r = loadOperatingState(join(dir, "nope.json"));
    expect(r.state).toBe("PAUSED");
    expect(r.stale).toBe(true);
    expect(r.origin).toBe("contract-missing-or-invalid");
  });

  it("契約 JSON 無效 → fail closed PAUSED", () => {
    expect(loadOperatingState(writeState(dir, "bad.json", "not json{")).state).toBe("PAUSED");
  });

  it("契約 state 非法 / schemaVersion 不符 / 缺 effectiveAt → fail closed PAUSED", () => {
    expect(loadOperatingState(writeState(dir, "w.json", contract("SLEEPING"))).state).toBe("PAUSED");
    expect(loadOperatingState(writeState(dir, "v.json", { ...contract("ACTIVE"), schemaVersion: 2, evidence: { restoreReceipt: "x" } })).state).toBe("PAUSED");
    const noEff = contract("PAUSED") as Record<string, unknown>;
    delete noEff.effectiveAt;
    expect(loadOperatingState(writeState(dir, "e.json", noEff)).state).toBe("PAUSED");
  });

  it("ACTIVE 缺 restoreReceipt → 矛盾態 fail closed PAUSED", () => {
    expect(loadOperatingState(writeState(dir, "a1.json", contract("ACTIVE"))).state).toBe("PAUSED");
    expect(loadOperatingState(writeState(dir, "a2.json", contract("ACTIVE", { evidence: {} }))).state).toBe("PAUSED");
  });

  it.each(["PAUSED", "RESTORING", "DEGRADED"] as const)("%s → stale=true", (state) => {
    const r = loadOperatingState(writeState(dir, `${state}.json`, contract(state)));
    expect(r.state).toBe(state);
    expect(r.stale).toBe(true);
    expect(r.origin).toBe("contract");
  });

  it("ACTIVE + restoreReceipt → stale=false", () => {
    const r = loadOperatingState(
      writeState(dir, "ok-active.json", contract("ACTIVE", { evidence: { restoreReceipt: "docs/operations/receipts/x.md" } })),
    );
    expect(r.state).toBe("ACTIVE");
    expect(r.stale).toBe(false);
  });
});

describe("identity / provenance", () => {
  it("discovery_id 穩定且非 index；url 也進雜湊基底", () => {
    const a = discoveryId(item());
    expect(discoveryId(item())).toBe(a);
    expect(a).toMatch(/^gd-[0-9a-f]{16}$/);
    const withUrl = item({ source: { ...item().source, url: "https://example.com/other" } });
    expect(discoveryId(withUrl)).not.toBe(a);
  });

  it("recordRef 非 URL 時 source_url 用 source.url", () => {
    const cwa = item({
      source: {
        type: "cwa",
        datasetId: "W-C0033-001",
        recordRef: "66-20260916163400",
        url: "https://www.cwa.gov.tw/warn.html",
      },
    });
    expect(sourceUrl(cwa)).toBe("https://www.cwa.gov.tw/warn.html");
    expect(originalSourceIdentity(cwa)).toBe("W-C0033-001:66-20260916163400");
  });

  it("direct-rss media：identity 為 datasetId:recordRef", () => {
    expect(originalSourceIdentity(item())).toBe("tw-news:https://example.com/news/1");
  });

  it("聚合新聞：recordRef 是聚合頁 → identity 用 publisher+title", () => {
    const agg = item({
      source: {
        name: "民視新聞網",
        datasetId: "tw-news",
        recordRef: "https://news.google.com/rss/articles/XYZ",
        publisherName: "民視新聞網",
        ingestMethod: "google-news-rss",
        sourceConfidence: "aggregated",
      },
    });
    const id = originalSourceIdentity(agg);
    expect(id).toMatch(/^media:民視新聞網:[0-9a-f]{16}$/);
    const same = item({
      title: "  測試事件 ",
      source: { ...agg.source, recordRef: "https://news.google.com/rss/articles/DIFFERENT" },
    });
    expect(originalSourceIdentity(same)).toBe(id);
  });

  it("authority：type gov-open-data/cwa 即 official（不需 authority 欄位），其餘 media", () => {
    expect(projectItem(item()).authority).toBe("media");
    const cwa = item({ source: { type: "cwa", datasetId: "W-C0033-001", recordRef: "66-x" } });
    expect(projectItem(cwa).authority).toBe("official");
    const gov = item({ source: { type: "gov-open-data", datasetId: "ncdr-cap-alert", recordRef: "NFA_1" } });
    expect(projectItem(gov).authority).toBe("official");
    expect(projectItem(item({ source: { ...item().source, authority: "official" } })).authority).toBe("official");
    expect(projectItem(item({ source: { ...item().source, authority: "bogus" } })).authority).toBe("media");
  });

  it("event_time 未知 → null 不造假；輸出正規化 ISO", () => {
    expect(projectItem(item({ timestamp: "garbage" })).event_time).toBeNull();
    expect(projectItem(item({ timestamp: null })).event_time).toBeNull();
    expect(projectItem(item({ timestamp: "2026-09-16T09:00:00+08:00" })).event_time).toBe("2026-09-16T01:00:00.000Z");
  });

  it("rights：開放授權字樣 → OPEN_DATA；其他（含研究用途標示）→ REVIEW_REQUIRED", () => {
    expect(projectItem(item()).rights_status).toBe("REVIEW_REQUIRED");
    const lic = item({ source: { ...item().source, license: "政府資料開放授權條款-第1版" } });
    expect(projectItem(lic).rights_status).toBe("OPEN_DATA");
    const research = item({ source: { ...item().source, license: "觀光署公開資料鏡像（非 data.gov.tw OGDL；研究用途）" } });
    expect(projectItem(research).rights_status).toBe("REVIEW_REQUIRED");
  });
});

describe("buildDiscoveryFeed", () => {
  it("只輸出 window 內的 domestic + allowlist 類別；scope/類別缺失都排除", () => {
    const feed = buildDiscoveryFeed({
      domestic: [
        item(),
        item({ scope: "international", title: "國際" }),
        item({ timestamp: "2026-09-10T00:00:00Z", source: { ...item().source, fetchedAt: "2026-09-10T00:30:00Z" }, title: "太舊" }),
        item({ category: "食安", title: "不在白名單" }),
        item({ category: null, title: "無類別" }),
      ],
      operatingState: ACTIVE,
      now: NOW,
    });
    expect(feed.items).toHaveLength(1);
    expect(feed.excluded_counts.out_of_window).toBe(1);
    expect(feed.excluded_counts.category_filtered).toBe(2);
    expect(feed.excluded_counts.scope_filtered).toBe(1);
  });

  it("event_time 缺失但 observed_at 在窗內 → 收錄且 event_time=null", () => {
    const noTs = item({ timestamp: null });
    const feed = buildDiscoveryFeed({ domestic: [noTs], operatingState: ACTIVE, now: NOW });
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].event_time).toBeNull();
    expect(feed.items[0].observed_at).toBe("2026-09-16T09:30:00Z");
  });

  it("缺 source identity 的項目 fail closed 不進 feed", () => {
    const feed = buildDiscoveryFeed({ domestic: [item(), item({ source: {} })], operatingState: ACTIVE, now: NOW });
    expect(feed.items).toHaveLength(1);
    expect(feed.excluded_counts.no_source_identity).toBe(1);
  });

  it("同一原始來源 direct + Dashboard 兩路 → 去重只留一筆（official 優先，與輸入序無關）", () => {
    const shared = { datasetId: "W-C0033-001", recordRef: "66-20260916163400" };
    const official = item({ title: "官方版", source: { ...shared, type: "cwa", url: "https://cwa.gov.tw/a" } });
    const mirror = item({ title: "轉載版", source: { ...shared, type: "news-rss", ingestMethod: "mirror" } });
    for (const order of [[official, mirror], [mirror, official]]) {
      const feed = buildDiscoveryFeed({ domestic: order, operatingState: ACTIVE, now: NOW });
      expect(feed.items).toHaveLength(1);
      expect(feed.items[0].authority).toBe("official");
      expect(feed.excluded_counts.duplicate_source).toBe(1);
    }
  });

  it("deterministic：同輸入不同排列 → item IDs/order 相同", () => {
    const domestic = [
      item({ title: "A", timestamp: "2026-09-16T08:00:00Z" }),
      item({ title: "B", timestamp: "2026-09-16T10:00:00Z", source: { ...item().source, recordRef: "https://x/2" } }),
      item({ title: "C", timestamp: "2026-09-16T10:00:00Z", source: { ...item().source, recordRef: "https://x/3" } }),
    ];
    const r1 = buildDiscoveryFeed({ domestic, operatingState: ACTIVE, now: NOW });
    const r2 = buildDiscoveryFeed({ domestic: [...domestic].reverse(), operatingState: ACTIVE, now: NOW });
    expect(r1.items.map((i: any) => i.discovery_id)).toEqual(r2.items.map((i: any) => i.discovery_id));
    expect(r1.items[0].event_time).toBe("2026-09-16T10:00:00.000Z");
  });

  it("maxItems 上限 → truncated=true 且計數", () => {
    const domestic = Array.from({ length: 10 }, (_, i) =>
      item({ source: { ...item().source, recordRef: `https://x/${i}` } }),
    );
    const feed = buildDiscoveryFeed({ domestic, operatingState: ACTIVE, now: NOW, maxItems: 3 });
    expect(feed.items).toHaveLength(3);
    expect(feed.truncated).toBe(true);
    expect(feed.excluded_counts.truncated).toBe(7);
  });

  it("maxBytes size gate → 繼續截斷；單筆超限 → 清空不 hang", () => {
    const domestic = Array.from({ length: 5 }, (_, i) =>
      item({ title: "很長".repeat(200), source: { ...item().source, recordRef: `https://x/${i}` } }),
    );
    const feed = buildDiscoveryFeed({ domestic, operatingState: ACTIVE, now: NOW, maxBytes: 3000 });
    expect(feed.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(feed), "utf8")).toBeLessThanOrEqual(3000);
    // 單筆即超限：不得無限迴圈，回空 items + truncated
    const tiny = buildDiscoveryFeed({ domestic: [item({ title: "長".repeat(500) })], operatingState: ACTIVE, now: NOW, maxBytes: 500 });
    expect(tiny.items).toHaveLength(0);
    expect(tiny.truncated).toBe(true);
  });

  it("PAUSED / 契約缺失 → envelope 標示 stale，不能顯示 fresh ACTIVE", () => {
    const feed = buildDiscoveryFeed({ domestic: [item()], operatingState: PAUSED, now: NOW });
    expect(feed.operating_state).toBe("PAUSED");
    expect(feed.stale).toBe(true);
    const missing = buildDiscoveryFeed({
      domestic: [item()],
      operatingState: { state: "PAUSED", stale: true, origin: "contract-missing-or-invalid" },
      now: NOW,
    });
    expect(missing.operating_state_source).toBe("contract-missing-or-invalid");
  });

  it("feed 不含 secret/token/cookie 欄位", () => {
    const poisoned = item({ secret_token: "abc", cookie: "x", source: { ...item().source, apiKey: "k" } });
    const feed = buildDiscoveryFeed({ domestic: [poisoned], operatingState: ACTIVE, now: NOW });
    const text = JSON.stringify(feed);
    expect(text).not.toContain("secret_token");
    expect(text).not.toContain("cookie");
    expect(text).not.toContain("apiKey");
  });

  it("media item 的 authority 永遠是 media，不升 official", () => {
    const feed = buildDiscoveryFeed({ domestic: [item()], operatingState: ACTIVE, now: NOW });
    expect(feed.items[0].authority).toBe("media");
  });

  it("非法參數直接 throw（NaN now / 零 window / 零 maxBytes）", () => {
    expect(() => buildDiscoveryFeed({ domestic: [], operatingState: ACTIVE, now: new Date("bad") })).toThrow();
    expect(() => buildDiscoveryFeed({ domestic: [], operatingState: ACTIVE, now: NOW, windowHours: 0 })).toThrow();
    expect(() => buildDiscoveryFeed({ domestic: [], operatingState: ACTIVE, now: NOW, maxBytes: 0 })).toThrow();
  });
});

describe("CLI end-to-end", () => {
  it("固定 snapshot → 產出 feed 檔；缺契約 → PAUSED fail closed", () => {
    const dir = mkdtempSync(join(tmpdir(), "disc-cli-"));
    try {
      writeFileSync(join(dir, "domestic.json"), JSON.stringify([item()]));
      const out = execFileSync("node", ["scripts/govintel-discovery.mjs"], {
        env: { ...process.env, DISCOVERY_DATA_DIR: dir, DISCOVERY_STATE_PATH: join(dir, "missing.json"), DISCOVERY_NOW: NOW.toISOString() },
        encoding: "utf8",
      });
      expect(out).toContain("state=PAUSED");
      const feed = JSON.parse(readFileSync(join(dir, "govintel-discovery.json"), "utf8"));
      expect(feed.schema_version).toBe(1);
      expect(feed.operating_state).toBe("PAUSED");
      expect(feed.stale).toBe(true);
      expect(feed.source_snapshot_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(feed.items[0].discovery_id).toMatch(/^gd-[0-9a-f]{16}$/);
      // 無 .tmp 殘留（atomic rename）
      const { readdirSync } = require("node:fs");
      expect(readdirSync(dir).filter((f: string) => f.endsWith(".tmp"))).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("domestic.json 快照產出符合 schema 的 feed（有正式資料時驗正式資料）", () => {
    const realSnapshot = join("public", "data", "domestic.json");
    const hasRealSnapshot = existsSync(realSnapshot);
    const input = hasRealSnapshot ? realSnapshot : join("tests", "fixtures", "govintel-domestic.json");
    const dir = mkdtempSync(join(tmpdir(), "disc-snapshot-"));
    try {
      copyFileSync(input, join(dir, "domestic.json"));
      execFileSync("node", ["scripts/govintel-discovery.mjs"], {
        env: {
          ...process.env,
          DISCOVERY_DATA_DIR: dir,
          DISCOVERY_NOW: hasRealSnapshot ? new Date().toISOString() : NOW.toISOString(),
        },
        encoding: "utf8",
      });
      const feed = JSON.parse(readFileSync(join(dir, "govintel-discovery.json"), "utf8"));
      expect(feed.schema_version).toBe(1);
      expect(["ACTIVE", "DEGRADED", "RESTORING", "PAUSED"]).toContain(feed.operating_state);
      expect(feed.stale).toBe(feed.operating_state !== "ACTIVE");
      if (!hasRealSnapshot) expect(feed.items.length).toBeGreaterThan(0);
      for (const it2 of feed.items) {
        expect(it2.discovery_id).toMatch(/^gd-[0-9a-f]{16}$/);
        expect(["official", "media"]).toContain(it2.authority);
        expect(it2.original_source_identity || it2.source_url).toBeTruthy();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
