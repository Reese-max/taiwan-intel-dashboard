import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const root = mkdtempSync(join(tmpdir(), "static-police-hourly-"));
const inputs = join(root, "inputs");
const output = join(root, "dist", "data");

const mockHistory = {
  generatedAt: "2026-10-30T10:00:00.000Z",
  minimumNewPerHour: 200,
  calibration: { minimumNewPerHour: 200, lookbackDays: 7, percentile: 25, sampleSize: 100 },
  runs: Array.from({ length: 48 }, (_, i) => {
    const hour = i % 24;
    const day = 29 - Math.floor(i / 24);
    return {
      hourLocal: `2026-10-${day} ${String(hour).padStart(2, "0")}:00`,
      totalFetchedPoliceRelated: 500,
      uniqueFetchedPoliceRelated: 450,
      newPoliceRelatedCount: 150 + hour,
      duplicateFromPriorCount: 230,
      deferredNewCandidateCount: 50,
      minimumNewPerHour: 200,
      meetsNewHourlyMinimum: true,
      runAttempts: 1,
      newRecords: Array.from({ length: 150 }, (_, r) => ({
        id: `r-${i}-${r}`,
        title: `Heavy event record ${i}-${r} with detailed long strings`,
        category: "治安",
        recordRef: `https://example.com/item/${i}/${r}`,
        fetchedAt: "2026-10-30T10:00:00Z",
      })),
      categories: [
        { name: "治安", count: 150, sources: [{ name: "s", datasetId: "d", count: 150 }] },
      ],
    };
  }),
};

describe("static build police hourly recent projection", () => {
  beforeAll(() => {
    mkdirSync(inputs);
    writeFileSync(join(inputs, "domestic.json"), "[]");
    writeFileSync(join(inputs, "international.json"), "[]");
    writeFileSync(join(inputs, "network.json"), JSON.stringify({ snapshotId: "test-snap" }));
    writeFileSync(join(inputs, "summary.json"), "{}");
    writeFileSync(join(inputs, "police-hourly-history.json"), JSON.stringify(mockHistory, null, 2));

    for (const entry of ["src", "static", "node_modules"]) {
      symlinkSync(join(repoRoot, entry), join(root, entry), process.platform === "win32" ? "junction" : "dir");
    }

    const result = spawnSync(process.execPath, [join(repoRoot, "scripts", "build-static.mjs")], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, BUILD_DATA_DIR: inputs, BUILD_SYNTHETIC_INPUT: "1" },
    });
    expect(result.status, result.stderr).toBe(0);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("dist 同時包含完整 police-hourly-history.json 與精簡 police-hourly-recent.json", () => {
    const historyPath = join(output, "police-hourly-history.json");
    const recentPath = join(output, "police-hourly-recent.json");

    expect(existsSync(historyPath)).toBe(true);
    expect(existsSync(recentPath)).toBe(true);

    const historyContent = readFileSync(historyPath, "utf8");
    const recentContent = readFileSync(recentPath, "utf8");

    // 原管線檔案內容結構維持不變（包含 newRecords）
    expect(historyContent).toContain("Heavy event record");
    expect(JSON.parse(historyContent).runs[0].newRecords).toBeDefined();

    // 瀏覽器用精簡檔案移除肥大欄位，檔案體積顯著縮小
    expect(recentContent).not.toContain("newRecords");
    expect(recentContent).not.toContain("Heavy event record");
    const recentJson = JSON.parse(recentContent);
    expect(recentJson.runs).toHaveLength(48);
    expect(recentJson.runs[0].newPoliceRelatedCount).toBeDefined();
    expect(recentJson.runs[0].hourLocal).toBeDefined();
    expect(recentJson.calibration).toEqual(mockHistory.calibration);

    expect(Buffer.byteLength(recentContent)).toBeLessThan(Buffer.byteLength(historyContent) / 10);
  });
});
