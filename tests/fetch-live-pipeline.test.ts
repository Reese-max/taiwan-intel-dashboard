import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// @ts-expect-error — JS ESM module without types
import { validateEventContract } from "../scripts/lib/event-contract.mjs";

type UnexpectedFetch = { url: string; status: number };
type TwinkleRowsPayload = { columns: string[]; rows: unknown[][] };


const ENV_KEYS = [
  "FETCH_LIVE_DATA_DIR",
  "SOURCES",
  "EXCLUSIVE",
  "CWA_API_KEY",
  "LLM_API_KEY",
  "LLM_BASE_URL",
  "LLM_MODEL",
  "LLM_MAX_RETRIES",
  "LLM_FALLBACK_API_KEY",
  "LLM_FALLBACK_BASE_URL",
  "SUMMARY_API_KEY",
  "SUMMARY_BASE_URL",
  "SUMMARY_MODEL",
  "SUMMARY_MAX_RETRIES",
  "TWINKLE_MCP_URL",
  "TWINKLE_MCP_TOKEN",
] as const;

const originalEnv = new Map<string, string | undefined>();
for (const key of ENV_KEYS) originalEnv.set(key, process.env[key]);

const tempDirs: string[] = [];

function taiwanToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonIfExists(path: string) {
  return existsSync(path) ? readJson(path) : null;
}

function setupEnv() {
  const dir = mkdtempSync(join(tmpdir(), "fetch-live-pipeline-"));
  tempDirs.push(dir);

  process.env.FETCH_LIVE_DATA_DIR = dir;
  process.env.SOURCES = "cwa";
  process.env.EXCLUSIVE = "";
  process.env.CWA_API_KEY = "test-cwa-key";
  process.env.LLM_API_KEY = "test-llm-key";
  process.env.LLM_BASE_URL = "https://llm.invalid/v1";
  process.env.LLM_MODEL = "test-model";
  process.env.LLM_MAX_RETRIES = "0";
  process.env.LLM_FALLBACK_API_KEY = "";
  process.env.LLM_FALLBACK_BASE_URL = "";
  process.env.SUMMARY_API_KEY = "test-summary-key";
  process.env.SUMMARY_BASE_URL = "https://summary.invalid/v1";
  process.env.SUMMARY_MODEL = "test-summary-model";
  process.env.SUMMARY_MAX_RETRIES = "0";
  process.env.TWINKLE_MCP_URL = "https://twinkle.invalid/mcp";
  process.env.TWINKLE_MCP_TOKEN = "test-twinkle-token";

  return dir;
}

function earthquakeFixture() {
  const day = taiwanToday();
  return {
    records: {
      Earthquake: [
        {
          EarthquakeNo: 20260707001,
          Web: "https://scweb.cwa.gov.tw/zh-tw/earthquake/details/20260707001",
          ReportContent: "07日09時12分臺東縣近海發生規模5.3有感地震。",
          EarthquakeInfo: {
            OriginTime: `${day}T09:12:00+08:00`,
            FocalDepth: 18.2,
            Epicenter: {
              Location: "臺東縣政府東方 35.0 公里",
              EpicenterLatitude: 22.76,
              EpicenterLongitude: 121.48,
            },
            EarthquakeMagnitude: { MagnitudeValue: 5.3 },
          },
        },
        {
          EarthquakeNo: 20260707002,
          Web: "https://scweb.cwa.gov.tw/zh-tw/earthquake/details/20260707002",
          ReportContent: "07日10時30分花蓮縣近海發生規模4.2有感地震。",
          EarthquakeInfo: {
            OriginTime: `${day}T10:30:00+08:00`,
            FocalDepth: 12.5,
            Epicenter: {
              Location: "花蓮縣政府南南東方 20.0 公里",
              EpicenterLatitude: 23.8,
              EpicenterLongitude: 121.72,
            },
            EarthquakeMagnitude: { MagnitudeValue: 4.2 },
          },
        },
      ],
    },
  };
}

function warningFixture() {
  const day = taiwanToday();
  return {
    records: {
      location: [
        {
          locationName: "臺北市",
          geocode: 63,
          hazardConditions: {
            hazards: [
              {
                info: { language: "zh-TW", phenomena: "大雨", significance: "特報" },
                validTime: { startTime: `${day} 11:00:00`, endTime: `${day} 18:00:00` },
              },
            ],
          },
        },
      ],
    },
  };
}

function mofaRssFixture(pubDate = new Date().toUTCString()) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>外交部領事事務局 旅遊警示</title>
    <item>
      <title><![CDATA[第四級：紅色儘速離境 - 加薩走廊 -]]></title>
      <link>https://www.boca.gov.tw/sp-trwa-content-1-red.html</link>
      <description><![CDATA[紅色警示測試摘要]]></description>
      <pubDate>${pubDate}</pubDate>
    </item>
    <item>
      <title><![CDATA[第三級：橙色避免前往 - 以色列 - Israel]]></title>
      <link>https://www.boca.gov.tw/sp-trwa-content-1-orange.html</link>
      <description><![CDATA[橙色警示測試摘要]]></description>
      <pubDate>${pubDate}</pubDate>
    </item>
    <item>
      <title><![CDATA[第二級：黃色注意 - 智利 - Chile]]></title>
      <link>https://www.boca.gov.tw/sp-trwa-content-1-yellow.html</link>
      <description><![CDATA[黃色警示測試摘要]]></description>
      <pubDate>${pubDate}</pubDate>
    </item>
  </channel>
</rss>`;
}

function futureIso(hours = 6) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function ncdrCapFixture({ expires = futureIso(), identifier = "ncdr-flood-test" } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${identifier}</identifier>
  <sender>wra@example.gov.tw</sender>
  <sent>2026-07-06T23:23:47+08:00</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <info>
    <language>zh-TW</language>
    <category>Met</category>
    <event>淹水</event>
    <urgency>Immediate</urgency>
    <severity>Severe</severity>
    <certainty>Observed</certainty>
    <senderName>經濟部水利署</senderName>
    <headline>南投縣水里鄉淹水示警</headline>
    <description>南投縣水里鄉低窪地區已有淹水情形，請民眾注意安全。</description>
    <instruction>請避開低窪地區。</instruction>
    <web>https://alerts.ncdr.nat.gov.tw/example/flood</web>
    <effective>2026-07-06T23:23:47+08:00</effective>
    <expires>${expires}</expires>
    <area>
      <areaDesc>南投縣水里鄉</areaDesc>
      <geocode>
        <valueName>profile:CAP-TWP:county</valueName>
        <value>10008</value>
      </geocode>
    </area>
  </info>
</alert>`;
}

const ncdrCapHref = "https://alerts.ncdr.nat.gov.tw/Capstorage/test/flood.cap";

function ncdrAtomFixture() {
  return {
    entry: [
      {
        id: "flood",
        title: "淹水",
        updated: "2026-07-06T23:23:47+08:00",
        author: { name: "測試機關" },
        link: { "@rel": "alternate", "@href": ncdrCapHref },
        summary: { "@type": "html", "#text": "淹水-摘要" },
        category: { "@term": "淹水" },
        status: "Actual",
        msgType: "Alert",
      },
      {
        id: "water-outage",
        title: "停水",
        updated: "2026-07-06T23:20:00+08:00",
        link: { "@rel": "alternate", "@href": "https://alerts.ncdr.nat.gov.tw/Capstorage/test/water.cap" },
        category: { "@term": "停水" },
        status: "Actual",
        msgType: "Alert",
      },
      {
        id: "fire-cancel",
        title: "火災",
        updated: "2026-07-06T23:10:00+08:00",
        link: { "@rel": "alternate", "@href": "https://alerts.ncdr.nat.gov.tw/Capstorage/test/cancel.cap" },
        category: { "@term": "火災" },
        status: "Actual",
        msgType: "Cancel",
      },
    ],
  };
}

function recentRssDate(minutesAgo = 5) {
  return new Date(Date.now() - minutesAgo * 60 * 1000).toUTCString();
}

function twnewsGoogleNewsRssFixture() {
  const items = [
    {
      title: "高雄街頭持刀砍人 2人送醫",
      link: "https://example.test/twnews/kaohsiung-knife",
      description: "高雄街頭發生持刀砍人事件，警方到場處理，2人送醫。",
      source: "測試社會新聞",
      minutesAgo: 5,
    },
    {
      title: "假投資群組詐騙 車手落網",
      link: "https://example.test/twnews/fraud-runner",
      description: "警方破獲假投資群組詐騙案，逮捕提領車手。",
      source: "測試反詐新聞",
      minutesAgo: 6,
    },
    {
      title: "8旬失智翁走失 警協尋",
      link: "https://example.test/twnews/missing-elder",
      description: "8旬失智翁走失，警方發布協尋通知並呼籲民眾協助。",
      source: "測試協尋新聞",
      minutesAgo: 7,
    },
    {
      title: "人氣韓劇大結局分集劇情懶人包",
      link: "https://example.test/twnews/kdrama-noise",
      description: "人氣韓劇大結局整理，分集劇情懶人包一次看。",
      source: "測試娛樂新聞",
      minutesAgo: 8,
    },
    {
      title: "委內瑞拉強震2600死",
      link: "https://example.test/twnews/venezuela-quake",
      description: "委內瑞拉發生強震造成大量傷亡，與台灣無直接關聯。",
      source: "測試國際新聞",
      minutesAgo: 9,
    },
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Google News 測試 RSS</title>
    ${items
      .map(
        (item) => `<item>
      <title><![CDATA[${item.title}]]></title>
      <link>${item.link}</link>
      <description><![CDATA[${item.description}]]></description>
      <pubDate>${recentRssDate(item.minutesAgo)}</pubDate>
      <source url="https://publisher.example.test/">${item.source}</source>
    </item>`,
      )
      .join("\n")}
  </channel>
</rss>`;
}

function emptyRssFixture() {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel></channel></rss>`;
}

function missingPersonFixture(gender: "男" | "女") {
  const token = gender === "男" ? "MISSINGMALE001" : "MISSINGFEMALE001";
  const name = gender === "男" ? "測試阿明" : "測試小美";
  return {
    E8_SJ_NM: name,
    E8_SJ_GENDER: gender,
    E8_SJ_BIRTH_YEAR: gender === "男" ? "19550101" : "19990505",
    E8_OC_DATE: "20260707",
    E8_SJ_HEIGHT: gender === "男" ? "168" : "160",
    E8_SJ_SHAPE: "中等",
    E8_SJ_SHIRT: "藍色上衣",
    E8_SJ_PANT: "黑色長褲",
    E8_SJ_SHOE: "白色運動鞋",
    E8_SJ_FEATURE: "測試特徵",
    E8_SJ_SCAR: "",
    E8_SJ_WEARING: "",
    E8_PIC_URL: `https://eze8.npa.gov.tw/E82OpendataWebE/ShowPhoto/${token}`,
  };
}

function policeNewsRows() {
  return {
    "7505": {
      columns: ["serialNo", "stitle", "deptName", "postDate", "content"],
      rows: [
        [
          "PN-001",
          "高雄警方破獲詐騙車手集團",
          "高雄市政府警察局",
          "2026-07-07 10:30:00",
          "高雄警方查獲詐騙車手集團，逮捕嫌犯並查扣證物，提醒民眾提高警覺。",
        ],
      ],
    },
  };
}

function pccTenderRows(): TwinkleRowsPayload {
  const day = taiwanToday();
  return {
    columns: [
      "title",
      "agency",
      "job_number",
      "companies",
      "date",
      "award_price",
      "award_way",
      "agency_addr",
      "detail_url",
    ],
    rows: [
      [
        "臺北市智慧交通設備採購案",
        "臺北市政府警察局",
        "PCC-TEST-001",
        "測試科技股份有限公司",
        day,
        "25000000",
        "最低標",
        "臺北市信義區市府路1號",
        "https://web.pcc.gov.tw/tps/QueryTender/query/searchTenderDetail?pk=PCC-TEST-001",
      ],
      [
        "高雄市防災通報系統維護案",
        "高雄市政府消防局",
        "PCC-TEST-002",
        "南方系統整合有限公司",
        day,
        "1200000",
        "準用最有利標",
        "高雄市苓雅區四維三路2號",
        "https://web.pcc.gov.tw/tps/QueryTender/query/searchTenderDetail?pk=PCC-TEST-002",
      ],
    ],
  };
}

function judicialHits() {
  return [
    {
      jid: "TYDM,115,桃交簡,382,20260331,1",
      jtitle: "公共危險",
      jdate: "20260331",
      court_code: "TYDM",
      issue: "酒後騎乘機車致不能安全駕駛之公共危險罪責",
      outcome_type: "有罪",
      sentence: "有期徒刑2月，併科罰金新臺幣8萬元",
      key_reasoning: "吐氣酒精濃度達每公升0.70毫克，自撞路樹",
      jpdf: "https://data.judicial.gov.tw/x.pdf",
      similarity: 0.72,
    },
    {
      jid: "KSDM,114,訴,55,20251101,1",
      jtitle: "殺人",
      jdate: "20251101",
      court_code: "KSDM",
      outcome_type: "有罪",
      sentence: "無期徒刑",
      jpdf: "https://data.judicial.gov.tw/y.pdf",
      similarity: 0.81,
    },
  ];
}

function twinkleTextResponse(body: any, payload: unknown) {
  return Response.json({
    jsonrpc: "2.0",
    id: body?.id,
    result: {
      content: [{ type: "text", text: JSON.stringify(payload) }],
    },
  });
}

function twinkleToolResponse(
  body: any,
  options: { rowsByDataset: Record<string, TwinkleRowsPayload>; judicialHits?: unknown[] },
) {
  const toolName = body?.params?.name;
  if (toolName === "search_judicial") {
    return twinkleTextResponse(body, { hits: options.judicialHits || [] });
  }
  if (toolName === "query_rows") {
    const datasetId = body?.params?.arguments?.dataset_id;
    const payload = options.rowsByDataset[datasetId] || { columns: [], rows: [] };
    return twinkleTextResponse(body, payload);
  }
  return new Response(`unexpected twinkle tool ${toolName}`, { status: 500 });
}

function disableCrimeWeeklyFetch() {
  vi.doMock("node:child_process", () => ({
    spawnSync: () => ({
      status: 1,
      stdout: "",
      stderr: "crime weekly disabled in fetch-live pipeline test",
    }),
  }));
}

function isNewsRssFetch(url: string) {
  if (url.includes("news.google.com")) return true;
  if (url.includes("llm.invalid") || url.includes("summary.invalid")) return false;
  return /^https?:\/\//.test(url);
}

function makeMockFetch(
  options: {
    cwaOk?: boolean;
    cwaWarningsOk?: boolean;
    mofaOk?: boolean;
    ncdrOk?: boolean;
    twnewsOk?: boolean;
    missingOk?: boolean;
    policeRows?: Record<string, TwinkleRowsPayload>;
    pccRows?: TwinkleRowsPayload;
    judicialHits?: unknown[];
    twinkleAll500?: boolean;
  } = {},
) {
  const unexpected: UnexpectedFetch[] = [];
  const cwaOk = options.cwaOk ?? true;
  const cwaWarningsOk = options.cwaWarningsOk ?? true;
  const mofaOk = options.mofaOk ?? true;
  const ncdrOk = options.ncdrOk ?? true;
  const twnewsOk = options.twnewsOk ?? true;
  const missingOk = options.missingOk ?? true;
  const twinkleRows = {
    ...(options.policeRows || {}),
    ...(options.pccRows ? { "pcc-tender": options.pccRows } : {}),
  };
  const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === process.env.TWINKLE_MCP_URL) {
      const body = JSON.parse(String(init?.body || "{}"));
      if (body.method === "initialize") return Response.json({ jsonrpc: "2.0", id: body.id, result: {} });
      if (body.method === "notifications/initialized") return new Response("", { status: 202 });
      if (body.method === "tools/call") {
        if (options.twinkleAll500) return new Response("Twinkle failure", { status: 500 });
        return twinkleToolResponse(body, { rowsByDataset: twinkleRows, judicialHits: options.judicialHits });
      }
      return new Response("unexpected twinkle method", { status: 500 });
    }
    if (url === "https://eze8.npa.gov.tw/E82OpendataWebE/api/MissPerson/json/Male") {
      if (!missingOk) return new Response("missing male failure", { status: 500 });
      return Response.json([missingPersonFixture("男")]);
    }
    if (url === "https://eze8.npa.gov.tw/E82OpendataWebE/api/MissPerson/json/Female") {
      if (!missingOk) return new Response("missing female failure", { status: 500 });
      return Response.json([missingPersonFixture("女")]);
    }
    if (url.includes("/datastore/E-A0015-001")) {
      if (!cwaOk) return new Response("CWA earthquake failure", { status: 500 });
      return Response.json(earthquakeFixture());
    }
    if (url.includes("/datastore/W-C0033-001")) {
      if (!cwaWarningsOk) return new Response("CWA warning failure", { status: 500 });
      return Response.json(warningFixture());
    }
    if (url === "https://www.boca.gov.tw/sp-trwa-rss-1.xml") {
      if (!mofaOk) return new Response("MOFA RSS failure", { status: 500 });
      return new Response(mofaRssFixture(), { headers: { "content-type": "application/rss+xml" } });
    }
    if (url === "https://alerts.ncdr.nat.gov.tw/JSONAtomFeed.ashx") {
      if (!ncdrOk) return new Response("NCDR atom failure", { status: 500 });
      return Response.json(ncdrAtomFixture());
    }
    if (url === ncdrCapHref) {
      return new Response(ncdrCapFixture(), { headers: { "content-type": "application/xml" } });
    }
    if (url.includes("news.google.com")) {
      if (!twnewsOk) return new Response("twnews GN RSS failure", { status: 500 });
      return new Response(twnewsGoogleNewsRssFixture(), { headers: { "content-type": "application/rss+xml" } });
    }
    if (isNewsRssFetch(url)) {
      if (!twnewsOk) return new Response("twnews direct RSS failure", { status: 500 });
      return new Response(emptyRssFixture(), { headers: { "content-type": "application/rss+xml" } });
    }
    unexpected.push({ url, status: 500 });
    return new Response("unexpected fetch blocked by test", { status: 500 });
  });
  vi.stubGlobal("fetch", mockFetch);
  return { mockFetch, unexpected };
}

async function importRun() {
  vi.resetModules();
  const mod = await import("../scripts/fetch-live.mjs");
  return mod.run as () => Promise<void>;
}

function makeCarryOverQuake() {
  const day = taiwanToday();
  return {
    id: "eq-carry-over",
    title: "臺東縣規模 5.1 地震",
    region: "臺東縣",
    lat: 22.8,
    lng: 121.4,
    timestamp: `${day}T08:00:00+08:00`,
    category: "災防",
    scope: "domestic",
    riskLevel: "high",
    summary: "預埋的上一輪 CWA 地震事件，用於驗證 last-good carry-over。",
    source: {
      name: "中央氣象署 顯著有感地震報告",
      type: "cwa",
      datasetId: "E-A0015-001",
      recordRef: "carry-over",
      url: "https://scweb.cwa.gov.tw/zh-tw/earthquake/details/carry-over",
      fetchedAt: `${day}T08:01:00+08:00`,
      query: "CWA opendata API E-A0015-001 (顯著有感地震報告)",
    },
  };
}

function makeCarryOverTwnews() {
  const now = new Date();
  return {
    id: "twnews-carry-over",
    title: "新北警方破獲詐騙機房",
    region: "新北市",
    lat: 25.0169826,
    lng: 121.4627868,
    timestamp: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
    category: "反詐",
    scope: "domestic",
    riskLevel: "medium",
    summary: "預埋的上一輪 twnews 事件，用於驗證 last-good carry-over。",
    source: {
      name: "測試社會新聞",
      type: "news-rss",
      datasetId: "tw-news",
      recordRef: "https://example.test/twnews/carry-over",
      url: "https://example.test/twnews/carry-over",
      fetchedAt: new Date(now.getTime() - 55 * 60 * 1000).toISOString(),
      query: "測試 twnews carry-over",
    },
  };
}

function makeCarryOverPolice() {
  const now = new Date();
  return {
    id: "police-news-carry-over",
    title: "警察機關新聞｜新北警方查獲詐欺機房",
    region: "新北市",
    lat: 25.0169826,
    lng: 121.4627868,
    timestamp: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
    category: "治安",
    scope: "domestic",
    riskLevel: "medium",
    summary: "預埋的上一輪 police 事件，用於驗證 last-good carry-over。",
    source: {
      name: "警政署 各警察機關新聞發布",
      type: "gov-open-data",
      datasetId: "7505",
      recordRef: "carry-over-police-news",
      url: "https://data.gov.tw/dataset/7505",
      fetchedAt: new Date(now.getTime() - 55 * 60 * 1000).toISOString(),
      query: "query_rows 7505 WHERE postDate LIKE '20%' ORDER BY postDate DESC",
    },
  };
}

function makeCarryOverPcc() {
  const now = new Date();
  return {
    id: "pcc-carry-over",
    title: "桃園市資安設備維護採購案",
    region: "桃園市",
    lat: 24.9937,
    lng: 121.3009,
    timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    category: "採購",
    scope: "domestic",
    riskLevel: "medium",
    summary: "預埋的上一輪 pcc 採購事件，用於驗證 pcc-tender last-good carry-over。",
    source: {
      name: "政府電子採購網 決標公告",
      type: "gov-open-data",
      datasetId: "pcc-tender",
      recordRef: "PCC-CARRY-OVER",
      url: "https://web.pcc.gov.tw/tps/QueryTender/query/searchTenderDetail?pk=PCC-CARRY-OVER",
      fetchedAt: new Date(now.getTime() - 115 * 60 * 1000).toISOString(),
      query: "query_rows pcc-tender carry-over fixture",
    },
  };
}

afterEach(() => {
  vi.doUnmock("node:child_process");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  process.exitCode = undefined;
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("fetch-live pipeline integration (CWA)", () => {
  it(
    "writes domestic/provenance/daily-rollup for the happy CWA skeleton",
    async () => {
      const dataDir = setupEnv();
      const { unexpected } = makeMockFetch();
      const run = await importRun();

      await run();

      const domesticPath = join(dataDir, "domestic.json");
      expect(existsSync(domesticPath)).toBe(true);
      const domestic = readJson(domesticPath);
      const contract = validateEventContract(domestic);
      expect(contract.invalid).toEqual([]);
      expect(contract.valid).toHaveLength(domestic.length);
      const quakeEvents = domestic.filter((event: any) => event.source?.datasetId === "E-A0015-001");
      expect(quakeEvents).toHaveLength(2);
      expect(quakeEvents.some((event: any) => event.title.includes("地震"))).toBe(true);

      const provenance = readJson(join(dataDir, "provenance.json"));
      expect(provenance.pipeline.cwa.ok).toBe(true);
      expect(provenance.pipeline.cwaWarnings.ok).toBe(true);
      for (const key of ["police", "twnews", "international", "mofa", "ncdr", "pcc"]) {
        expect(provenance.pipeline[key].skipped).toBe(true);
      }

      const rollup = readJson(join(dataDir, "daily-rollup.json"));
      const today = taiwanToday();
      expect(rollup.days[today].byScope.domestic).toBeGreaterThanOrEqual(quakeEvents.length);
      expect(unexpected.every((entry) => entry.status === 500)).toBe(true);
    },
    60_000,
  );

  it(
    "carries over the previous CWA earthquake snapshot when CWA fetch fails",
    async () => {
      const dataDir = setupEnv();
      const carryOver = makeCarryOverQuake();
      writeFileSync(join(dataDir, "domestic.json"), JSON.stringify([carryOver], null, 2), "utf8");
      const { unexpected } = makeMockFetch({ cwaOk: false, cwaWarningsOk: false });
      const run = await importRun();

      await run();

      const provenance = readJson(join(dataDir, "provenance.json"));
      expect(provenance.pipeline.cwa.ok).toBe(false);
      expect(provenance.pipeline.cwaWarnings.ok).toBe(false);
      const domestic = readJson(join(dataDir, "domestic.json"));
      expect(domestic.some((event: any) => event.id === carryOver.id)).toBe(true);
      expect(domestic.find((event: any) => event.id === carryOver.id)?.source.datasetId).toBe("E-A0015-001");
      expect(validateEventContract(domestic).invalid).toEqual([]);
      expect(unexpected.every((entry) => entry.status === 500)).toBe(true);
    },
    60_000,
  );

  it(
    "fails soft when every fetch returns 500 and no previous snapshot exists",
    async () => {
      const dataDir = setupEnv();
      const { unexpected } = makeMockFetch({ cwaOk: false, cwaWarningsOk: false });
      const run = await importRun();

      await expect(run()).resolves.toBeUndefined();

      const provenance = readJson(join(dataDir, "provenance.json"));
      expect(provenance.pipeline.cwa.ok).toBe(false);
      expect(provenance.pipeline.cwaWarnings.ok).toBe(false);
      const domestic = readJsonIfExists(join(dataDir, "domestic.json"));
      expect(domestic === null || (Array.isArray(domestic) && domestic.length === 0)).toBe(true);
      expect(unexpected.every((entry) => entry.status === 500)).toBe(true);
    },
    60_000,
  );
});

describe("fetch-live pipeline integration (MOFA + NCDR)", () => {
  it(
    "writes MOFA travel warnings and NCDR CAP alerts without touching the real network",
    async () => {
      const dataDir = setupEnv();
      process.env.SOURCES = "cwa,mofa,ncdr";
      const { unexpected } = makeMockFetch();
      const run = await importRun();

      await expect(run()).resolves.toBeUndefined();

      const provenance = readJson(join(dataDir, "provenance.json"));
      expect(provenance.pipeline.mofa).toMatchObject({ ok: true, count: 3 });
      expect(provenance.pipeline.ncdr).toMatchObject({
        ok: true,
        raw: 3,
        whitelisted: 2,
        kept: 1,
        skippedCancel: 1,
        failedDetail: 0,
      });
      expect(provenance.pipeline.ncdr.excludedCategory).toMatchObject({ 停水: 1 });

      const domestic = readJson(join(dataDir, "domestic.json"));
      const domesticContract = validateEventContract(domestic);
      expect(domesticContract.invalid).toEqual([]);
      expect(domesticContract.valid).toHaveLength(domestic.length);
      const ncdrEvent = domestic.find((event: any) => event.id === "ncdr-ncdr-flood-test");
      expect(ncdrEvent).toMatchObject({
        id: expect.stringMatching(/^ncdr-/),
        title: "南投縣水里鄉淹水示警",
        category: "災防",
        scope: "domestic",
        riskLevel: "high",
        region: "南投縣",
        source: {
          datasetId: "ncdr-cap-alert",
          recordRef: "ncdr-flood-test",
        },
      });

      const international = readJson(join(dataDir, "international.json"));
      const internationalContract = validateEventContract(international);
      expect(internationalContract.invalid).toEqual([]);
      expect(internationalContract.valid).toHaveLength(international.length);
      const mofaEvents = international.filter((event: any) => event.source?.datasetId === "mofa-travel-warning");
      expect(mofaEvents).toHaveLength(3);
      expect(mofaEvents.every((event: any) => event.scope === "international")).toBe(true);
      expect(mofaEvents.find((event: any) => event.region === "加薩走廊")?.riskLevel).toBe("critical");
      expect(mofaEvents.find((event: any) => event.region === "以色列")?.riskLevel).toBe("high");
      expect(mofaEvents.find((event: any) => event.region === "智利")?.riskLevel).toBe("medium");
      expect(unexpected.every((entry) => entry.status === 500)).toBe(true);
    },
    60_000,
  );

  it(
    "fails soft when NCDR atom fetch returns 500 while CWA still succeeds",
    async () => {
      const dataDir = setupEnv();
      process.env.SOURCES = "cwa,ncdr";
      const { unexpected } = makeMockFetch({ ncdrOk: false });
      const run = await importRun();

      await expect(run()).resolves.toBeUndefined();

      const provenance = readJson(join(dataDir, "provenance.json"));
      expect(provenance.pipeline.ncdr.ok).toBe(false);
      expect(provenance.pipeline.ncdr.error).toContain("HTTP 500");
      expect(provenance.pipeline.cwa.ok).toBe(true);
      expect(provenance.pipeline.cwaWarnings.ok).toBe(true);
      const domestic = readJson(join(dataDir, "domestic.json"));
      expect(domestic.some((event: any) => event.source?.datasetId === "E-A0015-001")).toBe(true);
      expect(domestic.some((event: any) => event.source?.datasetId === "ncdr-cap-alert")).toBe(false);
      expect(validateEventContract(domestic).invalid).toEqual([]);
      expect(unexpected.every((entry) => entry.status === 500)).toBe(true);
    },
    60_000,
  );
});

describe("fetch-live pipeline integration (twnews)", () => {
  it(
    "runs the twnews bulk path with relevance gates, categorization, risk, provenance, and LLM fail-soft",
    async () => {
      const dataDir = setupEnv();
      process.env.SOURCES = "twnews";
      const { unexpected } = makeMockFetch();
      const run = await importRun();

      await expect(run()).resolves.toBeUndefined();

      const domestic = readJson(join(dataDir, "domestic.json"));
      const contract = validateEventContract(domestic);
      expect(contract.invalid).toEqual([]);
      expect(contract.valid).toHaveLength(domestic.length);

      const knifeEvent = domestic.find((event: any) => event.title.includes("高雄街頭持刀砍人 2人送醫"));
      const fraudEvent = domestic.find((event: any) => event.title.includes("假投資群組詐騙 車手落網"));
      const missingEvent = domestic.find((event: any) => event.title.includes("8旬失智翁走失 警協尋"));
      expect(knifeEvent?.riskLevel).toBe("high");
      expect(fraudEvent?.category).toBe("反詐");
      expect(missingEvent?.category).toBe("協尋");
      expect(domestic.some((event: any) => event.title.includes("人氣韓劇大結局分集劇情懶人包"))).toBe(false);
      expect(domestic.some((event: any) => event.title.includes("委內瑞拉強震2600死"))).toBe(false);

      const provenance = readJson(join(dataDir, "provenance.json"));
      expect(provenance.pipeline.twnews.ok).toBe(true);
      expect(provenance.pipeline.twnews.normalizeFailed).toBe(true);
      expect(provenance.pipeline.twnews.gnHealth.gnFeeds).toBeGreaterThan(0);
      expect(provenance.pipeline.twnews.sourceContribution.length).toBeGreaterThan(0);
      expect(provenance.pipeline.twnews.bulk).toBeGreaterThanOrEqual(3);
      expect(provenance.pipeline.twnews.enriched).toBe(0);
      expect(unexpected.some((entry) => entry.url.includes("llm.invalid"))).toBe(true);
      expect(unexpected.every((entry) => entry.status === 500)).toBe(true);
    },
    60_000,
  );

  it(
    "carries over the previous twnews snapshot when every news feed fails",
    async () => {
      const dataDir = setupEnv();
      process.env.SOURCES = "twnews";
      const carryOver = makeCarryOverTwnews();
      writeFileSync(join(dataDir, "domestic.json"), JSON.stringify([carryOver], null, 2), "utf8");
      const { unexpected } = makeMockFetch({ twnewsOk: false });
      const run = await importRun();

      await expect(run()).resolves.toBeUndefined();

      const provenance = readJson(join(dataDir, "provenance.json"));
      expect(provenance.pipeline.twnews.ok).toBe(false);
      const domestic = readJson(join(dataDir, "domestic.json"));
      expect(domestic.some((event: any) => event.id === carryOver.id)).toBe(true);
      expect(domestic.find((event: any) => event.id === carryOver.id)?.source.datasetId).toBe("tw-news");
      expect(validateEventContract(domestic).invalid).toEqual([]);
      expect(unexpected.every((entry) => entry.status === 500)).toBe(true);
    },
    60_000,
  );
});

describe("fetch-live pipeline integration (police + missing)", () => {
  it(
    "merges missing-person API events into police domestic output with contract-safe provenance",
    async () => {
      const dataDir = setupEnv();
      process.env.SOURCES = "police,missing";
      disableCrimeWeeklyFetch();
      const { unexpected } = makeMockFetch({ policeRows: policeNewsRows() });
      const run = await importRun();

      await expect(run()).resolves.toBeUndefined();

      const domestic = readJson(join(dataDir, "domestic.json"));
      const contract = validateEventContract(domestic);
      expect(contract.invalid).toEqual([]);
      expect(contract.valid).toHaveLength(domestic.length);
      const missingEvents = domestic.filter((event: any) => event.source?.datasetId === "14420");
      expect(missingEvents).toHaveLength(2);
      expect(missingEvents.every((event: any) => event.category === "協尋")).toBe(true);
      expect(missingEvents.every((event: any) => event.id.startsWith("missing-"))).toBe(true);

      const provenance = readJson(join(dataDir, "provenance.json"));
      expect(provenance.pipeline.police.ok).toBe(true);
      expect(provenance.pipeline.police.policeNews).toMatchObject({ ok: true, count: 1 });
      expect(provenance.pipeline.missing).toMatchObject({ ok: true, count: 2 });
      expect(unexpected.every((entry) => entry.status === 500)).toBe(true);
    },
    60_000,
  );

  it(
    "marks missing as failed when both missing-person endpoints return 500 without breaking other sources",
    async () => {
      const dataDir = setupEnv();
      process.env.SOURCES = "cwa,police,missing";
      disableCrimeWeeklyFetch();
      const { unexpected } = makeMockFetch({ policeRows: policeNewsRows(), missingOk: false });
      const run = await importRun();

      await expect(run()).resolves.toBeUndefined();

      const provenance = readJson(join(dataDir, "provenance.json"));
      expect(provenance.pipeline.missing.ok).toBe(false);
      expect(provenance.pipeline.missing.error).toContain("HTTP 500");
      expect(provenance.pipeline.cwa.ok).toBe(true);
      expect(provenance.pipeline.cwaWarnings.ok).toBe(true);
      expect(provenance.pipeline.police.ok).toBe(true);

      const domestic = readJson(join(dataDir, "domestic.json"));
      expect(domestic.some((event: any) => event.source?.datasetId === "E-A0015-001")).toBe(true);
      expect(domestic.some((event: any) => event.source?.datasetId === "14420")).toBe(false);
      expect(validateEventContract(domestic).invalid).toEqual([]);
      expect(unexpected.every((entry) => entry.status === 500)).toBe(true);
    },
    60_000,
  );

  it(
    "writes a minimal police Tier1 event to domestic output and reports police ok",
    async () => {
      const dataDir = setupEnv();
      process.env.SOURCES = "police";
      disableCrimeWeeklyFetch();
      const { unexpected } = makeMockFetch({ policeRows: policeNewsRows() });
      const run = await importRun();

      await expect(run()).resolves.toBeUndefined();

      const domestic = readJson(join(dataDir, "domestic.json"));
      const contract = validateEventContract(domestic);
      expect(contract.invalid).toEqual([]);
      expect(contract.valid).toHaveLength(domestic.length);
      const policeEvent = domestic.find((event: any) => event.id === "police-news-PN-001");
      expect(policeEvent).toMatchObject({
        category: "治安",
        scope: "domestic",
        source: { datasetId: "7505", recordRef: "PN-001" },
      });

      const provenance = readJson(join(dataDir, "provenance.json"));
      expect(provenance.pipeline.police.ok).toBe(true);
      expect(provenance.pipeline.police.policeNews).toMatchObject({ ok: true, count: 1 });
      expect(unexpected.every((entry) => entry.status === 500)).toBe(true);
    },
    60_000,
  );

  it(
    "carries over previous police domestic events when every police endpoint returns 500",
    async () => {
      const dataDir = setupEnv();
      process.env.SOURCES = "police";
      const carryOver = makeCarryOverPolice();
      writeFileSync(join(dataDir, "domestic.json"), JSON.stringify([carryOver], null, 2), "utf8");
      disableCrimeWeeklyFetch();
      const { unexpected } = makeMockFetch({ twinkleAll500: true });
      const run = await importRun();

      await expect(run()).resolves.toBeUndefined();

      const provenance = readJson(join(dataDir, "provenance.json"));
      expect(provenance.pipeline.police.ok).toBe(false);
      const domestic = readJson(join(dataDir, "domestic.json"));
      expect(domestic.some((event: any) => event.id === carryOver.id)).toBe(true);
      expect(domestic.find((event: any) => event.id === carryOver.id)?.source.datasetId).toBe("7505");
      expect(validateEventContract(domestic).invalid).toEqual([]);
      expect(unexpected.every((entry) => entry.status === 500)).toBe(true);
    },
    60_000,
  );
});

describe("fetch-live pipeline integration (pcc + judicial MCP)", () => {
  it(
    "writes pcc tender events from Twinkle query_rows into domestic output",
    async () => {
      const dataDir = setupEnv();
      process.env.SOURCES = "cwa,pcc";
      const { unexpected } = makeMockFetch({ pccRows: pccTenderRows() });
      const run = await importRun();

      await expect(run()).resolves.toBeUndefined();

      const provenance = readJson(join(dataDir, "provenance.json"));
      expect(provenance.pipeline.pcc).toMatchObject({ ok: true, count: 2 });
      const domestic = readJson(join(dataDir, "domestic.json"));
      const contract = validateEventContract(domestic);
      expect(contract.invalid).toEqual([]);
      expect(contract.valid).toHaveLength(domestic.length);
      const pccEvents = domestic.filter(
        (event: any) => event.source?.datasetId === "pcc-tender" && event.category === "採購" && !event.id.startsWith("pcc-police-"),
      );
      expect(pccEvents).toHaveLength(2);
      expect(pccEvents.map((event: any) => event.source.recordRef).sort()).toEqual(["PCC-TEST-001", "PCC-TEST-002"]);
      expect(unexpected.every((entry) => entry.status === 500)).toBe(true);
    },
    60_000,
  );

  it(
    "merges judicial search_judicial hits after police succeeds",
    async () => {
      const dataDir = setupEnv();
      process.env.SOURCES = "police,judicial";
      disableCrimeWeeklyFetch();
      const { unexpected } = makeMockFetch({ policeRows: policeNewsRows(), judicialHits: judicialHits() });
      const run = await importRun();

      await expect(run()).resolves.toBeUndefined();

      const provenance = readJson(join(dataDir, "provenance.json"));
      expect(provenance.pipeline.police.ok).toBe(true);
      expect(provenance.pipeline.judicial).toMatchObject({ ok: true, count: 2 });
      const domestic = readJson(join(dataDir, "domestic.json"));
      const contract = validateEventContract(domestic);
      expect(contract.invalid).toEqual([]);
      expect(contract.valid).toHaveLength(domestic.length);
      const judicialEvents = domestic.filter((event: any) => event.source?.datasetId === "judicial");
      expect(judicialEvents).toHaveLength(2);
      expect(judicialEvents.some((event: any) => event.id.includes("TYDM") && event.category === "司法判決")).toBe(true);
      expect(unexpected.every((entry) => entry.status === 500)).toBe(true);
    },
    60_000,
  );

  it(
    "carries over previous pcc tender events when Twinkle query_rows returns 500",
    async () => {
      const dataDir = setupEnv();
      process.env.SOURCES = "pcc";
      const carryOver = makeCarryOverPcc();
      writeFileSync(join(dataDir, "domestic.json"), JSON.stringify([carryOver], null, 2), "utf8");
      const { unexpected } = makeMockFetch({ twinkleAll500: true });
      const run = await importRun();

      await expect(run()).resolves.toBeUndefined();

      const provenance = readJson(join(dataDir, "provenance.json"));
      expect(provenance.pipeline.pcc.ok).toBe(false);
      const domestic = readJson(join(dataDir, "domestic.json"));
      expect(domestic.some((event: any) => event.id === carryOver.id)).toBe(true);
      expect(domestic.find((event: any) => event.id === carryOver.id)?.source.datasetId).toBe("pcc-tender");
      expect(validateEventContract(domestic).invalid).toEqual([]);
      expect(unexpected.every((entry) => entry.status === 500)).toBe(true);
    },
    90_000,
  );
});

describe("fetch-live pipeline — international 全滅語義（靜默全敗家族修正）", () => {
  it(
    "國際 RSS 全數失敗 → pipeline.international.ok=false、run 不 throw",
    async () => {
      const dataDir = setupEnv();
      process.env.SOURCES = "rss";
      const prevTier = process.env.INTERNATIONAL_FEED_TIER;
      process.env.INTERNATIONAL_FEED_TIER = "core";
      try {
        makeMockFetch({ cwaOk: false, cwaWarningsOk: false });
        const run = await importRun();
        await expect(run()).resolves.toBeUndefined();
        const provenance = readJson(join(dataDir, "provenance.json"));
        expect(provenance.pipeline.international.ok).toBe(false);
        expect(String(provenance.pipeline.international.error || "")).toContain("全數失敗");
      } finally {
        if (prevTier === undefined) delete process.env.INTERNATIONAL_FEED_TIER;
        else process.env.INTERNATIONAL_FEED_TIER = prevTier;
      }
    },
    90_000,
  );
});
