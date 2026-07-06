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
});
