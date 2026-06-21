// 警政查詢助手 — 純函式層（輸入驗證、SQL 字面值跳脫、三模組 normalize）。
// 不做任何網路/IO；供 handler 呼叫，亦供測試直接驗證（沿用既有 mapper+test 模式）。

const MAX_QUERY_LEN = 200;

// 取欄位值（依欄名找 index）。缺欄回空字串。
function cell(row, columns, name) {
  const i = columns.indexOf(name);
  return i >= 0 && row[i] != null ? String(row[i]) : "";
}

function truncate(s, n) {
  const str = String(s ?? "");
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

// 驗證查詢字串：trim、非空、長度上限。不合即丟錯（handler 轉 400）。
export function validateQuery(q) {
  const s = typeof q === "string" ? q.trim() : "";
  if (!s) throw new Error("查詢字串不可為空");
  if (s.length > MAX_QUERY_LEN) throw new Error(`查詢字串過長（上限 ${MAX_QUERY_LEN} 字）`);
  return s;
}

// 跳脫 SQL 字面值：主要防線是把單引號加倍（無法跳出字串字面值）；
// 另移除控制字元（charCode < 32）與分號做縱深防禦。保留詞內空白（片語搜尋需要）。
export function sqlEscape(q) {
  const cleaned = Array.from(String(q ?? ""))
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch !== ";")
    .join("");
  return cleaned.replace(/'/g, "''");
}

// 詐騙查驗：三份清單（皆已由 twinkle WHERE 過濾）→ 統一結果 + 誠實裁決。
export function normalizeFraud({ query, stopped, gambling, debunk }) {
  const hits = [];

  for (const r of stopped?.rows || []) {
    hits.push({
      source: "165 涉詐網站停解析",
      url: cell(r, stopped.columns, "網域"),
      nature: cell(r, stopped.columns, "網站性質"),
      period: cell(r, stopped.columns, "民國年月"),
      applicant: cell(r, stopped.columns, "聲請單位"),
    });
  }

  for (const r of gambling?.rows || []) {
    const url = cell(r, gambling.columns, "WEBURL");
    const name = cell(r, gambling.columns, "WEBSITE_NM");
    if (url === "網址" || name === "網站名稱") continue; // 濾掉資料中的雜散表頭列
    hits.push({
      source: "165 假投資(博弈)網站",
      name,
      url,
      from: cell(r, gambling.columns, "STA_SDATE"),
      to: cell(r, gambling.columns, "STA_EDATE"),
    });
  }

  for (const r of debunk?.rows || []) {
    hits.push({
      source: "165 詐騙闢謠專區",
      title: cell(r, debunk.columns, "標題"),
      time: cell(r, debunk.columns, "發佈時間"),
      content: truncate(cell(r, debunk.columns, "發佈內容"), 200),
    });
  }

  const matched = hits.length > 0;
  const verdict = matched
    ? `⚠ 命中 ${hits.length} 筆 165 通報紀錄，高度可疑，請進一步查證。`
    : "未命中 165 三份清單；但未命中不代表安全（清單僅涵蓋已通報案件，新型詐騙可能尚未收錄）。";

  return { query, matched, hits, verdict };
}

// 判決檢索：search_judicial 回應 → 取關鍵欄位、截斷過長理由。
export function normalizeJudicial({ query, parsed }) {
  const hits = parsed?.hits || [];
  const cases = hits.map((h) => ({
    jid: h.jid || "",
    title: h.jtitle || "",
    court: h.court_code || "",
    date: h.jdate || "",
    issue: h.issue || "",
    outcome: h.outcome_type || "",
    winner: h.winner || "",
    sentence: h.sentence || "",
    reasoning: truncate(h.key_reasoning || "", 300),
    pdf: h.jpdf || "",
    similarity: h.similarity ?? null,
  }));
  return { query, cases };
}

// 毒品/管制藥品速查：search_drug 回應 → 去重、表面化管制級別，固定附誠實警語。
export function normalizeDrug({ query, parsed }) {
  const hits = parsed?.hits || [];
  const seen = new Set();
  const items = [];
  for (const h of hits) {
    const key = `${h.license_no}|${h.name_zh}|${h.controlled_class}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      nameZh: h.name_zh || "",
      nameEn: h.name_en || "",
      controlledClass: h.controlled_class || "",
      indication: h.indication || "",
      dosageForm: h.dosage_form || "",
      licenseNo: h.license_no || "",
    });
  }
  const found = items.length > 0;
  const caveat = found
    ? "此為衛福部管制藥品許可資料庫；查無不代表非毒品。純毒品（如海洛因、甲基安非他命）多不在許可庫，須另查《毒品危害防制條例》附表分級。"
    : "查無此名稱於管制藥品許可庫。查無不代表非毒品——純毒品（如海洛因、甲基安非他命）不在許可庫，請改查《毒品危害防制條例》附表分級或刑事鑑識。";
  return { query, found, items, caveat };
}

const MAX_PREVIEW_ROWS = 50;

// 驗證 dataset id：僅允許英數、底線、連字號（dataset 多為數字 id 或如 taipei-crime 之 slug）。
export function validateDatasetId(id) {
  const s = typeof id === "string" ? id.trim() : "";
  if (!s) throw new Error("dataset id 不可為空");
  if (s.length > 64) throw new Error("dataset id 過長");
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error("dataset id 含不合法字元");
  return s;
}

// 通用開放資料目錄查詢：search_datasets 回應 → 資料集卡片。
export function normalizeCatalog({ query, parsed }) {
  const hits = parsed?.hits || [];
  const datasets = hits.map((h) => ({
    id: h.dataset_id || "",
    name: h.name || "",
    agency: h.agency || "",
    domain: h.primary_domain || (h.domains && h.domains[0]) || "",
    updateFreq: h.update_freq || "",
    quality: h.quality_tier || "",
    formats: h.formats || [],
    normalised: !!h.is_normalised,
    hasGeo: !!(h.geo_has_latlon || h.geo_has_twd97),
  }));
  return { query, count: parsed?.count ?? datasets.length, datasets };
}

// 資料集預覽：query_rows 回應 → 欄位 + 截斷後的列（回報真實總列數）。
export function normalizeDatasetPreview({ id, parsed }) {
  const columns = parsed?.columns || [];
  const allRows = parsed?.rows || [];
  return {
    id,
    columns,
    rows: allRows.slice(0, MAX_PREVIEW_ROWS),
    rowCount: allRows.length,
  };
}
