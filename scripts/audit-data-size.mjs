// 部署資料檔尺寸稽核。
// 動機：Cloudflare Pages 單檔上限 25MiB，超過整個部署直接失敗。domestic.json 等
// 累積型資料檔若保留窗失效（實測本地 rss-only carry-over 曾養到 268MB），會無聲逼近上限。
// 在 CI 提前告警（threshold 預設 20MB，留安全邊際）。
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "public", "data");

function argValue(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

export function auditDataSize(entries, { maxBytes = 20 * 1024 * 1024 } = {}) {
  const offenders = entries.filter((e) => e.bytes > maxBytes);
  return { ok: offenders.length === 0, offenders, maxBytes };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const maxMb = Number(argValue("max-mb") || process.env.DATA_SIZE_MAX_MB || 20);
  const entries = readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ file: f, bytes: statSync(join(DATA_DIR, f)).size }));
  for (const e of entries.sort((a, b) => b.bytes - a.bytes)) {
    console.log(`  ${(e.bytes / 1048576).toFixed(1).padStart(7)}MB  ${e.file}`);
  }
  const result = auditDataSize(entries, { maxBytes: maxMb * 1024 * 1024 });
  if (result.ok) {
    console.log(`資料檔尺寸稽核：全部 < ${maxMb}MB（Cloudflare Pages 上限 25MiB）`);
  } else {
    console.error(
      `資料檔逼近 Cloudflare Pages 25MiB 上限（>${maxMb}MB）：${result.offenders.map((o) => `${o.file} ${(o.bytes / 1048576).toFixed(1)}MB`).join(", ")}`,
    );
    process.exit(1);
  }
}
