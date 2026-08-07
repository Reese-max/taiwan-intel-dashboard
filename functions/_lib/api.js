import {
  validateQuery,
  validateDatasetId,
  normalizeFraud,
  normalizeJudicial,
  normalizeDrug,
  normalizeCatalog,
  normalizeDatasetPreview,
} from "../../server/normalize.mjs";
import {
  fraudLookup,
  judicialSearch,
  drugLookup,
  catalogSearch,
  datasetPreview,
} from "../../server/twinkle.mjs";
import { officialDataset, officialLookup } from "./official.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

export async function handleLookup(context, kind) {
  const params = new URL(context.request.url).searchParams;
  let query;
  try {
    query = validateQuery(params.get("q"));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  try {
    if (kind === "fraud") {
      const result = await fraudLookup(query, context.env);
      return json(normalizeFraud({ query, ...result }));
    }
    if (kind === "judicial") {
      const parsed = await judicialSearch(query, undefined, context.env);
      return json(normalizeJudicial({ query, parsed }));
    }
    if (kind === "drug") {
      const parsed = await drugLookup(query, context.env);
      return json(normalizeDrug({ query, parsed }));
    }
    if (kind === "catalog") {
      const parsed = await catalogSearch(query, undefined, context.env);
      return json(normalizeCatalog({ query, parsed }));
    }
    return json({ error: "未知的查詢端點" }, 404);
  } catch (error) {
    console.warn(`[api ${kind}] Twinkle unavailable:`, error instanceof Error ? error.message : String(error));
    try {
      return json(await officialLookup(context, kind, query));
    } catch (fallbackError) {
      console.error(`[api ${kind}] official fallback:`, fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
      return json({ error: "查詢服務暫時無法使用，請稍後再試。" }, 502);
    }
  }
}

export async function handleDataset(context) {
  const params = new URL(context.request.url).searchParams;
  let id;
  try {
    id = validateDatasetId(params.get("id"));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  try {
    const parsed = await datasetPreview(id, undefined, context.env);
    return json(normalizeDatasetPreview({ id, parsed }));
  } catch (error) {
    console.warn("[api dataset] Twinkle unavailable:", error instanceof Error ? error.message : String(error));
    try {
      return json(await officialDataset(id));
    } catch (fallbackError) {
      console.error("[api dataset] official fallback:", fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
      return json({ error: "查詢服務暫時無法使用，請稍後再試。" }, 502);
    }
  }
}
