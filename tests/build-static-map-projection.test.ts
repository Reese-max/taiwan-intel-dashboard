import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const scopes = ["domestic", "international"] as const;
const root = mkdtempSync(join(tmpdir(), "static-map-projection-"));
const inputs = join(root, "inputs");
const output = join(root, "dist", "data");
const hash = (raw: Uint8Array) => createHash("sha256").update(raw).digest("hex");
const readJson = (dir: string, name: string) => JSON.parse(readFileSync(join(dir, name), "utf8"));
const fingerprint = (dir: string): string[] => existsSync(dir)
  ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? fingerprint(join(dir, entry.name)).map((row) => `${entry.name}/${row}`)
    : [`${entry.name}:${hash(readFileSync(join(dir, entry.name)))}`]).sort()
  : [];

const eventsFor = (scope: typeof scopes[number]) => {
  const event = {
    id: `${scope}-current`, title: "Current located event", region: "Taiwan",
    lat: 25.03, lng: 121.56, locationPrecision: "exact",
    locationRole: "incident", locationMethod: "fixture", locationSourceBasis: "fixture",
    timestamp: "2026-10-08T12:00:00Z", category: "security", scope, riskLevel: "medium",
    description: "Detail-only field", aiEntities: ["detail"], aiTopic: "detail",
    source: {
      name: "Owned fixture", publisherName: "Fixture publisher", aggregatorName: "Fixture aggregator",
      sourceConfidence: "high", query: "detail-only query", url: "https://example.test/record",
      recordRef: "https://example.test/record",
    },
  };
  return [event, { ...event, id: `${scope}-global`, locationPrecision: "global" },
    { ...event, id: `${scope}-invalid`, lat: 91 }];
};

describe("static build map projection ownership", () => {
  let sourceBefore: string[];
  const oldMaps: Record<string, string> = {};
  beforeAll(() => {
    mkdirSync(inputs);
    for (const scope of scopes) {
      writeFileSync(join(inputs, `${scope}.json`), JSON.stringify(eventsFor(scope)));
      oldMaps[scope] = JSON.stringify([{ id: `${scope}-previous-snapshot`, title: "Old map" }]);
      writeFileSync(join(inputs, `${scope}.map.json`), oldMaps[scope]);
    }
    writeFileSync(join(inputs, "network.json"), JSON.stringify({ snapshotId: "owned-fixture", domestic: {}, international: {} }));
    writeFileSync(join(inputs, "summary.json"), '{"retained":true}');
    writeFileSync(join(inputs, "other.map.json"), '[{"id":"other-map-retained"}]');
    for (const entry of ["src", "static", "node_modules"]) {
      symlinkSync(join(repoRoot, entry), join(root, entry), process.platform === "win32" ? "junction" : "dir");
    }
    sourceBefore = fingerprint(join(repoRoot, "public", "data"));
    const result = spawnSync(process.execPath, [join(repoRoot, "scripts", "build-static.mjs")], {
      cwd: root, encoding: "utf8", env: { ...process.env, BUILD_DATA_DIR: inputs, BUILD_SYNTHETIC_INPUT: "1" },
    });
    expect(result.status, result.stderr).toBe(0);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it.each(scopes)("%s map derives exclusively from this build's located events despite an old input map", (scope) => {
    const map = readJson(output, `${scope}.map.json`);
    const current = eventsFor(scope)[0];
    expect(map).toEqual([{
      id: current.id, title: current.title, region: current.region,
      lat: current.lat, lng: current.lng, locationPrecision: current.locationPrecision,
      locationRole: current.locationRole, locationMethod: current.locationMethod,
      locationSourceBasis: current.locationSourceBasis, timestamp: current.timestamp,
      category: current.category, scope: current.scope, riskLevel: current.riskLevel,
      source: {
        name: current.source.name, publisherName: current.source.publisherName,
        aggregatorName: current.source.aggregatorName, sourceConfidence: current.source.sourceConfidence,
      },
    }]);
    const eventIds = new Set(readJson(output, `${scope}.json`).map((event: { id: string }) => event.id));
    expect(map.every((event: { id: string }) => eventIds.has(event.id))).toBe(true);
    const manifest = readJson(output, "manifest.json");
    for (const name of [`${scope}.json`, `${scope}.map.json`]) {
      expect(manifest.files[name].sha256).toBe(hash(readFileSync(join(output, name))));
      expect(manifest.files[name].count).toBe(readJson(output, name).length);
    }
    expect(manifest.scopes[scope].map).toBe(`${scope}.map.json`);
  });

  it("preserves old input maps, unrelated copy behavior and checkout public/data", () => {
    for (const scope of scopes) {
      expect(readFileSync(join(inputs, `${scope}.map.json`), "utf8")).toBe(oldMaps[scope]);
      const events = readJson(output, `${scope}.json`);
      expect(events).toHaveLength(3);
      expect(events[0]).not.toHaveProperty("aiEntities");
      expect(events[0]).not.toHaveProperty("aiTopic");
      expect(events[0].source).not.toHaveProperty("query");
      expect(events[0].source.recordRef).toBe("https://example.test/record");
    }
    expect(readJson(output, "other.map.json")).toEqual([{ id: "other-map-retained" }]);
    expect(readJson(output, "network.json")).toEqual(readJson(inputs, "network.json"));
    expect(readJson(output, "summary.json")).toEqual({ retained: true });
    expect(fingerprint(join(repoRoot, "public", "data"))).toEqual(sourceBefore);
  });
});
