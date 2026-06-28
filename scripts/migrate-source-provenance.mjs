import { readFileSync, writeFileSync } from "node:fs";

const files = ["public/data/domestic.json", "public/data/international.json"];

function inferLocationPrecision(event) {
  if (event.lat === 0 && event.lng === 0) return "global";
  if (event.lat == null || event.lng == null) return "unknown";
  if (event.scope === "international") return String(event.region || "").includes("全球") ? "global" : "country";
  return event.region && event.region !== "全國" ? "city" : "country";
}

for (const file of files) {
  const events = JSON.parse(readFileSync(file, "utf8"));
  let changed = 0;

  for (const event of events) {
    const source = event.source || {};
    event.source = source;
    const url = String(source.url || source.recordRef || "");
    const oldName = typeof source.name === "string" ? source.name : "";

    if (oldName.startsWith("GN ")) {
      source.query = source.query ? `${oldName}｜${source.query}` : oldName;
      source.name = "Google News 聚合";
      changed += 1;
    }

    if (url.includes("news.google.com")) {
      if (source.aggregatorName !== "Google News") {
        source.aggregatorName = "Google News";
        changed += 1;
      }
      source.aggregatorUrl ||= source.url;
      source.ingestMethod = "google-news-rss";
      source.sourceConfidence = "aggregated";
    }

    if (!event.locationPrecision) {
      event.locationPrecision = inferLocationPrecision(event);
      changed += 1;
    }

    if (!event.locationNote && source.type === "news-rss" && event.locationPrecision !== "unknown") {
      event.locationNote = "既有資料遷移標記：新聞座標為概略位置，非原始精準地址";
      changed += 1;
    }
  }

  writeFileSync(file, JSON.stringify(events, null, 2) + "\n");
  console.log(`${file}: migrated ${changed} field(s)`);
}
