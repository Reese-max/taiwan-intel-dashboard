import { existsSync, readFileSync } from "node:fs";

export const NETWORK_FILE = "public/data/network.json";
export const MIN_NETWORK_EVENTS = 1;

const EDGE_TYPES = ["same-incident", "same-entity", "same-topic"];
const SCOPES = ["domestic", "international"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function requiredRecord(parent, key, path, errors) {
  if (!isRecord(parent?.[key])) {
    errors.push(`${path}：必須是 JSON 物件`);
    return null;
  }
  return parent[key];
}

function validateScope(scope, value, errors) {
  const prefix = `scope ${scope}`;
  if (!isRecord(value)) {
    errors.push(`${prefix}：必須是 JSON 物件`);
    return 0;
  }

  const nodes = value.nodes;
  if (!Array.isArray(nodes)) errors.push(`${prefix}.nodes：必須是陣列`);
  else {
    nodes.forEach((node, index) => {
      const path = `${prefix}.nodes[${index}]`;
      if (!isRecord(node)) {
        errors.push(`${path}：必須是 JSON 物件`);
        return;
      }
      if (!isNonEmptyString(node.id)) errors.push(`${path}.id：必須是非空字串`);
      if (!isNonNegativeInteger(node.degree)) errors.push(`${path}.degree：必須是非負整數`);
    });
  }

  const edges = value.edges;
  if (!Array.isArray(edges)) errors.push(`${prefix}.edges：必須是陣列`);
  else {
    edges.forEach((edge, index) => {
      const path = `${prefix}.edges[${index}]`;
      if (!isRecord(edge)) {
        errors.push(`${path}：必須是 JSON 物件`);
        return;
      }
      if (!isNonEmptyString(edge.a)) errors.push(`${path}.a：必須是非空字串`);
      if (!isNonEmptyString(edge.b)) errors.push(`${path}.b：必須是非空字串`);
      if (!EDGE_TYPES.includes(edge.type)) errors.push(`${path}.type：必須是 ${EDGE_TYPES.join("／")}`);
      if (!isFiniteNumber(edge.weight)) errors.push(`${path}.weight：必須是有限數值`);
      if (!isNonEmptyString(edge.why)) errors.push(`${path}.why：必須是非空字串`);
    });
  }

  const clusters = value.clusters;
  if (!Array.isArray(clusters)) errors.push(`${prefix}.clusters：必須是陣列`);
  else {
    clusters.forEach((cluster, index) => {
      const path = `${prefix}.clusters[${index}]`;
      if (!isRecord(cluster)) {
        errors.push(`${path}：必須是 JSON 物件`);
        return;
      }
      if (!isNonEmptyString(cluster.id)) errors.push(`${path}.id：必須是非空字串`);
      if (!Array.isArray(cluster.members) || cluster.members.length === 0) {
        errors.push(`${path}.members：必須是非空陣列`);
      } else if (cluster.members.some((member) => !isNonEmptyString(member))) {
        errors.push(`${path}.members：每個成員必須是非空字串`);
      }
      if (!Number.isInteger(cluster.size) || cluster.size < 2) {
        errors.push(`${path}.size：必須是至少 2 的整數`);
      } else if (Array.isArray(cluster.members) && cluster.size !== cluster.members.length) {
        errors.push(`${path}.size：必須等於 members.length（目前 ${cluster.size}／${cluster.members.length}）`);
      }
    });
  }

  const stats = requiredRecord(value, "stats", `${prefix}.stats`, errors);
  if (!stats) return 0;

  for (const key of ["events", "edges", "clusters", "largestCluster"]) {
    if (!isNonNegativeInteger(stats[key])) errors.push(`${prefix}.stats.${key}：必須是非負整數`);
  }
  const byType = requiredRecord(stats, "byType", `${prefix}.stats.byType`, errors);
  if (byType) {
    for (const type of EDGE_TYPES) {
      if (!isNonNegativeInteger(byType[type])) errors.push(`${prefix}.stats.byType.${type}：必須是非負整數`);
    }
  }

  if (isNonNegativeInteger(stats.events) && Array.isArray(nodes) && stats.events !== nodes.length) {
    errors.push(`${prefix}.stats.events：必須等於 nodes.length（目前 ${stats.events}／${nodes.length}）`);
  }
  if (isNonNegativeInteger(stats.edges) && Array.isArray(edges) && stats.edges !== edges.length) {
    errors.push(`${prefix}.stats.edges：必須等於 edges.length（目前 ${stats.edges}／${edges.length}）`);
  }
  if (isNonNegativeInteger(stats.clusters) && Array.isArray(clusters) && stats.clusters !== clusters.length) {
    errors.push(`${prefix}.stats.clusters：必須等於 clusters.length（目前 ${stats.clusters}／${clusters.length}）`);
  }
  if (
    isNonNegativeInteger(stats.largestCluster) &&
    isNonNegativeInteger(stats.events) &&
    stats.largestCluster > stats.events
  ) {
    errors.push(`${prefix}.stats.largestCluster：不可大於 stats.events（目前 ${stats.largestCluster}／${stats.events}）`);
  }

  return isNonNegativeInteger(stats.events) ? stats.events : 0;
}

export function validateNetworkContract(network, { minEvents = MIN_NETWORK_EVENTS } = {}) {
  const errors = [];
  if (!isRecord(network)) return ["根值：必須是 JSON 物件"];

  if (!isNonEmptyString(network.generatedAt)) errors.push("generatedAt：必須是非空字串");
  else if (!Number.isFinite(Date.parse(network.generatedAt))) errors.push("generatedAt：必須是可解析的日期時間");
  if (!isNonEmptyString(network.scopeNote)) errors.push("scopeNote：必須是非空字串");

  const scopeEvents = SCOPES.map((scope) => validateScope(scope, network[scope], errors));
  const excluded = requiredRecord(network, "excluded", "excluded", errors);
  if (excluded) {
    for (const scope of SCOPES) {
      if (!isNonNegativeInteger(excluded[scope])) errors.push(`excluded.${scope}：必須是非負整數`);
    }
  }

  const minimum = Number.isInteger(minEvents) && minEvents >= 0 ? minEvents : MIN_NETWORK_EVENTS;
  const totalEvents = scopeEvents.reduce((sum, count) => sum + count, 0);
  if (totalEvents < minimum) {
    errors.push(`非空覆蓋量不足：domestic.stats.events + international.stats.events = ${totalEvents}，至少需要 ${minimum} 筆事件`);
  }
  return errors;
}

export function formatNetworkContractErrors(fileName, errors) {
  return errors.map((error) => `${fileName}：${error}`).join("\n");
}

export function readNetworkFile(filePath) {
  if (!existsSync(filePath)) return { network: null, errors: ["檔案不存在"] };

  let network;
  try {
    network = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    return { network: null, errors: [`JSON 無法解析：${error.message}`] };
  }
  return { network, errors: validateNetworkContract(network) };
}
