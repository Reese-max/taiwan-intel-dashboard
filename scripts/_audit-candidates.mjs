// 一次性：稽核候選新聞來源可靠度。讀 JSON {queries:[], feeds:[{label,url}]}。
// 用法：node --env-file=.env scripts/_audit-candidates.mjs <candidates.json>
// 輸出：每條的 item 數（Google News 查詢自動套 when:5d，與 production gq() 對齊）；可靠門檻預設 >=3。用後刪。
import { readFileSync } from "node:fs";
import { fetchRssItems } from "./lib/fetch-rss.mjs";

const path = process.argv[2];
if (!path) { console.error("需要 candidates.json 路徑"); process.exit(1); }
const { queries = [], feeds = [] } = JSON.parse(readFileSync(path, "utf8"));

const gnews = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:5d")}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;

// 候選：Google News 查詢 + 直連 RSS
const targets = [
  ...queries.map((q) => ({ kind: "gnews", label: q, url: gnews(q) })),
  ...feeds.map((f) => ({ kind: "rss", label: f.label || f.url, url: f.url })),
];

// 限制並行（避免 Google News 限流）
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const w = async () => { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, w));
  return out;
}

const results = await mapLimit(targets, 5, async (t) => {
  try {
    const r = await fetchRssItems({ perFeed: 100, feeds: [{ label: t.label, url: t.url }] });
    const s = r.feedStatus[0];
    return { ...t, count: s.ok ? s.count : -1, err: s.error };
  } catch (e) { return { ...t, count: -1, err: e.message }; }
});

const ok = results.filter((r) => r.count >= 3).sort((a, b) => b.count - a.count);
const bad = results.filter((r) => r.count < 3);
console.log(`=== 可靠（>=3 則）：${ok.length} 條 ===`);
for (const r of ok) console.log(`  [${r.count}] ${r.kind} ｜ ${r.label}`);
console.log(`\n=== 不可靠（<3 或失敗）：${bad.length} 條 ===`);
for (const r of bad) console.log(`  [${r.count}] ${r.kind} ｜ ${r.label}${r.err ? " ｜" + r.err : ""}`);

// 估算總涵蓋（可靠來源各取前 25 則、跨來源不去重的上界）
const totalRaw = ok.reduce((s, r) => s + Math.min(r.count, 25), 0);
console.log(`\n可靠來源數=${ok.length}，perFeed=25 時原始上界約 ${totalRaw} 則（去重前）。`);
