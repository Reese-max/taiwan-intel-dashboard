import { describe, expect, it } from "vitest";

import { validateEventContract } from "../scripts/lib/event-contract.mjs";
import {
  buildNcdrEvents,
  parseCapAlert,
} from "../scripts/lib/fetch-ncdr.mjs";

const FETCHED_AT = "2026-07-06T16:00:00.000Z";
const NOW = "2026-07-06T16:30:00.000Z";

const capXml = ({
  identifier = "NFA_Fire_20260706230716004",
  sent = "2026-07-06T23:23:47+08:00",
  msgType = "Alert",
  event = "淹水",
  severity = "Severe",
  headline = "南投縣水里鄉淹水示警",
  description = " 南投縣水里鄉低窪地區已有淹水情形，請民眾注意安全。 ",
  areaDesc = "南投縣水里鄉",
  web = "https://alerts.ncdr.nat.gov.tw/example",
  senderName = "經濟部水利署",
  effective = "2026-07-06T23:23:47+08:00",
  expires = "2026-07-07T23:24:00+08:00",
} = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${identifier}</identifier>
  <sender>test@example.gov.tw</sender>
  <sent>${sent}</sent>
  <status>Actual</status>
  <msgType>${msgType}</msgType>
  <scope>Public</scope>
  <info>
    <language>zh-TW</language>
    <category>Met</category>
    <event>${event}</event>
    <urgency>Immediate</urgency>
    <severity>${severity}</severity>
    <certainty>Observed</certainty>
    <senderName>${senderName}</senderName>
    <headline>${headline}</headline>
    <description>${description}</description>
    <instruction>請避開低窪地區。</instruction>
    <web>${web}</web>
    <effective>${effective}</effective>
    <expires>${expires}</expires>
    <area>
      <areaDesc>${areaDesc}</areaDesc>
      <geocode>
        <valueName>profile:CAP-TWP:county</valueName>
        <value>10008</value>
      </geocode>
    </area>
  </info>
</alert>`;

const hrefFor = (id: string) => `https://alerts.ncdr.nat.gov.tw/Capstorage/test/${id}.cap`;

const atomEntry = ({
  id,
  category = "淹水",
  updated = "2026-07-06T23:23:47+08:00",
  expires = "2026/7/7 下午 11:24:00",
  msgType = "Alert",
}: {
  id: string;
  category?: string;
  updated?: string;
  expires?: string;
  msgType?: string;
}) => ({
  id,
  title: category,
  updated,
  author: { name: "測試機關" },
  link: { "@rel": "alternate", "@href": hrefFor(id) },
  summary: { "@type": "html", "#text": `${category}-摘要` },
  category: { "@term": category },
  status: "Actual",
  msgType,
  effective: "2026/7/6 下午 11:23:47",
  expires,
});

describe("fetch-ncdr CAP mapper", () => {
  it("parses CAP 1.2 alert fields from the first info block", () => {
    const parsed = parseCapAlert(capXml());

    expect(parsed).toMatchObject({
      identifier: "NFA_Fire_20260706230716004",
      sent: "2026-07-06T23:23:47+08:00",
      msgType: "Alert",
      event: "淹水",
      severity: "Severe",
      headline: "南投縣水里鄉淹水示警",
      areaDesc: "南投縣水里鄉",
      web: "https://alerts.ncdr.nat.gov.tw/example",
    });
    expect(parsed.description).toContain("低窪地區");
  });

  it("filters whitelist, Cancel and expired entries while keeping counters", () => {
    const ids = ["flood", "water", "reservoir", "quake", "cancel", "expired"];
    const atomJson = {
      entry: [
        atomEntry({ id: ids[0], category: "淹水" }),
        atomEntry({ id: ids[1], category: "停水" }),
        atomEntry({ id: ids[2], category: "水庫放流" }),
        atomEntry({ id: ids[3], category: "地震" }),
        atomEntry({ id: ids[4], category: "火災", msgType: "Cancel" }),
        atomEntry({ id: ids[5], category: "淹水感測", expires: "2026/7/6 下午 11:00:00" }),
      ],
    };
    const capByHref = {
      [hrefFor(ids[0])]: capXml({ identifier: ids[0], event: "淹水" }),
      [hrefFor(ids[4])]: capXml({ identifier: ids[4], event: "火災", msgType: "Cancel" }),
      [hrefFor(ids[5])]: capXml({ identifier: ids[5], event: "淹水感測" }),
    };

    const { events, status } = buildNcdrEvents(atomJson, capByHref, { now: NOW, fetchedAt: FETCHED_AT });

    expect(events).toHaveLength(1);
    expect(status).toMatchObject({
      raw: 6,
      whitelisted: 3,
      kept: 1,
      skippedCancel: 1,
      skippedExpired: 1,
      failedDetail: 0,
      excludedCategory: {
        停水: 1,
        水庫放流: 1,
        地震: 1,
      },
      byCategory: { 淹水: 1 },
    });
  });

  it("maps severity, category, county coordinates, fallback title and event contract", () => {
    const cases = [
      { id: "extreme", category: "火災", severity: "Extreme", expectedRisk: "critical", expectedCategory: "災防" },
      { id: "severe", category: "鐵路事故", severity: "Severe", expectedRisk: "high", expectedCategory: "交通" },
      { id: "moderate", category: "海洋污染", severity: "Moderate", expectedRisk: "medium", expectedCategory: "環境" },
      { id: "minor", category: "道路封閉", severity: "Minor", expectedRisk: "low", expectedCategory: "交通" },
    ];
    const atomJson = { entry: cases.map((c, i) => atomEntry({ id: c.id, category: c.category, updated: `2026-07-06T23:2${i}:00+08:00` })) };
    const capByHref = Object.fromEntries(
      cases.map((c) => [
        hrefFor(c.id),
        capXml({
          identifier: c.id,
          event: c.category,
          severity: c.severity,
          headline: c.id === "minor" ? "" : `${c.category}示警`,
          areaDesc: "南投縣水里鄉",
          description: ` ${c.category}\n測試描述 `.repeat(20),
        }),
      ]),
    );

    const { events } = buildNcdrEvents(atomJson, capByHref, { now: NOW, fetchedAt: FETCHED_AT });

    expect(events).toHaveLength(4);
    for (const c of cases) {
      const event = events.find((e) => e.id === `ncdr-${c.id}`);
      expect(event).toMatchObject({
        region: "南投縣",
        category: c.expectedCategory,
        scope: "domestic",
        riskLevel: c.expectedRisk,
      });
      expect(event?.lat).toEqual(expect.any(Number));
      expect(event?.lng).toEqual(expect.any(Number));
      expect(event?.summary.length).toBeLessThanOrEqual(200);
      expect(event?.source).toMatchObject({
        name: "NCDR示警·經濟部水利署",
        fetchedAt: FETCHED_AT,
        datasetId: "ncdr-cap-alert",
      });
    }
    expect(events.find((e) => e.id === "ncdr-minor")?.title).toBe("道路封閉｜南投縣水里鄉");
    expect(validateEventContract(events).invalid).toHaveLength(0);
  });

  it("串接所有 <area> 的 areaDesc，並對 areaDesc＋headline＋description 做縣市偵測", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>multi-area</identifier>
  <sent>2026-07-06T23:23:47+08:00</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <info>
    <event>道路封閉</event>
    <severity>Moderate</severity>
    <headline>省道台17線 115K+0 道路封閉</headline>
    <description>嘉義縣 東石鄉 台17線 115K+0 道路封閉，請用路人改道。</description>
    <area><areaDesc>嘉義縣東石鄉</areaDesc></area>
    <area><areaDesc>雲林縣口湖鄉</areaDesc></area>
  </info>
</alert>`;
    const parsed = parseCapAlert(xml);
    expect(parsed.areaDesc).toBe("嘉義縣東石鄉、雲林縣口湖鄉");

    const atomJson = { entry: [atomEntry({ id: "multi-area", category: "道路封閉" })] };
    const { events } = buildNcdrEvents(atomJson, { [hrefFor("multi-area")]: xml }, { now: NOW, fetchedAt: FETCHED_AT });
    expect(events).toHaveLength(1);
    expect(events[0].region).toBe("嘉義縣");
    expect(events[0].locationPrecision).toBe("county-center");
    expect(events[0].lat).toBeCloseTo(23.4518, 3);
  });

  it("無 areaDesc 縣市時仍從 headline/description 偵測縣市（台17線案例）", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>t17</identifier>
  <sent>2026-07-06T23:23:47+08:00</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <info>
    <event>道路封閉</event>
    <severity>Moderate</severity>
    <headline>省道台17線 115K+0 道路封閉</headline>
    <description>嘉義縣 東石鄉 台17線 115K+0 道路封閉，請用路人改道。</description>
  </info>
</alert>`;
    const atomJson = { entry: [atomEntry({ id: "t17", category: "道路封閉" })] };
    const { events } = buildNcdrEvents(atomJson, { [hrefFor("t17")]: xml }, { now: NOW, fetchedAt: FETCHED_AT });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ region: "嘉義縣", locationPrecision: "county-center" });
    expect(events[0].lat).toBeCloseTo(23.4518, 3);
  });

  it("解析 <polygon>（頂點平均）與 <circle>（圓心）為事件座標，precision=district", () => {
    const polyXml = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>poly</identifier>
  <sent>2026-07-06T23:23:47+08:00</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <info>
    <event>淹水</event>
    <severity>Severe</severity>
    <headline>淹水示警</headline>
    <description>低窪地區淹水。</description>
    <area>
      <areaDesc>某河段沿岸</areaDesc>
      <polygon>23.40,120.20 23.50,120.30 23.60,120.40</polygon>
    </area>
  </info>
</alert>`;
    const circleXml = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>circle</identifier>
  <sent>2026-07-06T23:23:47+08:00</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <info>
    <event>火災</event>
    <severity>Severe</severity>
    <headline>火災示警</headline>
    <description>工廠火災。</description>
    <area>
      <areaDesc>廠區周邊</areaDesc>
      <circle>23.45,120.25 5.0</circle>
    </area>
  </info>
</alert>`;

    const polyParsed = parseCapAlert(polyXml);
    expect(polyParsed.lat).toBeCloseTo(23.5, 4);
    expect(polyParsed.lng).toBeCloseTo(120.3, 4);
    const circleParsed = parseCapAlert(circleXml);
    expect(circleParsed.lat).toBeCloseTo(23.45, 4);
    expect(circleParsed.lng).toBeCloseTo(120.25, 4);

    const atomJson = {
      entry: [
        atomEntry({ id: "poly", category: "淹水" }),
        atomEntry({ id: "circle", category: "火災" }),
      ],
    };
    const { events } = buildNcdrEvents(
      atomJson,
      { [hrefFor("poly")]: polyXml, [hrefFor("circle")]: circleXml },
      { now: NOW, fetchedAt: FETCHED_AT },
    );
    const poly = events.find((e) => e.id === "ncdr-poly");
    const circle = events.find((e) => e.id === "ncdr-circle");
    expect(poly).toMatchObject({ lat: 23.5, lng: 120.3, locationPrecision: "district" });
    expect(circle).toMatchObject({ lat: 23.45, lng: 120.25, locationPrecision: "district" });
    expect(validateEventContract(events).invalid).toHaveLength(0);
  });

  const geomXml = (geometry: string) => `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>geom</identifier>
  <sent>2026-07-06T23:23:47+08:00</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <info>
    <event>淹水</event>
    <severity>Severe</severity>
    <headline>淹水示警</headline>
    <description>低窪地區淹水。</description>
    <area>
      <areaDesc>某河段沿岸</areaDesc>
      ${geometry}
    </area>
  </info>
</alert>`;

  it("<circle> 逗號後有空白仍取到經度（'23.45, 120.25 5.0'）", () => {
    const parsed = parseCapAlert(geomXml("<circle>23.45, 120.25 5.0</circle>"));
    expect(parsed.lat).toBeCloseTo(23.45, 4);
    expect(parsed.lng).toBeCloseTo(120.25, 4);
  });

  it("<polygon> 缺值頂點不借用下一個頂點的數字（跨頂點配對）", () => {
    // "23.5," 缺經度 → 整個頂點丟棄；不可把 "23.60" 借來當它的經度。
    const parsed = parseCapAlert(geomXml("<polygon>23.40,120.20 23.5, 23.60,120.40</polygon>"));
    expect(parsed.lat).toBeCloseTo(23.5, 4);
    expect(parsed.lng).toBeCloseTo(120.3, 4);
  });

  it("<circle> 與 polygon 同套正規化：經緯顛倒交換、範圍外丟棄退回文字定位", () => {
    const swapped = parseCapAlert(geomXml("<circle>120.25,23.45 5.0</circle>"));
    expect(swapped.lat).toBeCloseTo(23.45, 4);
    expect(swapped.lng).toBeCloseTo(120.25, 4);

    const oob = parseCapAlert(geomXml("<circle>999,999 5.0</circle>"));
    expect(oob.lat).toBeNull();
    expect(oob.lng).toBeNull();

    // 範圍外圓心 → 無幾何 → 文字定位（此例全文無縣市 → 全國/country，不產 (999,999) district）。
    const atomJson = { entry: [atomEntry({ id: "geom", category: "淹水" })] };
    const { events } = buildNcdrEvents(
      atomJson,
      { [hrefFor("geom")]: geomXml("<circle>999,999 5.0</circle>") },
      { now: NOW, fetchedAt: FETCHED_AT },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ region: "全國", lat: null, lng: null, locationPrecision: "country" });
  });

  it("多個 <area> 時座標與 region 來自同一個有幾何的 area", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>geo-src</identifier>
  <sent>2026-07-06T23:23:47+08:00</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <info>
    <event>火災</event>
    <severity>Severe</severity>
    <headline>火災示警</headline>
    <description>工廠火災。</description>
    <area><areaDesc>嘉義縣東石鄉</areaDesc></area>
    <area><areaDesc>高雄市左營區</areaDesc><circle>22.68,120.30 1.0</circle></area>
  </info>
</alert>`;
    const atomJson = { entry: [atomEntry({ id: "geo-src", category: "火災" })] };
    const { events } = buildNcdrEvents(
      atomJson,
      { [hrefFor("geo-src")]: xml },
      { now: NOW, fetchedAt: FETCHED_AT },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ region: "高雄市", lat: 22.68, lng: 120.3, locationPrecision: "district" });
  });

  it("<polygon> 丟棄畸形頂點、去首尾重複頂點、偵測經緯顛倒", () => {
    // 畸形頂點（"bad"、"23.5,"）丟棄後取平均
    const malformed = parseCapAlert(geomXml("<polygon>23.40,120.20 bad 23.60,120.40 23.5,</polygon>"));
    expect(malformed.lat).toBeCloseTo(23.5, 4);
    expect(malformed.lng).toBeCloseTo(120.3, 4);

    // 閉合環首尾同點 → 去尾點再平均（4 頂點→3 頂點平均）
    const closed = parseCapAlert(geomXml("<polygon>23.0,120.0 23.4,120.4 23.8,120.8 23.0,120.0</polygon>"));
    expect(closed.lat).toBeCloseTo(23.4, 4);
    expect(closed.lng).toBeCloseTo(120.4, 4);

    // 經緯顛倒：平均在台灣範圍外、交換後在範圍內 → 交換
    const swapped = parseCapAlert(geomXml("<polygon>120.20,23.40 120.30,23.50 120.40,23.60</polygon>"));
    expect(swapped.lat).toBeCloseTo(23.5, 4);
    expect(swapped.lng).toBeCloseTo(120.3, 4);
  });

  it("有幾何座標但文字無縣市 → region 取最近縣市中心（不判全國）", () => {
    const xml = geomXml("<polygon>23.95,120.95 24.00,121.00 23.98,121.02</polygon>");
    const atomJson = { entry: [atomEntry({ id: "geom", category: "淹水" })] };
    const { events } = buildNcdrEvents(atomJson, { [hrefFor("geom")]: xml }, { now: NOW, fetchedAt: FETCHED_AT });
    expect(events).toHaveLength(1);
    expect(events[0].region).toBe("南投縣");
    expect(events[0].locationPrecision).toBe("district");
    expect(events[0].lat).toBeCloseTo(23.9767, 3);
    expect(validateEventContract(events).invalid).toHaveLength(0);
  });
});
