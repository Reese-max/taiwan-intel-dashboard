// twinkle-hub query_rows 共用封裝
import { McpClient } from "./mcp-client.mjs";

export async function queryTwinkleRows({ url, token, dataset_id, where, order_by, limit = 10, columns, group_by }) {
  const client = new McpClient(url, token);
  await client.init();
  const args = { dataset_id, limit };
  if (where) args.where = where;
  if (order_by) args.order_by = order_by;
  if (columns) args.columns = columns;
  if (group_by) args.group_by = group_by;
  const raw = await client.callTool("query_rows", args);
  const parsed = parseTwinkleRowsText(raw, "query_rows");
  return {
    columns: parsed.columns || [],
    rows: parsed.rows || [],
  };
}

export function parseTwinkleRowsText(raw, toolName = "query_rows") {
  const text = String(raw ?? "").trim();
  if (text.startsWith("Error:")) {
    throw new Error(`Twinkle MCP tool ${toolName} failed: ${text.slice("Error:".length).trim()}`);
  }
  return JSON.parse(text);
}

export function colIdx(columns, name) {
  return columns.indexOf(name);
}

export function rowVal(row, columns, name) {
  const i = colIdx(columns, name);
  return i >= 0 ? row[i] : undefined;
}
