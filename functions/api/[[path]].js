import { handleDataset, handleLookup } from "../_lib/api.js";

const LOOKUPS = new Set(["fraud", "judicial", "drug", "catalog"]);

function routeName(value) {
  const raw = Array.isArray(value) ? value.join("/") : String(value ?? "");
  return raw.split("/").filter(Boolean)[0] || "";
}

function notFound() {
  return new Response(JSON.stringify({ error: "未知的查詢端點" }), {
    status: 404,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function onRequestGet(context) {
  const kind = routeName(context.params?.path);
  if (kind === "dataset") return handleDataset(context);
  if (LOOKUPS.has(kind)) return handleLookup(context, kind);
  return notFound();
}
