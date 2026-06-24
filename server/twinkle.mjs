// 警政查詢助手 — 網路層：複用既有 McpClient 呼叫 twinkle-hub 工具。
// 三個查詢：詐騙（query_rows × 3 清單）、判決（search_judicial）、毒品（search_drug）。

import { McpClient } from "../scripts/lib/mcp-client.mjs";
import { parseTwinkleRowsText } from "../scripts/lib/twinkle-query.mjs";
import { sqlEscape } from "./normalize.mjs";

const FRAUD_LIMIT = 25;
const JUDICIAL_LIMIT = 5;

function getCreds() {
  const url = process.env.TWINKLE_MCP_URL;
  const token = process.env.TWINKLE_MCP_TOKEN;
  if (!url || !token) throw new Error("TWINKLE_MCP_URL / TWINKLE_MCP_TOKEN 未設定");
  return { url, token };
}

async function callTool(name, args) {
  const { url, token } = getCreds();
  const client = new McpClient(url, token);
  await client.init();
  return parseTwinkleRowsText(await client.callTool(name, args), name);
}

// 詐騙查驗：三份清單並行查（皆 ILIKE 子字串）。回 { stopped, gambling, debunk }。
export async function fraudLookup(q) {
  const safe = sqlEscape(q);
  const { url, token } = getCreds();
  const client = new McpClient(url, token);
  await client.init();
  const rows = async (dataset_id, where) =>
    parseTwinkleRowsText(await client.callTool("query_rows", { dataset_id, where, limit: FRAUD_LIMIT }), "query_rows");
  const [stopped, gambling, debunk] = await Promise.all([
    rows("176455", `網域 ILIKE '%${safe}%'`),
    rows("160055", `WEBURL ILIKE '%${safe}%' OR WEBSITE_NM ILIKE '%${safe}%'`),
    rows("38262", `標題 ILIKE '%${safe}%' OR 發佈內容 ILIKE '%${safe}%'`),
  ]);
  return { stopped, gambling, debunk };
}

// 判決檢索：語意搜尋。回 search_judicial 原始解析物件（含 hits[]）。
export async function judicialSearch(q, limit = JUDICIAL_LIMIT) {
  return callTool("search_judicial", { query: q, limit });
}

// 毒品/管制藥品速查：依名稱查管制藥品許可庫。回 search_drug 原始解析物件（含 hits[]）。
export async function drugLookup(q) {
  return callTool("search_drug", { name: q });
}

const CATALOG_LIMIT = 20;
const PREVIEW_LIMIT = 50;

// 通用目錄查詢：依主題關鍵字找候選資料集。回 search_datasets 原始解析物件（含 hits[]）。
export async function catalogSearch(q, limit = CATALOG_LIMIT) {
  return callTool("search_datasets", { query: q, limit });
}

// 資料集預覽：拉指定 dataset 的前數列（不接受使用者 WHERE，避免任意 SQL）。
export async function datasetPreview(id, limit = PREVIEW_LIMIT) {
  return callTool("query_rows", { dataset_id: id, limit });
}
