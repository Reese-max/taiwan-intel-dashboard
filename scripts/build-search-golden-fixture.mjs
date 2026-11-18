// 重產：node scripts/build-search-golden-fixture.mjs <domestic.json> <network.json>（使用專案既有 TypeScript 編譯器載入真實搜尋邏輯）。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const [domesticPath, networkPath] = process.argv.slice(2);
if (!domesticPath || !networkPath || process.argv.length !== 4) {
  throw new Error("Usage: node scripts/build-search-golden-fixture.mjs <domestic.json> <network.json>");
}
const root = new URL("../", import.meta.url);
const fixture = new URL("tests/fixtures/search-golden/", root);
const readJson = path => JSON.parse(readFileSync(path, "utf8"));
// 只轉譯這兩個模組，不複製搜尋規則，也不需要平台專屬的 Vite/Rollup binary。
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText).toString("base64")}`;
const topicsUrl = moduleUrl(readFileSync(new URL("src/search-topics.ts", root), "utf8"));
const querySource = readFileSync(new URL("src/search-query.ts", root), "utf8")
  .replace('"./search-topics"', JSON.stringify(topicsUrl));
const { parseSearchQuery, searchMismatch } = await import(moduleUrl(querySource));

const events = readJson(domesticPath);
const network = readJson(networkPath);
const cases = readJson(new URL("cases.json", fixture));
const now = Date.parse(network.generatedAt);
if (!Array.isArray(events) || !Number.isFinite(now) || !network.domestic
    || !Array.isArray(network.domestic.edges) || !Array.isArray(network.domestic.clusters)) {
  throw new Error("Expected an event array and a network with generatedAt/domestic.edges/domestic.clusters");
}
// 禁止出現的標題也作為保留查詢，避免修正後重產時把負面回歸樣本一起濾掉。
const queries = [...new Set(cases.flatMap(c => [c.query, c.sameHitsAs, c.hitsAtMost, ...(c.neverContains ?? [])]).filter(Boolean))]
  .map(parseSearchQuery);
const directIds = new Set(events.filter(e => e.scope === "domestic"
  && queries.some(q => searchMismatch(e, q, now) === null)).map(e => e.id));
const keptIds = new Set(directIds);
// 一跳鄰居，含所有 edge 類型；不遞迴擴展，也不改動輸入順序。
for (const edge of network.domestic.edges) {
  if (directIds.has(edge.a)) keptIds.add(edge.b);
  if (directIds.has(edge.b)) keptIds.add(edge.a);
}
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
const trimmedEvents = events.filter(e => e.scope === "domestic" && keptIds.has(e.id)).map(e => ({
  ...pick(e, ["id", "title", "summary", "region", "category", "categoryBasis", "timestamp", "scope", "riskLevel"]),
  source: pick(e.source, ["name", "type", "datasetId", "authority", "publisherName", "recordRef", "feedLabel", "url"]),
}));
const ids = new Set(trimmedEvents.map(e => e.id));
const edges = network.domestic.edges.filter(e => ids.has(e.a) && ids.has(e.b));
const reason = e => typeof e.why === "number" ? network.domestic.whyTexts[e.why] : e.why;
const whyTexts = [...new Set(edges.map(reason))];
const whyIndex = new Map(whyTexts.map((text, index) => [text, index]));
const clusters = network.domestic.clusters.map(c => {
  const members = c.members.filter(id => ids.has(id));
  return { id: c.id, members, size: members.length };
}).filter(c => c.size > 0);
const trimmedNetwork = {
  generatedAt: network.generatedAt,
  domestic: {
    nodes: trimmedEvents.map(({ id }) => ({ id })),
    edges: edges.map(e => ({ ...e, why: whyIndex.get(reason(e)) })), clusters, whyTexts,
    stats: { nodes: ids.size, edges: edges.length, clusters: clusters.length },
  },
};
mkdirSync(fixture, { recursive: true });
let totalBytes = Buffer.byteLength(readFileSync(new URL("cases.json", fixture)));
for (const [name, value] of [["domestic.json", trimmedEvents], ["network.json", trimmedNetwork]]) {
  const json = `${JSON.stringify(value)}\n`;
  writeFileSync(new URL(name, fixture), json);
  const bytes = Buffer.byteLength(json);
  totalBytes += bytes;
  console.log(`${name}: ${bytes} bytes`);
}
console.log(JSON.stringify({ inputEvents: events.length, directEvents: directIds.size, events: trimmedEvents.length,
  edges: edges.length, clusters: clusters.length, totalBytes }));
if (totalBytes >= 1_500_000) {
  console.warn("Fixture exceeds 1.5 MB: retaining all query hits, one-hop neighbors, full search text and connecting edges; no truncation applied.");
}
