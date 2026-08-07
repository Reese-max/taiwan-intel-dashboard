// 領域完整性清單：把「事件層已整合」與「資料集可查詢」分開，避免用事件數量冒充全域覆蓋。
// CORE_DOMAIN_SOURCES 是唯一的機械化啟用設定；SOURCES 只代表本輪抓取選擇。
const source = (sourceId, publisherName, publisherUrl, datasetId = sourceId, sourceKey = sourceId) => ({
  sourceId,
  datasetId,
  sourceKey,
  publisherName,
  publisherUrl,
  enabled: true,
});

export const CORE_DOMAIN_SOURCES = Object.freeze({
  "治安／警政": [
    source("7505", "內政部警政署", "https://data.gov.tw/dataset/7505", "7505", "police"),
    source("176455", "內政部警政署 165 全民防騙", "https://data.gov.tw/dataset/176455", "176455", "police"),
    source("14420", "內政部警政署", "https://data.gov.tw/dataset/14420", "14420", "police"),
  ],
  "災防／氣象": [
    source("E-A0015-001", "交通部中央氣象署", "https://scweb.cwa.gov.tw/zh-tw/earthquake/", "E-A0015-001", "cwa"),
    source("W-C0033-001", "交通部中央氣象署", "https://www.cwa.gov.tw/V8/C/W/warning_real.html", "W-C0033-001", "cwa"),
    source("ncdr-cap-alert", "國家災害防救科技中心", "https://alerts.ncdr.nat.gov.tw/JSONAtomFeed.ashx", "ncdr-cap-alert", "ncdr"),
  ],
  "交通／停車": [
    source("177136", "內政部警政署", "https://data.gov.tw/dataset/177136", "177136", "police"),
    source("13908", "內政部警政署", "https://data.gov.tw/dataset/13908", "13908", "police"),
    source("129136", "新竹市政府", "https://data.gov.tw/dataset/129136", "129136", "parkingHsinchu"),
    source("25940", "桃園市政府", "https://data.gov.tw/dataset/25940", "25940", "parkingTaoyuan"),
  ],
  "水情／環境": [
    source("wra-reservoir-levels", "經濟部水利署", "https://www.wra.gov.tw/ReservoirWarningTable.aspx?n=46046", "wra-reservoir-levels", "wra"),
    source("wra-river-levels", "經濟部水利署", "https://opendata.wra.gov.tw/api/v2/73c4c3de-4045-4765-abeb-89f9f9cd5ff0?format=JSON", "wra-river-levels", "wraRiver"),
    source("28178", "環境部", "https://data.gov.tw/dataset/28178", "28178", "moenvAir"),
  ],
  "能源／電力": [
    source("taipower-supply-demand", "台灣電力公司", "https://service.taipower.com.tw/data/opendata/apply/file/d006020/001.json", "taipower-supply-demand", "taipower"),
  ],
  "衛生／食安": [
    source("cdc-rods-influenza", "衛生福利部疾病管制署", "https://od.cdc.gov.tw/eic/RODS_Influenza_like_illness.json", "cdc-rods-influenza", "cdc"),
    source("tfda-noncompliant-food", "衛生福利部食品藥物管理署", "https://data.fda.gov.tw/data/opendata/export/52/json", "tfda-noncompliant-food", "tfda"),
    source("39331", "衛生福利部中央健康保險署", "https://info.nhi.gov.tw/api/iode0000s01/Dataset?rId=A21030000I-D2000H-001", "39331", "healthFacilities"),
  ],
  "資安": [
    source("twcert-tvn-rss", "國家資通安全研究院 TWCERT/CC", "https://www.twcert.org.tw/tw/rss-132-1.xml", "twcert-tvn-rss", "twcert"),
  ],
  "國防／海事／外交": [
    source("mnd-pla-activity", "國防部空軍司令部", "https://air.mnd.gov.tw/TW/News/News_List.aspx?CID=213", "mnd-pla-activity", "mnd"),
    source("cga-maritime-news", "海洋委員會海巡署", "https://www.cga.gov.tw/GipOpen/wSite/lp?ctNode=650&mp=999", "cga-maritime-news", "cga"),
  ],
  "採購／經濟": [
    source("pcc-tender", "行政院公共工程委員會", "https://web.pcc.gov.tw/pis/", "pcc-tender", "pcc"),
    source("13228", "行政院主計總處", "https://data.gov.tw/dataset/13228", "13228", "economy"),
  ],
});

export const DOMAIN_COVERAGE = [
  { key: "治安／警政", scope: "domestic", status: "integrated", categories: ["治安", "反詐", "協尋"], note: "警政、失蹤人口與台灣新聞事件" },
  { key: "災防／氣象", scope: "domestic", status: "integrated", categories: ["災防"], note: "地震、警特報、NCDR 示警與災防新聞" },
  { key: "交通／停車", scope: "domestic", status: "integrated", categories: ["交通"], note: "警政交通、採購脈絡與新竹／桃園停車供給；全台道路即時路況仍是缺口" },
  { key: "水情／環境", scope: "domestic", status: "integrated", categories: ["水情", "環境"], note: "水庫、河川水位與空品測站小時值" },
  { key: "能源／電力", scope: "domestic", status: "integrated", categories: ["能源"], note: "台電系統供需" },
  { key: "衛生／食安", scope: "domestic", status: "integrated", categories: ["衛生", "食安"], note: "CDC、TFDA 與健保居家醫療院所參考快照" },
  { key: "資安", scope: "domestic", status: "integrated", categories: ["資安"], note: "TWCERT/CC TVN 與資安新聞" },
  { key: "國防／海事／外交", scope: "domestic", status: "integrated", categories: ["國防", "海事"], note: "國防部、海巡署；外交旅遊警示在國際層" },
  { key: "採購／經濟", scope: "domestic", status: "integrated", categories: ["採購", "經濟"], note: "政府電子採購網與主計總處月指標" },
  { key: "農業", scope: "domestic", status: "reference", categories: ["農業"], datasetIds: ["70930"], note: "農業部產地價格參考快照；不是價格預測或交易建議" },
  { key: "司法／法務", scope: "domestic", status: "integrated", datasetIds: ["judicial"], note: "司法院裁判書摘要併入警政事件流" },
  { key: "消防", scope: "domestic", status: "reference", datasetIds: ["134922", "176522"], note: "已整合臺北市期間統計參考；全台消防即時案件仍是缺口" },
  { key: "國會／立法", scope: "domestic", status: "reference", datasetIds: ["ly-bills"], note: "立法院議案進度參考快照；不將政策內容自動判為風險" },
  { key: "勞動／職災", scope: "domestic", status: "reference", datasetIds: ["123349", "126835"], note: "已補新北市失業率年度參考；尚非全國即時勞動／職災事件層" },
  { key: "金融市場", scope: "domestic", status: "reference", datasetIds: ["11598"], note: "已補期貨三大法人每日統計參考；不產生買賣訊號" },
  { key: "教育／科研", scope: "domestic", status: "reference", datasetIds: ["124173"], note: "新北市高級中等學校年度統計參考；尚非全國即時教育事件層" },
  { key: "社福／人口", scope: "domestic", status: "reference", datasetIds: ["84049"], note: "臺中市人口結構參考快照；尚非全國一致社福事件層" },
  { key: "文化／觀光／體育", scope: "domestic", status: "reference", datasetIds: ["tad-index-inbound-lastmonth"], note: "已補觀光統計參考；文化與體育仍待專門來源" },
  { key: "觀光統計", scope: "domestic", status: "reference", datasetIds: ["tad-index-inbound-lastmonth"], note: "觀光署五大客源群上月概況；來源為研究用途鏡像" },
  { key: "不動產／地政", scope: "domestic", status: "query-only", note: "資料集可查詢，但交易量不應直接當成安全事件" },
  { key: "民航／無人機", scope: "domestic", status: "query-only", note: "圖資可查詢；尚未建立事件與有效期間同步層" },
  { key: "電信／網路服務", scope: "domestic", status: "gap", note: "尚未有公開、穩定且可授權的即時服務中斷來源" },
];

const CORE_DOMAIN_KEYS = new Set(Object.keys(CORE_DOMAIN_SOURCES));
const NEWS_DATASET_IDS = new Set(["tw-news"]);
const OFFICIAL_TYPES = new Set(["gov-open-data", "cwa"]);

function text(value) {
  return String(value ?? "").trim();
}

function sourceIdentity(sourceItem) {
  const key = text(sourceItem?.key);
  const datasetId = text(sourceItem?.datasetId);
  return text(sourceItem?.sourceId || (key && datasetId ? `${key}:${datasetId}` : key || datasetId || sourceItem?.name));
}

function finding(code, domain, sourceItem, reason, path) {
  return {
    severity: "fail",
    code,
    domain: domain || null,
    source: sourceIdentity(sourceItem) || path || "(未命名來源)",
    path: path || null,
    reason,
  };
}

function domainTagsFor(item, fallbackDomain) {
  const explicit = item?.domains ?? item?.domainTags ?? item?.domain ?? item?.tags;
  if (explicit === undefined) return fallbackDomain ? [fallbackDomain] : [];
  return Array.isArray(explicit) ? explicit.map(text).filter(Boolean) : [text(explicit)].filter(Boolean);
}

function normalizeSourceConfig(sourceConfig = CORE_DOMAIN_SOURCES) {
  const entries = [];
  if (Array.isArray(sourceConfig)) {
    sourceConfig.forEach((item, index) => entries.push({ item, domain: undefined, path: `sourceConfig[${index}]` }));
  } else {
    for (const [domain, items] of Object.entries(sourceConfig || {})) {
      for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
        entries.push({ item, domain, path: `sourceConfig.${domain}[${index}]` });
      }
    }
  }
  return entries.map(({ item, domain, path }) => ({
    ...item,
    sourceId: sourceIdentity(item),
    sourceKey: text(item?.sourceKey || item?.key),
    domainTags: domainTagsFor(item, domain),
    enabled: item?.enabled !== false,
    path,
  }));
}

function normalizeEnabledSourceKeys(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Set) return new Set([...value].map(text).filter(Boolean));
  if (Array.isArray(value)) {
    return new Set(value.map((item) => (typeof item === "string" ? item : item?.sourceKey || item?.key)).map(text).filter(Boolean));
  }
  if (typeof value === "object") {
    return new Set(Object.entries(value).filter(([, enabled]) => enabled === true).map(([key]) => key));
  }
  return new Set();
}

function isEnabled(item, selectedKeys) {
  return item.enabled && (!selectedKeys || selectedKeys.has(item.sourceKey));
}

function hasVerifiableSourceMetadata(item) {
  return Boolean(
    sourceIdentity(item) &&
    item.sourceKey &&
    item.publisherName &&
    /^https:\/\//.test(text(item.publisherUrl)) &&
    item.domainTags.length &&
    item.domainTags.every((tag) => CORE_DOMAIN_KEYS.has(tag)),
  );
}

function assertUniqueSourceIdentities(items, label) {
  const seen = new Set();
  for (const item of items) {
    const identity = sourceIdentity(item);
    if (!identity) throw new Error(`${label} 缺少來源識別`);
    // tw-news 是多 feed 聚合資料集，同一 datasetId 的多分類列是預期結構。
    if (NEWS_DATASET_IDS.has(text(item?.datasetId))) continue;
    if (seen.has(identity)) throw new Error(`${label} 重複來源識別：${identity}`);
    seen.add(identity);
  }
}

export function validateDomainCoverageConfig({ sourceConfig = CORE_DOMAIN_SOURCES, enabledSourceKeys: selectedSourceKeys } = {}) {
  const configured = normalizeSourceConfig(sourceConfig);
  const selectedKeys = normalizeEnabledSourceKeys(selectedSourceKeys);
  const failures = [];
  const seenByDomain = new Map();

  for (const item of configured) {
    const identity = sourceIdentity(item);
    if (!identity) failures.push(finding("source-unclassified", null, item, `來源未歸類：${item.path} 缺少 sourceId/datasetId`, item.path));
    if (!item.sourceKey) failures.push(finding("source-unclassified", null, item, `來源未歸類：${item.path} 缺少 sourceKey`, item.path));
    if (!item.publisherName || !/^https:\/\//.test(text(item.publisherUrl))) {
      failures.push(finding("source-config-invalid", null, item, `來源設定無效：${item.path} 缺少發布機構或 HTTPS 公開 URL`, item.path));
    }
    if (!item.domainTags.length) {
      failures.push(finding("source-unclassified", null, item, `來源未歸類：${identity || item.path} 沒有領域標籤`, item.path));
    }
    for (const tag of item.domainTags) {
      if (!CORE_DOMAIN_KEYS.has(tag)) {
        failures.push(finding("invalid-domain-tag", tag, item, `領域標籤無效：${item.path} 使用「${tag}」`, item.path));
        continue;
      }
      const identities = seenByDomain.get(tag) || new Set();
      if (identity && identities.has(identity)) {
        failures.push(finding("duplicate-source", tag, item, `核心領域來源識別重複：${identity}`, item.path));
      }
      identities.add(identity);
      seenByDomain.set(tag, identities);
    }
  }

  for (const domain of CORE_DOMAIN_KEYS) {
    const domainSources = configured.filter((item) => item.domainTags.includes(domain));
    const enabled = domainSources.filter((item) => isEnabled(item, selectedKeys));
    if (!enabled.length) {
      const configuredIds = domainSources.map(sourceIdentity).filter(Boolean).join(", ") || "無";
      failures.push(finding(
        "core-domain-no-enabled-source",
        domain,
        null,
        `核心領域沒有啟用來源：${domain}；設定來源：${configuredIds}`,
        `sourceConfig.${domain}`,
      ));
    }
  }
  return { ok: failures.length === 0, failures, configured, selectedKeys };
}

function sourceMatches(domain, sourceItem) {
  if (!sourceItem || sourceItem.scope !== domain.scope) return false;
  if (Array.isArray(domain.datasetIds)) return domain.datasetIds.includes(sourceItem.datasetId);
  return domain.categories?.includes(sourceItem.category) || false;
}

function configuredSourceFor(sourceItem, configured) {
  const identity = sourceIdentity(sourceItem);
  return configured.find((item) => identity && (item.sourceId === identity || item.datasetId === sourceItem?.datasetId));
}

function validateObservedSources(sources, configured) {
  const failures = [];
  for (const sourceItem of Array.isArray(sources) ? sources : []) {
    if (sourceItem?.scope !== "domestic" || NEWS_DATASET_IDS.has(text(sourceItem?.datasetId))) continue;
    const matches = DOMAIN_COVERAGE.filter((domain) => sourceMatches(domain, sourceItem));
    const configuredItem = configuredSourceFor(sourceItem, configured);
    if (configuredItem && !matches.some((domain) => configuredItem.domainTags.includes(domain.key))) {
      const expected = configuredItem.domainTags.join("、") || "無";
      failures.push(finding(
        "invalid-source-tag",
        expected,
        sourceItem,
        `來源標籤無效：${sourceIdentity(sourceItem)} 的 category「${text(sourceItem.category) || "(空白)"}」未符合設定領域 ${expected}`,
        `provenance.sources.${sourceIdentity(sourceItem)}`,
      ));
    } else if (!matches.length && (OFFICIAL_TYPES.has(sourceItem?.type) || sourceItem?.key || sourceItem?.datasetId)) {
      failures.push(finding(
        "source-unclassified",
        null,
        sourceItem,
        `來源未歸類：${sourceIdentity(sourceItem)} 沒有可對應的 scope/category 或 datasetId 領域規則`,
        `provenance.sources.${sourceIdentity(sourceItem)}`,
      ));
    }
  }
  return failures;
}

export function auditDomainCoverage(report) {
  const failures = report?.validation?.failures;
  if (!Array.isArray(failures)) {
    return {
      ok: false,
      failures: [finding("domain-coverage-invalid", null, null, "domain-coverage 缺少 validation.failures", "domain-coverage.validation")],
    };
  }
  const errors = [...failures];
  if (report?.validation?.ok !== (errors.length === 0)) {
    errors.push(finding("domain-coverage-invalid", null, null, "domain-coverage.validation.ok 與 failures 不一致", "domain-coverage.validation.ok"));
  }
  if (errors.length === 0) {
    for (const domain of CORE_DOMAIN_KEYS) {
      const row = Array.isArray(report?.rows) ? report.rows.find((candidate) => candidate?.key === domain) : null;
      if (!row) {
        errors.push(finding("domain-coverage-missing-row", domain, null, `核心領域缺少覆蓋列：${domain}`, `rows.${domain}`));
      } else if (!Number.isInteger(row.enabledSourceCount) || row.enabledSourceCount < 1 || row.coverageCount !== row.enabledSourceCount) {
        errors.push(finding("core-domain-no-enabled-source", domain, null, `核心領域啟用來源數無效：${domain}；coverageCount=${row.coverageCount ?? "(缺少)"}、enabledSourceCount=${row.enabledSourceCount ?? "(缺少)"}`, `rows.${domain}`));
      }
    }
  }
  return { ok: errors.length === 0, failures: errors };
}

export function buildDomainCoverage({ generatedAt = new Date().toISOString(), sources = [], sourceConfig = CORE_DOMAIN_SOURCES, enabledSourceKeys: selectedSourceKeys } = {}) {
  const configAudit = validateDomainCoverageConfig({ sourceConfig, enabledSourceKeys: selectedSourceKeys });
  const observedFailures = validateObservedSources(sources, configAudit.configured);
  const validationFailures = [...configAudit.failures, ...observedFailures];
  const rows = DOMAIN_COVERAGE.map((domain) => {
    const matched = (Array.isArray(sources) ? sources : []).filter((sourceItem) => sourceMatches(domain, sourceItem));
    assertUniqueSourceIdentities(matched, `領域 ${domain.key} 實際來源`);
    const configured = configAudit.configured.filter((item) => item.domainTags.includes(domain.key));
    const seenEnabledIdentities = new Set();
    const enabled = configured.filter((item) => {
      const identity = sourceIdentity(item);
      if (!isEnabled(item, configAudit.selectedKeys) || !hasVerifiableSourceMetadata(item) || seenEnabledIdentities.has(identity)) {
        return false;
      }
      seenEnabledIdentities.add(identity);
      return true;
    });
    const observedIds = new Set(matched.map(sourceIdentity).filter(Boolean));
    const lastSuccessAt = matched
      .map((sourceItem) => sourceItem.lastSuccessAt || sourceItem.fetchedAt)
      .filter(Boolean)
      .sort()
      .at(-1);
    return {
      ...domain,
      configuredSourceCount: configured.length,
      enabledSourceCount: enabled.length,
      coverageCount: enabled.length,
      sourceCount: matched.length,
      healthySourceCount: matched.filter((sourceItem) => sourceItem.stale !== true).length,
      enabledSources: enabled.map((item) => ({
        sourceId: item.sourceId,
        sourceKey: item.sourceKey,
        publisherName: item.publisherName,
        publisherUrl: item.publisherUrl,
        observed: observedIds.has(item.sourceId),
      })),
      observedSources: matched.map((sourceItem) => {
        const configuredItem = configuredSourceFor(sourceItem, configured);
        return {
          name: sourceItem.name,
          sourceId: sourceIdentity(sourceItem) || configuredItem?.sourceId,
          datasetId: sourceItem.datasetId,
          category: sourceItem.category,
          publisherName: sourceItem.publisherName || configuredItem?.publisherName,
          publisherUrl: sourceItem.publisherUrl || configuredItem?.publisherUrl,
          stale: sourceItem.stale === true,
          lastSuccessAt: sourceItem.lastSuccessAt || sourceItem.fetchedAt,
        };
      }),
      ...(lastSuccessAt ? { lastSuccessAt } : {}),
    };
  });
  const counts = Object.fromEntries(["integrated", "reference", "query-only", "gap"].map((status) => [
    status,
    rows.filter((row) => row.status === status).length,
  ]));
  return {
    generatedAt,
    policy: {
      integrated: "已進入事件管線並受來源新鮮度稽核；coverageCount 依已掛接管線且可追溯的啟用來源計算",
      reference: "官方參考快照，保留在事件檔但排除每日事件統計",
      "query-only": "可由開放資料查詢，但未承諾事件層新鮮度或完整性",
      gap: "目前沒有符合本專案契約的整合來源",
    },
    counts,
    enabledSourceKeys: [...(configAudit.selectedKeys || new Set(configAudit.configured.filter((item) => item.enabled).map((item) => item.sourceKey)))],
    validation: {
      ok: validationFailures.length === 0,
      failures: validationFailures,
    },
    rows,
  };
}
