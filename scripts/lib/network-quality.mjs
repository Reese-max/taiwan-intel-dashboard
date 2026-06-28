const DEFAULT_MAX_LARGEST_CLUSTER = 500;

const SCOPE_LABEL = {
  domestic: "國內",
  international: "國際",
};

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function networkQualityWarnings(network = {}, { maxLargestCluster = DEFAULT_MAX_LARGEST_CLUSTER } = {}) {
  const threshold = asNumber(maxLargestCluster, DEFAULT_MAX_LARGEST_CLUSTER);
  const warnings = [];
  for (const scope of ["domestic", "international"]) {
    const stats = network?.[scope]?.stats || {};
    const largestCluster = asNumber(stats.largestCluster);
    if (largestCluster > threshold) {
      warnings.push({
        scope,
        largestCluster,
        threshold,
        events: asNumber(stats.events),
        clusters: asNumber(stats.clusters),
      });
    }
  }
  return warnings;
}

export function formatNetworkQualityWarning(warning) {
  const scope = SCOPE_LABEL[warning.scope] || warning.scope;
  return `${scope}最大情報群 ${warning.largestCluster} 筆，超過門檻 ${warning.threshold}；目前事件 ${warning.events} 筆、群集 ${warning.clusters} 個，請檢查是否出現關聯毛球。`;
}

export { DEFAULT_MAX_LARGEST_CLUSTER };
