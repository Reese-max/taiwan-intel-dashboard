import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = normalize(join(DIST, relative));
  if (!filePath.startsWith(normalize(DIST))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  const target = existsSync(filePath) && statSync(filePath).isFile() ? filePath : join(DIST, "index.html");
  const type = MIME[extname(target)] || "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  createReadStream(target).pipe(res);
}

function retryPolice(res) {
  const child = spawn(process.execPath, ["--env-file=.env", "scripts/fetch-live.mjs", "--sources=police"], {
    cwd: ROOT,
    env: process.env,
    shell: false,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.on("close", (code) => {
    sendJson(res, code === 0 ? 200 : 500, {
      ok: code === 0,
      code,
      stdout: stdout.slice(-6000),
      stderr: stderr.slice(-6000),
    });
  });
}

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url?.startsWith("/api/retry-police-source")) {
    retryPolice(res);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end("Method Not Allowed");
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Police control preview: http://localhost:${PORT}`);
});
