// sources.count 一律計算最終快照；pipeline.count 則保留本輪映射候選量。
export function snapshotEventsForSource(source, events) {
  return events.filter((event) => {
    if (event.scope !== source.scope || event.source?.datasetId !== source.datasetId) return false;
    if (source.type !== "news-rss") return true;
    const label = event.source.feedLabel || event.source.name;
    if (source.scope === "domestic") {
      return source.name === `台灣新聞：${label}` && source.category === event.category;
    }
    return source.name === `國際新聞：${label}`;
  });
}

// normalizedSources 只含本輪成功解析的 LLM 輸出，不含快取或官方規則備援。
export function buildNewsProcessingNote(events, normalizedSources, configuredModel = "") {
  const refined = events.filter((event) => normalizedSources.has(event.source));
  const models = [...new Set(refined.map((event) => event.source.model || configuredModel || "未提供模型名稱"))].sort();
  const processing = refined.length
    ? `本輪落地新聞中，LLM 精修 ${refined.length} 筆（模型：${models.join("、")}）。`
    : `本輪無 LLM 新聞精修結果落地${configuredModel ? `（設定模型：${configuredModel}）` : ""}。`;
  return `${processing}未精修長尾使用來源主題與關鍵字輕量映射；官方警政備援使用原文與規則，沿用事件保留既有處理結果；原始連結保留可回溯。`;
}

export function newsNormalizationDescription(events) {
  const methods = new Set();
  for (const event of events) {
    const source = event.source || {};
    if (source.normalizationMethod === "bulk" || source.query?.endsWith("（全量收錄）")) methods.add("輕量收錄");
    else if (source.normalizationMethod === "official-police-fallback") methods.add("官方原文規則備援");
    else {
      const model = source.model || source.query?.match(/LLM\(([^)]+)\)/)?.[1];
      methods.add(model ? `LLM(${model}) 既有精修結果` : "既有正規化結果（模型未記錄）");
    }
  }
  return [...methods].sort().join("＋") || "無落地事件";
}
