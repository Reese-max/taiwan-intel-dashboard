// 警政查詢助手 — 本機 HTTP server：服務 dist/ 靜態檔 + /api/{fraud,judicial,drug}。
// 監聽 127.0.0.1（本機自用）。密鑰僅在本程序讀 .env，不進前端。

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname, normalize as normPath } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateQuery,
  validateDatasetId,
  normalizeFraud,
  normalizeJudicial,
  normalizeDrug,
  normalizeCatalog,
  normalizeDatasetPreview,
} from "./normalize.mjs";
import {
  fraudLookup,
  judicialSearch,
  drugLookup,
  catalogSearch,
  datasetPreview,
} from "./twinkle.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist");
const PORT = Number(process.env.LOOKUP_PORT) || 8088;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

async function handleApi(pathname, params, res) {
  // /api/dataset 以 id 為參數（不接受使用者 WHERE）；其餘端點以 q 為參數。
  if (pathname === "/api/dataset") {
    let id;
    try {
      id = validateDatasetId(params.get("id"));
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
    try {
      const parsed = await datasetPreview(id);
      return sendJson(res, 200, normalizeDatasetPreview({ id, parsed }));
    } catch (e) {
      console.error(`[api ${pathname}] ${e.message}`);
      return sendJson(res, 502, { error: "查詢服務暫時無法使用，請稍後再試。" });
    }
  }

  let valid;
  try {
    valid = validateQuery(params.get("q"));
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }
  try {
    if (pathname === "/api/fraud") {
      const r = await fraudLookup(valid);
      return sendJson(res, 200, normalizeFraud({ query: valid, ...r }));
    }
    if (pathname === "/api/judicial") {
      const parsed = await judicialSearch(valid);
      return sendJson(res, 200, normalizeJudicial({ query: valid, parsed }));
    }
    if (pathname === "/api/drug") {
      const parsed = await drugLookup(valid);
      return sendJson(res, 200, normalizeDrug({ query: valid, parsed }));
    }
    if (pathname === "/api/catalog") {
      const parsed = await catalogSearch(valid);
      return sendJson(res, 200, normalizeCatalog({ query: valid, parsed }));
    }
    return sendJson(res, 404, { error: "未知的查詢端點" });
  } catch (e) {
    console.error(`[api ${pathname}] ${e.message}`); // 詳細錯誤只進 server log
    return sendJson(res, 502, { error: "查詢服務暫時無法使用，請稍後再試。" });
  }
}

async function serveStatic(pathname, res) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = normPath(join(DIST, rel));
  if (!filePath.startsWith(DIST)) {
    // 防目錄穿越
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
    return res.end(data);
  } catch {
    res.writeHead(404);
    return res.end("Not found");
  }
}

const server = createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname.startsWith("/api/")) {
    handleApi(u.pathname, u.searchParams, res).catch((e) => {
      console.error(`[server] ${e.message}`);
      sendJson(res, 500, { error: "伺服器內部錯誤" });
    });
    return;
  }
  serveStatic(u.pathname, res).catch(() => {
    res.writeHead(500);
    res.end("Server error");
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`警政查詢助手 server：http://127.0.0.1:${PORT}/`);
});
