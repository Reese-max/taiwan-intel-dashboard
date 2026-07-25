// 領域完整性清單：把「事件層已整合」與「資料集可查詢」分開，避免用事件數量冒充全域覆蓋。
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
  { key: "勞動／職災", scope: "domestic", status: "query-only", datasetIds: ["126835"], note: "資料集目前可取得列僅到 2018 年，保留查詢不宣稱新鮮" },
  { key: "金融市場", scope: "domestic", status: "query-only", datasetIds: ["11598"], note: "官方統計可查；目前快照落後，且不產生買賣訊號" },
  { key: "教育／科研", scope: "domestic", status: "reference", datasetIds: ["124173"], note: "新北市高級中等學校年度統計參考；尚非全國即時教育事件層" },
  { key: "社福／人口", scope: "domestic", status: "reference", datasetIds: ["84049"], note: "臺中市人口結構參考快照；尚非全國一致社福事件層" },
  { key: "文化／觀光／體育", scope: "domestic", status: "reference", datasetIds: ["tad-index-inbound-lastmonth"], note: "已補觀光統計參考；文化與體育仍待專門來源" },
  { key: "觀光統計", scope: "domestic", status: "reference", datasetIds: ["tad-index-inbound-lastmonth"], note: "觀光署五大客源群上月概況；來源為研究用途鏡像" },
  { key: "不動產／地政", scope: "domestic", status: "query-only", note: "資料集可查詢，但交易量不應直接當成安全事件" },
  { key: "民航／無人機", scope: "domestic", status: "query-only", note: "圖資可查詢；尚未建立事件與有效期間同步層" },
  { key: "電信／網路服務", scope: "domestic", status: "gap", note: "尚未有公開、穩定且可授權的即時服務中斷來源" },
];

function sourceMatches(domain, source) {
  if (!source || source.scope !== domain.scope) return false;
  if (Array.isArray(domain.datasetIds)) return domain.datasetIds.includes(source.datasetId);
  return domain.categories?.includes(source.category) || false;
}

export function buildDomainCoverage({ generatedAt = new Date().toISOString(), sources = [] } = {}) {
  const rows = DOMAIN_COVERAGE.map((domain) => {
    const matched = (Array.isArray(sources) ? sources : []).filter((source) => sourceMatches(domain, source));
    const lastSuccessAt = matched
      .map((source) => source.lastSuccessAt || source.fetchedAt)
      .filter(Boolean)
      .sort()
      .at(-1);
    return {
      ...domain,
      sourceCount: matched.length,
      healthySourceCount: matched.filter((source) => source.stale !== true).length,
      observedSources: matched.map((source) => ({
        name: source.name,
        datasetId: source.datasetId,
        category: source.category,
        stale: source.stale === true,
        lastSuccessAt: source.lastSuccessAt || source.fetchedAt,
      })),
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
      integrated: "已進入事件管線並受來源新鮮度稽核",
      reference: "官方參考快照，保留在事件檔但排除每日事件統計",
      "query-only": "可由開放資料查詢，但未承諾事件層新鮮度或完整性",
      gap: "目前沒有符合本專案契約的整合來源",
    },
    counts,
    rows,
  };
}
