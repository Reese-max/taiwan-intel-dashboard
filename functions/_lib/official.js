const DATA_GOV = "https://data.gov.tw";
const JUDICIAL = "https://judgment.judicial.gov.tw/FJUD/";
const TFDA_DRUGS = "https://data.fda.gov.tw/data/opendata/export/50/json";
const MAX_RESOURCE_BYTES = 2_000_000;

function timeoutSignal() {
  return typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(12_000) : undefined;
}

async function fetchOk(url, init = {}, label = "上游資料") {
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json, text/html;q=0.9, text/csv;q=0.8");
  const response = await fetch(url, { ...init, headers, signal: init.signal || timeoutSignal() });
  if (!response.ok) throw new Error(`${label} 回覆 HTTP ${response.status}`);
  return response;
}

function decodeHtml(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value ?? "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()] || "";
    const hex = entity[1].toLowerCase() === "x";
    return String.fromCodePoint(Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10));
  });
}

function textOnly(value) {
  return decodeHtml(String(value ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function hiddenValue(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = html.match(new RegExp(`<input[^>]+name="${escaped}"[^>]+value="([^"]*)"`, "i"))?.[1];
  if (value == null) throw new Error(`司法院查詢頁缺少 ${name}`);
  return decodeHtml(value);
}

function queryNeedle(query) {
  const raw = query.toLocaleLowerCase("zh-TW");
  const host = raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return host.length >= 2 ? host : raw;
}

async function officialFraud(context, query) {
  const snapshotUrl = new URL("/data/query-snapshot.json", context.request.url);
  const snapshot = await (await fetchOk(snapshotUrl, {}, "反詐快照")).json();
  const needle = queryNeedle(query);
  const events = Array.isArray(snapshot.fraud) ? snapshot.fraud : [];
  const matched = events.filter((event) => [
    event.title,
    event.summary,
    event.source?.name,
    event.source?.recordRef,
  ].some((value) => String(value || "").toLocaleLowerCase("zh-TW").includes(needle))).slice(0, 75);

  const hits = matched.map((event) => {
    const datasetId = String(event.source?.datasetId || "");
    if (datasetId === "176455") {
      return {
        source: "165 涉詐網站停解析",
        url: event.source?.recordRef || event.title?.split("：").pop() || "",
        nature: String(event.summary || "").match(/網站性質：([^。]+)/)?.[1] || "",
        time: event.timestamp || "",
      };
    }
    if (datasetId === "160055") {
      return {
        source: "165 假投資(博弈)網站",
        name: event.title?.split("：").pop() || "",
        url: String(event.summary || "").match(/網站\s+([^，。\s]+)/)?.[1] || "",
        to: event.timestamp || "",
      };
    }
    return {
      source: "165 詐騙闢謠專區",
      title: event.title || "",
      time: event.timestamp || "",
      content: String(event.summary || "").slice(0, 200),
    };
  });

  return {
    query,
    matched: hits.length > 0,
    hits,
    verdict: hits.length
      ? `⚠ 命中 ${hits.length} 筆 165 通報紀錄，高度可疑，請進一步查證。`
      : "未命中本站最新 165 官方資料快照；但未命中不代表安全，新型詐騙可能尚未收錄。",
    source: "警政署 165 官方資料快照",
    updatedAt: snapshot.generatedAt || null,
  };
}

async function officialJudicial(query, limit = 5) {
  const entry = await (await fetchOk(`${JUDICIAL}default.aspx`, {}, "司法院查詢頁")).text();
  const body = new URLSearchParams({
    __VIEWSTATE: hiddenValue(entry, "__VIEWSTATE"),
    __VIEWSTATEGENERATOR: hiddenValue(entry, "__VIEWSTATEGENERATOR"),
    __VIEWSTATEENCRYPTED: hiddenValue(entry, "__VIEWSTATEENCRYPTED"),
    __EVENTVALIDATION: hiddenValue(entry, "__EVENTVALIDATION"),
    txtKW: query,
    judtype: "JUDBOOK",
    whosub: "0",
    "ctl00$cp_content$btnSimpleQry": "送出查詢",
  });
  const resultPage = await (await fetchOk(`${JUDICIAL}default.aspx`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  }, "司法院查詢")).text();
  const listPath = decodeHtml(resultPage.match(/iframe src="([^"]*qryresultlst[^"]*)"/i)?.[1] || "");
  if (!listPath) throw new Error("司法院查詢未回傳結果頁");
  const listHtml = await (await fetchOk(new URL(listPath, JUDICIAL), {}, "司法院查詢結果")).text();
  const pattern = /<tr>\s*<td[^>]*>\s*\d+\.\s*<\/td>\s*<td><a[^>]+href="([^"]*data\.aspx\?[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>\s*<tr class="summary">[\s\S]*?<span class="tdCut">([\s\S]*?)<\/span>/gi;
  const hits = [];
  for (const match of listHtml.matchAll(pattern)) {
    const href = new URL(decodeHtml(match[1]), JUDICIAL);
    const title = textOnly(match[2]);
    hits.push({
      jid: href.searchParams.get("id") || "",
      jtitle: title,
      court_code: title.split(/\s+\d{2,3}\s+年度/)[0] || "",
      jdate: textOnly(match[3]),
      issue: textOnly(match[4]),
      key_reasoning: textOnly(match[5]).slice(0, 300),
      jpdf: href.href,
      similarity: null,
    });
    if (hits.length >= limit) break;
  }
  return { hits };
}

async function officialDrug(query) {
  const rows = await (await fetchOk(TFDA_DRUGS, {}, "食藥署管制藥品資料")).json();
  const needle = query.toLocaleLowerCase("zh-TW").replace(/\s+/g, "");
  const hits = (Array.isArray(rows) ? rows : []).filter((row) => [row["藥物名稱"], row["俗名"]]
    .some((value) => String(value || "").toLocaleLowerCase("zh-TW").replace(/\s+/g, "").includes(needle)))
    .slice(0, 20)
    .map((row) => ({
      name_zh: row["藥物名稱"] || row["俗名"] || "",
      name_en: "",
      controlled_class: row["分級"] || "",
      indication: row["醫療用途"] || "",
      dosage_form: row["濫用方式"] || "",
      license_no: "TFDA 資料集 50",
    }));
  return { hits };
}

async function officialCatalog(query, limit = 20) {
  const response = await fetchOk(`${DATA_GOV}/api/front/dataset/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bool: [{ fulltext: { value: query } }],
      filter: [],
      page_num: 1,
      page_limit: limit,
      tids: [],
      sort: "_score_desc",
    }),
  }, "政府資料開放平臺目錄");
  const payload = (await response.json()).payload || {};
  const hits = (Array.isArray(payload.search_result) ? payload.search_result : []).map((row) => ({
    dataset_id: String(row.nid || ""),
    name: row.title || "",
    agency: row.agency_name || "",
    primary_domain: row.category_name || "",
    update_freq: row.updatefreq_desc || "",
    quality_tier: row.quality_badge_type || "",
    formats: Array.isArray(row.all_file_format_name) ? row.all_file_format_name : [],
    is_normalised: false,
    geo_has_latlon: false,
    geo_has_twd97: false,
  }));
  return { count: Number(payload.search_count) || hits.length, hits };
}

function rowsFromJson(value) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "records", "result", "results", "items", "payload"]) {
    if (Array.isArray(value?.[key])) return value[key];
    if (value?.[key] && typeof value[key] === "object") {
      const nested = rowsFromJson(value[key]);
      if (nested.length) return nested;
    }
  }
  return value && typeof value === "object" ? [value] : [];
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted && ch === '"' && text[i + 1] === '"') {
      cell += '"';
      i += 1;
    } else if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
  return rows;
}

function stringCell(value) {
  if (value == null) return "";
  return typeof value === "object" ? JSON.stringify(value).slice(0, 1000) : String(value).slice(0, 1000);
}

export async function officialDataset(id) {
  if (!/^\d+$/.test(id)) throw new Error("官方資料集預覽僅支援數字 id");
  const detail = (await (await fetchOk(`${DATA_GOV}/api/front/dataset/detail?nid=${id}`, {}, "資料集詮釋資料")).json()).payload;
  const resources = Array.isArray(detail?.resources) ? detail.resources : [];
  const resource = resources.find((item) => String(item.file_format).toUpperCase() === "JSON")
    || resources.find((item) => String(item.file_format).toUpperCase() === "CSV");
  if (!resource?.url) throw new Error("此資料集沒有可直接預覽的 JSON／CSV 資源");
  const response = await fetchOk(resource.url, {}, "資料集資源");
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_RESOURCE_BYTES) throw new Error("資料集資源過大，請改至官方頁面下載");
  const text = await response.text();
  if (text.length > MAX_RESOURCE_BYTES) throw new Error("資料集資源過大，請改至官方頁面下載");

  if (String(resource.file_format).toUpperCase() === "CSV") {
    const parsed = parseCsv(text);
    return { id, columns: parsed[0] || [], rows: parsed.slice(1, 51), rowCount: Math.max(0, parsed.length - 1) };
  }

  const records = rowsFromJson(JSON.parse(text));
  const objects = records.slice(0, 50).map((row) => row && typeof row === "object" ? row : { value: row });
  const columns = [...new Set(objects.flatMap((row) => Object.keys(row)))].slice(0, 40);
  return {
    id,
    columns,
    rows: objects.map((row) => columns.map((column) => stringCell(row[column]))),
    rowCount: records.length,
  };
}

export async function officialLookup(context, kind, query) {
  if (kind === "fraud") return officialFraud(context, query);
  if (kind === "judicial") return { query, cases: (await officialJudicial(query)).hits.map((hit) => ({
    jid: hit.jid,
    title: hit.jtitle,
    court: hit.court_code,
    date: hit.jdate,
    issue: hit.issue,
    outcome: "",
    winner: "",
    sentence: "",
    reasoning: hit.key_reasoning,
    pdf: hit.jpdf,
    similarity: null,
  })), source: "司法院裁判書查詢" };
  if (kind === "drug") {
    const parsed = await officialDrug(query);
    const items = parsed.hits.map((hit) => ({
      nameZh: hit.name_zh,
      nameEn: hit.name_en,
      controlledClass: hit.controlled_class,
      indication: hit.indication,
      dosageForm: hit.dosage_form,
      licenseNo: hit.license_no,
    }));
    return {
      query,
      found: items.length > 0,
      items,
      caveat: "資料來源：衛福部食藥署常見濫用管制藥品資料集；仍以現行法規及鑑驗結果為準。",
      source: "衛福部食藥署資料集 50",
    };
  }
  if (kind === "catalog") {
    const parsed = await officialCatalog(query);
    return {
      query,
      count: parsed.count,
      datasets: parsed.hits.map((hit) => ({
        id: hit.dataset_id,
        name: hit.name,
        agency: hit.agency,
        domain: hit.primary_domain,
        updateFreq: hit.update_freq,
        quality: hit.quality_tier,
        formats: hit.formats,
        normalised: false,
        hasGeo: false,
      })),
      source: "政府資料開放平臺",
    };
  }
  throw new Error("未知的官方資料查詢端點");
}
