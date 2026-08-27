// 本機靜態預覽伺服器。

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname, normalize as normPath } from "node:path";
import { fileURLToPath } from "node:url";

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
  serveStatic(u.pathname, res).catch(() => {
    res.writeHead(500);
    res.end("Server error");
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`台灣情報儀表板：http://127.0.0.1:${PORT}/`);
});
