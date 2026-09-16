import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MANIFEST_FILE = "manifest.json";
export const RULES_VERSION = "correlate-v1";

export function computeFileSha256(filePath) {
  if (!existsSync(filePath)) return null;
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function buildCohortManifest({
  dataDir,
  snapshotId,
  rulesVersion = RULES_VERSION,
  nowIso = new Date().toISOString(),
}) {
  const filesToCheck = [
    "domestic.json",
    "domestic.map.json",
    "international.json",
    "international.map.json",
    "network.json",
    "summary.json",
  ];

  const files = {};
  for (const f of filesToCheck) {
    const p = join(dataDir, f);
    if (existsSync(p)) {
      const content = readFileSync(p);
      const sha256 = createHash("sha256").update(content).digest("hex");
      const record = {
        path: f,
        sha256,
        bytes: content.byteLength,
      };
      if (f.endsWith(".json")) {
        try {
          const parsed = JSON.parse(content.toString("utf8"));
          if (Array.isArray(parsed)) {
            record.count = parsed.length;
          } else if (parsed && typeof parsed === "object" && parsed.snapshotId) {
            record.snapshotId = parsed.snapshotId;
          }
        } catch {
          // ignore
        }
      }
      files[f] = record;
    }
  }

  // 確定 snapshotId：若未指定，優先取 network.json 內部 snapshotId，其次依事件與關聯檔案 hash 衍生
  let sid = snapshotId;
  if (!sid) {
    if (files["network.json"]?.snapshotId) {
      sid = files["network.json"].snapshotId;
    } else {
      const combined = (files["domestic.json"]?.sha256 || "") + (files["network.json"]?.sha256 || "");
      const shortHash = createHash("sha256").update(combined || nowIso).digest("hex").slice(0, 8);
      sid = `cohort-${nowIso.slice(0, 10).replace(/-/g, "")}-${shortHash}`;
    }
  }

  const manifest = {
    manifestVersion: 1,
    snapshotId: sid,
    generatedAt: nowIso,
    rulesVersion,
    scopes: {
      domestic: {
        events: "domestic.json",
        map: existsSync(join(dataDir, "domestic.map.json")) ? "domestic.map.json" : "domestic.json",
        network: "network.json",
        eventCount: files["domestic.json"]?.count ?? 0,
        sha256: files["domestic.json"]?.sha256,
      },
      international: {
        events: "international.json",
        map: existsSync(join(dataDir, "international.map.json")) ? "international.map.json" : "international.json",
        network: "network.json",
        eventCount: files["international.json"]?.count ?? 0,
        sha256: files["international.json"]?.sha256,
      },
    },
    files,
  };

  return manifest;
}

export function writeCohortManifest(dataDir, manifest) {
  const target = join(dataDir, MANIFEST_FILE);
  writeFileSync(target, JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
