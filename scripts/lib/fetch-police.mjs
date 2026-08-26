// 不需第三方 MCP 的警政來源：警政署犯罪週報。
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { weeklyCrimeRisk } from "./police-mappers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRIME_WEEKLY_SCRIPT = join(__dirname, "parse-crime-weekly.py");

export const POLICE_HOURLY_MINIMUM = 1;
export const POLICE_NEW_PER_HOUR_FALLBACK = 1;
export const POLICE_TODAY_MINIMUM = 1;
export const POLICE_TAIPEI_IDS = new Set();

export function crimeWeeklySpawnEnv(baseEnv = process.env) {
  return {
    ...baseEnv,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
  };
}

function provenance({ recordRef, fetchedAt, query }) {
  return {
    name: "警政署 犯罪資料統計週報",
    type: "gov-open-data",
    datasetId: "13166",
    recordRef,
    url: "https://data.gov.tw/dataset/13166",
    fetchedAt,
    query,
  };
}

async function fetchCrimeWeekly() {
  const fetchedAt = new Date().toISOString();
  const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const result = spawnSync(python, [CRIME_WEEKLY_SCRIPT], {
    encoding: "utf8",
    env: crimeWeeklySpawnEnv(),
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "crime weekly parse failed");
  }
  const payload = JSON.parse(result.stdout.trim());
  if (payload.error) throw new Error(payload.error);

  const periodKey = String(payload.period || payload.fileName || "weekly").replace(/\s/g, "");
  const timestamp = payload.periodEnd || fetchedAt;
  const counts = payload.currentCounts || {};
  const events = [
    {
      id: `crime-week-summary-${periodKey}`,
      title: `犯罪週統計｜${payload.period || "最新一週"}`,
      region: "全國",
      timestamp,
      category: "治安",
      scope: "domestic",
      riskLevel: weeklyCrimeRisk("毒品", counts["毒品"] || payload.totalCurrent),
      summary: `警政署週報當期發生數合計 ${payload.totalCurrent ?? "—"} 件（${Object.entries(counts)
        .map(([key, value]) => `${key}${value}`)
        .join("、")}）。${payload.compiledAt || ""} 此為全國統計摘要，非單點事件。`,
      source: provenance({
        recordRef: payload.fileName,
        fetchedAt,
        query: "download ZIP 13166 → parse latest ODS 當期發生數",
      }),
    },
  ];

  for (const [caseType, count] of Object.entries(counts)) {
    if (!count || Number(count) <= 0) continue;
    events.push({
      id: `crime-week-${periodKey}-${caseType}`,
      title: `週統計｜${caseType} ${count} 件`,
      region: "全國",
      timestamp,
      category: "治安",
      scope: "domestic",
      riskLevel: weeklyCrimeRisk(caseType, count),
      summary: `${payload.period || "最新一週"}當期發生 ${caseType} ${count} 件（全國週統計摘要）。`,
      source: provenance({
        recordRef: `${payload.fileName}:${caseType}`,
        fetchedAt,
        query: "download ZIP 13166 → parse latest ODS 當期發生數",
      }),
    });
  }

  return events;
}

export function isPoliceDomesticEvent(event) {
  const datasetId = event?.source?.datasetId;
  if (datasetId === "tw-news") return false;
  return datasetId === "13166"
    || datasetId === "14420"
    || event?.id?.startsWith("crime-week-")
    || event?.id?.startsWith("missing-")
    || false;
}

export async function fetchPolice({ fetchWeekly = fetchCrimeWeekly } = {}) {
  try {
    const events = await fetchWeekly();
    return {
      events,
      substatus: { crimeWeekly: { ok: true, count: events.length } },
    };
  } catch (error) {
    throw new Error(`direct police source failed — crimeWeekly: ${error?.message || String(error)}`);
  }
}
