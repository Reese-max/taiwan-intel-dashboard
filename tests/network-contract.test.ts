import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  formatNetworkContractErrors,
  readNetworkFile,
  validateNetworkContract,
} from "../scripts/lib/network-contract.mjs";

function makeScope(prefix: string, events: number) {
  const nodes = Array.from({ length: events }, (_, index) => ({ id: `${prefix}-${index}`, degree: 0 }));
  return {
    nodes,
    edges: [],
    clusters: [],
    stats: {
      events,
      edges: 0,
      byType: { "same-incident": 0, "same-entity": 0, "same-topic": 0 },
      clusters: 0,
      largestCluster: 0,
    },
  };
}

function makeNetwork(domesticEvents = 1, internationalEvents = 0) {
  return {
    generatedAt: "2026-08-01T00:00:00.000Z",
    scopeNote: "測試情報網",
    domestic: makeScope("d", domesticEvents),
    international: makeScope("i", internationalEvents),
    excluded: { domestic: 0, international: 0 },
  };
}

describe("network artifact contract", () => {
  it("接受具備最低 schema 且有非空事件覆蓋的產物", () => {
    expect(validateNetworkContract(makeNetwork())).toEqual([]);
  });

  it("拒絕空覆蓋量並指出統計路徑與門檻", () => {
    const errors = validateNetworkContract(makeNetwork(0, 0));

    expect(errors).toContain("非空覆蓋量不足：domestic.stats.events + international.stats.events = 0，至少需要 1 筆事件");
  });

  it("拒絕最低 schema、統計數不一致與非法 JSON 欄位", () => {
    const network = makeNetwork();
    network.international = undefined;
    network.domestic.stats.events = 2;
    network.domestic.nodes[0].degree = -1;
    network.domestic.stats.byType["same-topic"] = "0";

    const errors = validateNetworkContract(network);

    expect(errors).toContain("scope international：必須是 JSON 物件");
    expect(errors).toContain("scope domestic.nodes[0].degree：必須是非負整數");
    expect(errors).toContain("scope domestic.stats.byType.same-topic：必須是非負整數");
    expect(errors).toContain("scope domestic.stats.events：必須等於 nodes.length（目前 2／1）");
  });

  it("選用的時序／地理訊號欄位存在時須符合結構", () => {
    const network = makeNetwork(2, 0);
    network.domestic.stats.clusters = 1;
    network.domestic.stats.largestCluster = 2;
    network.domestic.clusters = [
      {
        id: "c0",
        members: ["d-0", "d-1"],
        size: 2,
        temporalSeries: [{ ts: "2026-08-01T00:00:00.000Z", reports: 2, sources: 2 }],
        firstSeenTs: "2026-08-01T00:00:00.000Z",
        lastSeenTs: "2026-08-01T00:00:00.000Z",
        geoClusters: [
          {
            id: "geo0",
            size: 2,
            centroidLat: 25.0,
            centroidLng: 121.5,
            members: [
              { id: "d-0", lat: 25.0, lng: 121.5 },
              { id: "d-1", lat: 25.01, lng: 121.51 },
            ],
          },
        ],
        degraded: {
          missingTimestamp: { count: 0, ids: [] },
          missingCoordinates: { count: 0, ids: [] },
        },
      },
    ];
    expect(validateNetworkContract(network)).toEqual([]);

    (network.domestic.clusters[0] as any).temporalSeries[0].reports = -1;
    (network.domestic.clusters[0] as any).geoClusters[0].members[0].lat = "bad";
    (network.domestic.clusters[0] as any).degraded.missingTimestamp = { count: 1, ids: [7] };
    const errors = validateNetworkContract(network);
    expect(errors).toContain("scope domestic.clusters[0].temporalSeries[0].reports：必須是非負整數");
    expect(errors).toContain("scope domestic.clusters[0].geoClusters[0].members[0].lat：必須是有限數值");
    expect(errors).toContain("scope domestic.clusters[0].degraded.missingTimestamp.ids：必須是非空字串陣列");
  });

  it("全員時間缺失的降級產物省略 firstSeenTs/lastSeenTs 欄位可通過契約", () => {
    const network = makeNetwork(2, 0);
    network.domestic.stats.clusters = 1;
    network.domestic.stats.largestCluster = 2;
    network.domestic.clusters = [
      {
        id: "c0",
        members: ["d-0", "d-1"],
        size: 2,
        temporalSeries: [],
        geoClusters: [],
        degraded: {
          missingTimestamp: { count: 2, ids: ["d-0", "d-1"] },
          missingCoordinates: { count: 0, ids: [] },
        },
      },
    ];
    // 省略 firstSeenTs/lastSeenTs 是合法的可追溯降級（不以空字串輸出）。
    expect(validateNetworkContract(network)).toEqual([]);
  });

  it("firstSeenTs/lastSeenTs 以空字串輸出會被契約拒收（拒收根因回歸）", () => {
    const network = makeNetwork(2, 0);
    network.domestic.stats.clusters = 1;
    network.domestic.stats.largestCluster = 2;
    network.domestic.clusters = [
      {
        id: "c0",
        members: ["d-0", "d-1"],
        size: 2,
        firstSeenTs: "",
        lastSeenTs: "",
      },
    ];
    const errors = validateNetworkContract(network);
    expect(errors).toContain("scope domestic.clusters[0].firstSeenTs：必須是非空字串");
    expect(errors).toContain("scope domestic.clusters[0].lastSeenTs：必須是非空字串");
  });

  it("檔案缺失與 JSON 損壞都回傳可定位的原因", () => {
    const dir = join("tmp", "network-contract-test");
    mkdirSync(dir, { recursive: true });
    const broken = join(dir, "broken.json");
    try {
      expect(readNetworkFile(join(dir, "missing.json")).errors).toEqual(["檔案不存在"]);
      writeFileSync(broken, "{", "utf8");
      expect(readNetworkFile(broken).errors[0]).toMatch(/^JSON 無法解析：/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("CLI 驗收失敗時包含具體檔名與原因", () => {
    const dir = join("tmp", "network-contract-cli-test");
    mkdirSync(dir, { recursive: true });
    const missing = join(dir, "missing.json");
    const script = fileURLToPath(new URL("../scripts/assert-network-contract.mjs", import.meta.url));
    try {
      const result = spawnSync(process.execPath, [script, `--file=${missing}`], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`${missing}：檔案不存在`);
      expect(formatNetworkContractErrors(missing, ["檔案不存在"])).toBe(`${missing}：檔案不存在`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("驗收命令已掛入 package 與資料稽核 workflow", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    const workflow = readFileSync(".github/workflows/pipeline-audit.yml", "utf8");
    const fetchWorkflow = readFileSync(".github/workflows/pipeline-fetch.yml", "utf8");

    expect(packageJson.scripts["check:network-contract"]).toBe("node scripts/assert-network-contract.mjs");
    expect(workflow).toContain("npm run check:network-contract");
    expect(fetchWorkflow).toContain("npm run check:network-contract");
  });
});
