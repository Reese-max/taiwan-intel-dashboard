// 採購 live fetcher：twinkle-hub MCP query_rows(pcc-tender) → IntelEvent[]
import { McpClient } from "./mcp-client.mjs";
import { countyCoordFromAddr } from "./coords.mjs";

const QUERY =
  "announcement_type='決標公告' AND award_price != '' AND date <= '{TODAY}' ORDER BY date DESC";

// 決標金額 → 衍生風險（關注度）指標
function riskByPrice(price) {
  const n = Number(price);
  if (!Number.isFinite(n)) return "low";
  if (n >= 1_000_000_000) return "critical"; // ≥10 億
  if (n >= 100_000_000) return "high"; // ≥1 億
  if (n >= 10_000_000) return "medium"; // ≥1000 萬
  return "low";
}

function ntd(price) {
  const n = Number(price);
  return Number.isFinite(n) ? `NT$${n.toLocaleString("en-US")}` : `NT$${price}`;
}

export async function fetchPcc({ url, token, today, limit = 15 }) {
  const client = new McpClient(url, token);
  await client.init();
  const where = QUERY.replace("{TODAY}", today);
  const raw = await client.callTool("query_rows", {
    dataset_id: "pcc-tender",
    where,
    limit,
  });
  const parsed = JSON.parse(raw);
  const cols = parsed.columns;
  const idx = (name) => cols.indexOf(name);
  const iTitle = idx("title"),
    iAgency = idx("agency"),
    iJob = idx("job_number"),
    iComp = idx("companies"),
    iDate = idx("date"),
    iPrice = idx("award_price"),
    iWay = idx("award_way"),
    iAddr = idx("agency_addr"),
    iDetail = idx("detail_url");

  const fetchedAt = new Date().toISOString();
  const events = parsed.rows.map((r, n) => {
    const job = r[iJob] || `row${n}`;
    const coord = countyCoordFromAddr(r[iAddr]) || { lat: undefined, lng: undefined, region: "全國" };
    const company = r[iComp] || "未列得標廠商";
    const way = r[iWay] || "—";
    const price = r[iPrice];
    return {
      id: `pcc-${job}`,
      title: r[iTitle] || "（無標題）",
      region: coord.region,
      lat: coord.lat,
      lng: coord.lng,
      timestamp: `${r[iDate]}T00:00:00+08:00`,
      category: "採購",
      scope: "domestic",
      riskLevel: riskByPrice(price),
      summary: `${r[iAgency] || "機關"}以${way}決標予${company},決標金額 ${ntd(price)}。`,
      source: {
        name: "政府電子採購網 決標公告",
        type: "gov-open-data",
        datasetId: "pcc-tender",
        recordRef: job,
        url: r[iDetail] || "https://web.pcc.gov.tw/pis/",
        fetchedAt,
        query: `query_rows pcc-tender: ${where}`,
      },
    };
  });
  return events;
}
