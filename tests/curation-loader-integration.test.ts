import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { buildNetwork } from "../scripts/build-network.mjs";
import { fingerprintEvent } from "../scripts/lib/curation-ledger.mjs";
import { RULES_VERSION } from "../scripts/lib/manifest.mjs";
import { loadNetwork } from "../src/data/network";

afterEach(() => vi.restoreAllMocks());

it("loads an actual curated follow-up network through the hash-checked runtime contract", async () => {
  const events = ["early", "later"].map((part, index) => ({
    id: `twnews-${part}`, title: part, summary: "Synthetic reviewed evidence", scope: "domestic",
    region: index === 0 ? "臺北市" : "高雄市", category: "治安", riskLevel: "low",
    timestamp: `2026-10-0${index + 1}T00:00:00Z`,
    source: { name: `Synthetic source ${index}`, type: "news-rss", recordRef: `https://example.invalid/${part}` },
  }));
  const curation = [{
    schemaVersion: 1, id: "curated-follow-up", decision: "follow_up", subjects: events.map((event) => event.id),
    expect: Object.fromEntries(events.map((event) => [event.id, fingerprintEvent(event)])),
    reason: "The second synthetic record follows the first", evidence: "https://example.invalid/review",
    reviewedAt: "2026-10-13T00:00:00Z", rulesVersion: RULES_VERSION,
  }];
  const body = JSON.stringify(buildNetwork(events, [], "2026-10-13T00:00:00Z", { curation, snapshotId: "ledger-fixture" }));
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(body));
  const index = await loadNetwork("domestic", {
    expectedSnapshotId: "ledger-fixture", expectedSha256: createHash("sha256").update(body).digest("hex"),
  });
  expect(index.state).toBe("ready");
  expect(index.related(events[0].id)).toEqual([expect.objectContaining({
    id: events[1].id, type: "follow-up", why: expect.stringContaining("後續報導"),
  })]);
  expect(index.related(events[1].id)[0].why).toContain("前情報導");
  expect(index.clusterOf(events[0].id)).toBeUndefined();
});
