// Production build via esbuild CLI (workaround: vite/rollup AND esbuild JS-API crash
// on Node 25 — exit 9 / 0xC0000409. esbuild CLI mode works fine).
// 產出可部署的 dist/：bundle + index.html + data 快照。
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  copyFileSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
} from "node:fs";
import { emptyDirContents } from "./lib/fs-safe.mjs";

const OUT = "dist";
if (existsSync(OUT)) emptyDirContents(OUT);
mkdirSync(`${OUT}/assets`, { recursive: true });

// 直接呼叫 esbuild 原生 binary（非 JS API、非 npx）：
//  - JS API 在 Node 25 會 crash（exit 9）
//  - npx 在某些 shell 不在 PATH（exit 127）
//  - execFileSync 不經 shell，免 PATH/引號問題
const ESBUILD_BIN = `node_modules/@esbuild/${process.platform}-${process.arch}/esbuild${
  process.platform === "win32" ? ".exe" : ""
}`;
const esbuild = existsSync(ESBUILD_BIN) ? ESBUILD_BIN : "node_modules/.bin/esbuild";
execFileSync(
  esbuild,
  [
    "src/main.ts",
    "src/query.ts",
    "--bundle",
    "--minify",
    "--format=esm",
    "--splitting", // 動態 import（Leaflet）切出獨立 chunk，縮減 main.js 初始體積
    `--outdir=${OUT}/assets`,
    "--loader:.png=dataurl",
  ],
  { stdio: "inherit" },
);

// 複製資料快照。domestic/international：剝掉前端用不到的 aiEntities/aiTopic（僅供
// build-network 關聯用，已先跑完）並壓掉縮排，縮減前端 payload；其餘原樣複製。
mkdirSync(`${OUT}/data`, { recursive: true });
// 前端 payload 剝肥：除 aiEntities/aiTopic（僅供 build-network）外，
//  - source.query：每事件重複存的 GN 查詢字串（per-source 相同、佔 ~13%），來源級資訊已在 provenance/SourcePanel。
//  - source.url：99.7% 與 recordRef 相同（佔 ~20%），相同則省略，前端 fallback 至 recordRef；少數 gov（url≠ref）才保留。
// 兩刀約省 domestic 三分之一體積。前端（EventCard）與 globe（intel.html）皆已對缺欄位 fallback。
function trimEvent(e) {
  const { aiEntities, aiTopic, ...rest } = e;
  if (rest.source && typeof rest.source === "object") {
    const { query, url, ...src } = rest.source;
    if (url && url !== src.recordRef) src.url = url; // 與 recordRef 不同才保留
    rest.source = src;
  }
  return rest;
}
// network.json 的 nodes 陣列（佔 ~23%）前端與 globe 皆未使用：NetworkIndex 只讀 edges/clusters，
// count() 由 edges 建鄰接表算（非 node.degree），globe 不引用 nodes → 整段丟棄。
function trimNetwork(net) {
  const dropNodes = (sec) => {
    if (!sec || typeof sec !== "object" || Array.isArray(sec)) return sec;
    const { nodes, ...rest } = sec;
    return rest;
  };
  return { ...net, domestic: dropNodes(net.domestic), international: dropNodes(net.international) };
}
const TRIM_FIELDS = new Set(["domestic.json", "international.json"]);
for (const f of readdirSync("public/data")) {
  if (TRIM_FIELDS.has(f)) {
    const arr = JSON.parse(readFileSync(`public/data/${f}`, "utf8"));
    const trimmed = Array.isArray(arr) ? arr.map(trimEvent) : arr;
    writeFileSync(`${OUT}/data/${f}`, JSON.stringify(trimmed));
  } else if (f === "network.json") {
    const net = JSON.parse(readFileSync(`public/data/${f}`, "utf8"));
    writeFileSync(`${OUT}/data/${f}`, JSON.stringify(trimNetwork(net)));
  } else {
    copyFileSync(`public/data/${f}`, `${OUT}/data/${f}`);
  }
}

// 首頁＝美化後的儀表板（地圖＋清單＋情報網，吃 data/*.json）。
// 與 dev 的 index.html 同步：含字型 preconnect/links、theme-color、description。
const dashboardHtml = `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#080c17" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20viewBox%3D'0%200%2032%2032'%3E%3Crect%20width%3D'32'%20height%3D'32'%20rx%3D'7'%20fill%3D'%23080c17'%2F%3E%3Ccircle%20cx%3D'16'%20cy%3D'16'%20r%3D'9'%20fill%3D'none'%20stroke%3D'%231f6f86'%20stroke-width%3D'1.5'%2F%3E%3Ccircle%20cx%3D'16'%20cy%3D'16'%20r%3D'5'%20fill%3D'none'%20stroke%3D'%232a8aa8'%20stroke-width%3D'1.5'%2F%3E%3Cline%20x1%3D'16'%20y1%3D'16'%20x2%3D'16'%20y2%3D'6'%20stroke%3D'%2338cdf5'%20stroke-width%3D'1.8'%20stroke-linecap%3D'round'%2F%3E%3Ccircle%20cx%3D'16'%20cy%3D'16'%20r%3D'2.3'%20fill%3D'%2338cdf5'%2F%3E%3Ccircle%20cx%3D'23'%20cy%3D'10'%20r%3D'1.5'%20fill%3D'%236366f1'%2F%3E%3C%2Fsvg%3E" />
    <meta
      name="description"
      content="台灣公開資料情報儀表板：彙整警政、治安與公共安全資料源，提供地圖、時間軸、關聯情報網與資料源健康檢查。"
    />
    <title>台灣情報儀表板</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&family=Noto+Sans+TC:wght@400;500;700;800&display=swap"
    />
    <link rel="stylesheet" href="./assets/main.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./assets/main.js"></script>
  </body>
</html>
`;
writeFileSync(`${OUT}/index.html`, dashboardHtml);
// classic.html 保留為儀表板別名（不破壞既有連結）。
writeFileSync(`${OUT}/classic.html`, dashboardHtml);

// 全球情報中心（globe.gl）移到 globe.html；intel.html 保留為別名。
copyFileSync("static/intel.html", `${OUT}/globe.html`);
copyFileSync("static/intel.html", `${OUT}/intel.html`);

// 產出 query.html（警政查詢助手，獨立頁）
writeFileSync(
  `${OUT}/query.html`,
  `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>警政查詢助手</title>
    <link rel="stylesheet" href="./assets/query.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./assets/query.js"></script>
  </body>
</html>
`,
);

// Cloudflare Pages 安全標頭（_headers）。單一寬鬆但有意義的 CSP：全頁適用（含用 unpkg
// globe.gl + inline script 的 globe.html），仍鎖 frame-ancestors/object-src/base-uri/default-src。
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https://unpkg.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");
writeFileSync(
  `${OUT}/_headers`,
  `/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()
  Content-Security-Policy: ${CSP}

/data/*.json
  Cache-Control: public, max-age=120, stale-while-revalidate=600

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
);

for (const f of readdirSync(`${OUT}/assets`)) {
  const kb = (statSync(`${OUT}/assets/${f}`).size / 1024).toFixed(1);
  console.log(`assets/${f}  ${kb} KB`);
}
console.log("Static build done -> dist/");
