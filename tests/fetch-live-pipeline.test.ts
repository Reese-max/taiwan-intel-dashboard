import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// @ts-expect-error — JS ESM module without types
import { validateEventContract } from "../scripts/lib/event-contract.mjs";

type UnexpectedFetch = { url: string; status: number };

const ENV_KEYS = [
  "FETCH_LIVE_DATA_DIR",
  "SOURCES",
  "EXCLUSIVE",
  "CWA_API_KEY",
  "LLM_API_KEY",
  "LLM_BASE_URL",
  "LLM_MODEL",
  "LLM_MAX_RETRIES",
  "LLM_FALLBACK_API_KEY",
  "LLM_FALLBACK_BASE_URL",
  "SUMMARY_API_KEY",
  "SUMMARY_BASE_URL",
  "SUMMARY_MODEL",
  "SUMMARY_MAX_RETRIES",
] as const;

const originalEnv = new Map<string, string | undefined>();
for (const key of ENV_KEYS) originalEnv.set(key, process.env[key]);

const tempDirs: string[] = [];

function taiwanToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonIfExists(path: string) {
  return existsSync(path) ? readJson(path) : null;
}

function setupEnv() {
  const dir = mkdtempSync(join(tmpdir(), "fetch-live-pipeline-"));
  tempDirs.push(dir);

  process.env.FETCH_LIVE_DATA_DIR = dir;
  process.env.SOURCES = "cwa";
  process.env.EXCLUSIVE = "";
  process.env.CWA_API_KEY = "test-cwa-key";
  process.env.LLM_API_KEY = "test-llm-key";
  process.env.LLM_BASE_URL = "https://llm.invalid/v1";
  process.env.LLM_MODEL = "test-model";
  process.env.LLM_MAX_RETRIES = "0";
  process.env.LLM_FALLBACK_API_KEY = "";
  process.env.LLM_FALLBACK_BASE_URL = "";
  process.env.SUMMARY_API_KEY = "test-summary-key";
  process.env.SUMMARY_BASE_URL = "https://summary.invalid/v1";
  process.env.SUMMARY_MODEL = "test-summary-model";
  process.env.SUMMARY_MAX_RETRIES = "0";

  return dir;
}

function earthquakeFixture() {
  const day = taiwanToday();
  return {
    records: {
      Earthquake: [
        {
          EarthquakeNo: 20260707001,
          Web: "https://scweb.cwa.gov.tw/zh-tw/earthquake/details/20260707001",
          ReportContent: "07日09時12分臺東縣近海發生規模5.3有感地震。",
          EarthquakeInfo: {
            OriginTime: `${day}T09:12:00+08:00`,
            FocalDepth: 18.2,
            Epicenter: {
              Location: "臺東縣政府東方 35.0 公里",
              EpicenterLatitude: 22.76,
              EpicenterLongitude: 121.48,
            },
            EarthquakeMagnitude: { MagnitudeValue: 5.3 },
          },
        },
        {
          EarthquakeNo: 20260707002,
          Web: "https://scweb.cwa.gov.tw/zh-tw/earthquake/details/20260707002",
          ReportContent: "07日10時30分花蓮縣近海發生規模4.2有感地震。",
          EarthquakeInfo: {
            OriginTime: `${day}T10:30:00+08:00`,
            FocalDepth: 12.5,
            Epicenter: {
              Location: "花蓮縣政府南南東方 20.0 公里",
              EpicenterLatitude: 23.8,
              EpicenterLongitude: 121.72,
            },
            EarthquakeMagnitude: { MagnitudeValue: 4.2 },
          },
        },
      ],
    },
  };
}

function warningFixture() {
  const day = taiwanToday();
  return {
    records: {
      location: [
        {
          locationName: "臺北市",
          geocode: 63,
          hazardConditions: {
            hazards: [
              {
                info: { language: "zh-TW", phenomena: "大雨", significance: "特報" },
                validTime: { startTime: `${day} 11:00:00`, endTime: `${day} 18:00:00` },
              },
            ],
          },
        },
      ],
    },
  };
}

function makeMockFetch(options: { cwaOk?: boolean; cwaWarningsOk?: boolean } = {}) {
  const unexpected: UnexpectedFetch[] = [];
  const cwaOk = options.cwaOk ?? true;
  const cwaWarningsOk = options.cwaWarningsOk ?? true;
  const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/datastore/E-A0015-001")) {
      if (!cwaOk) return new Response("CWA earthquake failure", { status: 500 });
      return Response.json(earthquakeFixture());
    }
    if (url.includes("/datastore/W-C0033-001")) {
      if (!cwaWarningsOk) return new Response("CWA warning failure", { status: 500 });
      return Response.json(warningFixture());
    }
    unexpected.push({ url, status: 500 });
    return new Response("unexpected fetch blocked by test", { status: 500 });
  });
  vi.stubGlobal("fetch", mockFetch);
  return { mockFetch, unexpected };
}

async function importRun() {
  vi.resetModules();
  const mod = await import("../scripts/fetch-live.mjs");
  return mod.run as () => Promise<void>;
}

function makeCarryOverQuake() {
  const day = taiwanToday();
  return {
    id: "eq-carry-over",
    title: "臺東縣規模 5.1 地震",
    region: "臺東縣",
    lat: 22.8,
    lng: 121.4,
    timestamp: `${day}T08:00:00+08:00`,
    category: "災防",
    scope: "domestic",
    riskLevel: "high",
    summary: "預埋的上一輪 CWA 地震事件，用於驗證 last-good carry-over。",
    source: {
      name: "中央氣象署 顯著有感地震報告",
      type: "cwa",
      datasetId: "E-A0015-001",
      recordRef: "carry-over",
      url: "https://scweb.cwa.gov.tw/zh-tw/earthquake/details/carry-over",
      fetchedAt: `${day}T08:01:00+08:00`,
      query: "CWA opendata API E-A0015-001 (顯著有感地震報告)",
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  process.exitCode = undefined;
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("fetch-live pipeline integration (CWA)", () => {
  it(
    "writes domestic/provenance/daily-rollup for the happy CWA skeleton",
    async () => {
      const dataDir = setupEnv();
      const { unexpected } = makeMockFetch();
      const run = await importRun();

      await run();

      const domesticPath = join(dataDir, "domestic.json");
      expect(existsSync(domesticPath)).toBe(true);
      const domestic = readJson(domesticPath);
      const contract = validateEventContract(domestic);
      expect(contract.invalid).toEqual([]);
      expect(contract.valid).toHaveLength(domestic.length);
      const quakeEvents = domestic.filter((event: any) => event.source?.datasetId === "E-A0015-001");
      expect(quakeEvents).toHaveLength(2);
      expect(quakeEvents.some((event: any) => event.title.includes("地震"))).toBe(true);

      const provenance = readJson(join(dataDir, "provenance.json"));
      expect(provenance.pipeline.cwa.ok).toBe(true);
      expect(provenance.pipeline.cwaWarnings.ok).toBe(true);
      for (const key of ["police", "twnews", "international", "mofa", "ncdr", "pcc"]) {
        expect(provenance.pipeline[key].skipped).toBe(true);
      }

      const rollup = readJson(join(dataDir, "daily-rollup.json"));
      const today = taiwanToday();
      expect(rollup.days[today].byScope.domestic).toBeGreaterThanOrEqual(quakeEvents.length);
      expect(unexpected.every((entry) => entry.status === 500)).toBe(true);
    },
    60_000,
  );

  it(
    "carries over the previous CWA earthquake snapshot when CWA fetch fails",
    async () => {
      const dataDir = setupEnv();
      const carryOver = makeCarryOverQuake();
      writeFileSync(join(dataDir, "domestic.json"), JSON.stringify([carryOver], null, 2), "utf8");
      const { unexpected } = makeMockFetch({ cwaOk: false, cwaWarningsOk: false });
      const run = await importRun();

      await run();

      const provenance = readJson(join(dataDir, "provenance.json"));
      expect(provenance.pipeline.cwa.ok).toBe(false);
      expect(provenance.pipeline.cwaWarnings.ok).toBe(false);
      const domestic = readJson(join(dataDir, "domestic.json"));
      expect(domestic.some((event: any) => event.id === carryOver.id)).toBe(true);
      expect(domestic.find((event: any) => event.id === carryOver.id)?.source.datasetId).toBe("E-A0015-001");
      expect(validateEventContract(domestic).invalid).toEqual([]);
      expect(unexpected.every((entry) => entry.status === 500)).toBe(true);
    },
    60_000,
  );

  it(
    "fails soft when every fetch returns 500 and no previous snapshot exists",
    async () => {
      const dataDir = setupEnv();
      const { unexpected } = makeMockFetch({ cwaOk: false, cwaWarningsOk: false });
      const run = await importRun();

      await expect(run()).resolves.toBeUndefined();

      const provenance = readJson(join(dataDir, "provenance.json"));
      expect(provenance.pipeline.cwa.ok).toBe(false);
      expect(provenance.pipeline.cwaWarnings.ok).toBe(false);
      const domestic = readJsonIfExists(join(dataDir, "domestic.json"));
      expect(domestic === null || (Array.isArray(domestic) && domestic.length === 0)).toBe(true);
      expect(unexpected.every((entry) => entry.status === 500)).toBe(true);
    },
    60_000,
  );
});
