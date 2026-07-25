import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE_URL = "https://taiwan-intel-dashboard.pages.dev";
const REQUIRED_REFERENCE_DOMAINS = new Map([
  ["金融市場", "reference"],
  ["勞動／職災", "reference"],
  ["電信／網路服務", "gap"],
]);
const SOURCE_DATASET_IDS = {
  financeDerivatives: "11598",
  laborStats: "123349",
};

function asObject(value) {
  return value && typeof value === "object" ? value : null;
}

export function requiredDatasetsFromArgs(fetchArgs = "") {
  const args = String(fetchArgs);
  return Object.entries(SOURCE_DATASET_IDS)
    .filter(([source]) => args.includes(source))
    .map(([, datasetId]) => datasetId);
}

export function validateDeploymentPayload({ provenance, domainCoverage, requiredDatasetIds = [] } = {}) {
  const errors = [];
  const prov = asObject(provenance);
  const coverage = asObject(domainCoverage);
  const sources = Array.isArray(prov?.sources) ? prov.sources : [];
  const rows = Array.isArray(coverage?.rows) ? coverage.rows : [];

  if (!prov) errors.push("provenance 不是物件");
  if (!coverage) errors.push("domain-coverage 不是物件");
  if (!prov?.generatedAt || !Number.isFinite(Date.parse(prov.generatedAt))) errors.push("provenance.generatedAt 無效");
  if (!coverage?.generatedAt || !Number.isFinite(Date.parse(coverage.generatedAt))) errors.push("domain-coverage.generatedAt 無效");
  if (!sources.length) errors.push("provenance.sources 為空");

  for (const datasetId of requiredDatasetIds) {
    const source = sources.find((item) => String(item?.datasetId || "") === String(datasetId));
    if (!source || Number(source.count || 0) < 1) errors.push(`指定來源未落地：datasetId=${datasetId}`);
    else if (source.stale === true) errors.push(`指定來源仍 stale：datasetId=${datasetId}`);
  }

  const rowByKey = new Map(rows.map((row) => [String(row?.key || ""), row]));
  for (const [key, status] of REQUIRED_REFERENCE_DOMAINS) {
    if (rowByKey.get(key)?.status !== status) errors.push(`領域狀態不符：${key} 不是 ${status}`);
  }
  return { ok: errors.length === 0, errors, sourceCount: sources.length, domainCount: rows.length };
}

async function fetchJson(url, attempts = 6) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { headers: { "cache-control": "no-cache" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(5000);
    }
  }
  throw lastError;
}

export async function smokeDeployed({
  baseUrl = process.env.DEPLOY_BASE_URL || DEFAULT_BASE_URL,
  fetchArgs = process.env.DEPLOY_FETCH_ARGS || "",
  runId = process.env.GITHUB_RUN_ID || Date.now().toString(),
} = {}) {
  const base = String(baseUrl).replace(/\/$/, "");
  const suffix = `?smoke=${encodeURIComponent(runId)}`;
  const [provenance, domainCoverage] = await Promise.all([
    fetchJson(`${base}/data/provenance.json${suffix}`),
    fetchJson(`${base}/data/domain-coverage.json${suffix}`),
  ]);
  const result = validateDeploymentPayload({
    provenance,
    domainCoverage,
    requiredDatasetIds: requiredDatasetsFromArgs(fetchArgs),
  });
  if (!result.ok) throw new Error(result.errors.join("；"));
  return result;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  smokeDeployed()
    .then((result) => {
      console.log(`部署後 smoke 通過：${result.sourceCount} 來源列／${result.domainCount} 領域列`);
    })
    .catch((error) => {
      console.error(`部署後 smoke 失敗：${error.message}`);
      process.exitCode = 1;
    });
}
