import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { detectCounty, detectCountyInBody, mapBulkNews } from "../scripts/lib/news-bulk.mjs";
import { applyDomesticCountyLocation } from "../scripts/lib/nvidia.mjs";
import { buildNcdrEvents, fetchNcdrAlerts, parseCapAlert } from "../scripts/lib/fetch-ncdr.mjs";
import { carryOver } from "../scripts/lib/carry-over.mjs";
import { createSourcePlan } from "../scripts/lib/source-plan.mjs";
import { fetchDirectOfficialSources } from "../scripts/lib/direct-official-sources.mjs";
import { mapFinanceDerivativesEvent, mapSocialPopulationEvent, mapEconomicIndicatorEvent, mapEducationSnapshotEvent, mapLaborStatisticsEvent, fetchHealthcareFacilities, mapParkingSummaryEvent, PARKING_SOURCE_PROFILES } from "../scripts/lib/fetch-official.mjs";

const date = "2026-11-04T00:00:00.000Z";
const news = (title: string, description = "警方調查") => ({ title, description, link: "https://example.test/news", source: "測試", hint: "治安", pubDate: date });
const entry = { id: "flood", category: { "@term": "淹水" }, link: { "@href": "https://example.test/flood.cap" } };
const cap = "<alert><identifier>flood</identifier><info><event>淹水</event><headline>淹水示警</headline><area><areaDesc>嘉義縣東石鄉</areaDesc></area></info></alert>";
const previous = [{ id: "previous", source: { datasetId: "ncdr-cap-alert", fetchedAt: date } }];

describe("Devin 資料管線回歸", () => {
  it.each([
    ["台17線嘉義東石路段貨車疑超載翻車", "嘉義縣"],
    ["兩人失聯！新竹湖口工廠火警延燒逾8小時", "新竹縣"],
    ["每票千元現金買票 新竹峨眉村長候選人遭訴", "新竹縣"],
    ["嘉義民雄9路段新增測速", "嘉義縣"],
    ["嘉義縣東石鄉車禍", "嘉義縣"],
  ])("D1 縣轄鄉鎮短名：%s", (title, region) => {
    expect(detectCounty(title).region).toBe(region);
    expect(mapBulkNews([news(title)])[0].region).toBe(region);
    expect(applyDomesticCountyLocation({ title, region: "全國" }).region).toBe(region);
  });

  it.each([
    ["新竹", "竹北 竹東 新埔 關西 湖口 新豐 芎林 橫山 北埔 寶山 峨眉 尖石 五峰", "新竹縣"],
    ["嘉義", "太保 朴子 布袋 大林 民雄 溪口 新港 六腳 東石 義竹 鹿草 水上 中埔 竹崎 梅山 番路 大埔 阿里山", "嘉義縣"],
  ])("D1 %s 全部縣轄鄉鎮", (short, towns, region) => {
    for (const town of towns.split(" ")) expect(detectCounty(short + town + "發生車禍").region).toBe(region);
  });

  it("D1 短名標題由摘要縣全名修正，LLM 短名與原文路徑一致", () => {
    const title = "AI換臉惡劣狼師！嘉義國小游泳教練遭起訴";
    const summary = "三十八歲嘉義縣某國小游泳教練涉案。";
    expect(mapBulkNews([news(title, summary)])[0].region).toBe("嘉義縣");
    expect(applyDomesticCountyLocation({ title, summary, region: "嘉義" }).region).toBe("嘉義縣");
    expect(applyDomesticCountyLocation({ title: "教練涉案", region: "嘉義" }, summary).region).toBe("嘉義縣");
    expect(applyDomesticCountyLocation({ title: "新竹車禍", region: "新竹" }, "新竹縣湖口鄉車禍").region).toBe("新竹縣");
  });

  it.each(["新竹市", "竹市", "嘉義市", "嘉市"])("D1 明確市名 %s 不被改判縣", (city) => {
    const expected = /新竹|竹市/.test(city) ? "新竹市" : "嘉義市";
    const summary = "新竹縣湖口與嘉義縣東石警方支援。";
    expect(mapBulkNews([news(city + "發生車禍", summary)])[0].region).toBe(expected);
    expect(applyDomesticCountyLocation({ title: city + "發生車禍", summary, region: "全國" }).region).toBe(expected);
    expect(applyDomesticCountyLocation({ title: "車禍", summary, region: city }).region).toBe(expected);
  });

  it("D1 無縣證據維持市，其他縣市取最早位置", () => {
    expect(detectCounty("新竹火警").region).toBe("新竹市");
    expect(detectCounty("嘉義車禍").region).toBe("嘉義市");
    expect(detectCounty("新北車禍 臺北市警方支援").region).toBe("新北市");
  });

  it.each([
    ["嘉義湖美夜市發生事故，台北民眾專程南下", "嘉義市"],
    ["北市文山二警聯合新北警查獲偷車賊", "臺北市"],
    ["自基隆正濱漁港偷渡，台北地檢署指揮", "基隆市"],
    ["嘉義縣東石鄉車禍，臺北市警方支援", "嘉義縣"],
    ["新竹縣湖口火警，桃園消防支援", "新竹縣"],
  ])("D3 標題取最早縣市，同位置全名優先：%s", (title, region) => {
    expect(detectCounty(title).region).toBe(region);
    expect(mapBulkNews([news(title)])[0].region).toBe(region);
    expect(applyDomesticCountyLocation({ title, region: "全國" }).region).toBe(region);
  });

  it.each(["路", "街", "大道", "巷"])("V2 鄉鎮名接%s 不作縣證據", (suffix) => {
    expect(detectCounty(`新竹寶山${suffix}車禍`).region).toBe("新竹市");
    expect(detectCounty(`寶山${suffix}車禍由新竹警方處理`).region).toBe("新竹市");
    expect(detectCounty(`嘉義民雄${suffix}車禍`).region).toBe("嘉義市");
    expect(detectCountyInBody(`新竹寶山${suffix}車禍，竹市警方調查。`).region).toBe("新竹市");
  });

  it("V2 縣轄鄉鎮仍可省略鄉字", () => {
    expect(detectCounty("新竹寶山車禍").region).toBe("新竹縣");
    expect(detectCounty("寶山發生事故新竹警方處理").region).toBe("新竹縣");
    expect(detectCounty("嘉義水上摩托車意外").region).toBe("嘉義縣");
  });

  it.each([
    ["新竹湖口工廠大火延燒逾8小時，竹市消防隊馳援。", "新竹縣"],
    ["嘉義民雄工廠大火，嘉市消防隊馳援。", "嘉義縣"],
    ["湖口工廠位於新竹，竹市消防隊馳援。", "新竹縣"],
    ["新竹市東區火警，湖口與竹市消防隊支援。", "新竹市"],
    ["竹市消防隊到新竹湖口支援。", "新竹市"],
    ["新竹發生火警，另一案新竹湖口工廠事故。", "新竹市"],
  ])("V3 本文以第一處事發地判定，後段支援或另一案不覆蓋：%s", (body, region) => {
    expect(detectCountyInBody(body).region).toBe(region);
  });

  it("V1 新竹產業園區（湖口／新豐）判新竹縣；明確新竹市維持市", () => {
    expect(detectCountyInBody("新竹產業園區4日凌晨驚傳重大爆炸火警！位於湖口鄉光復路").region).toBe("新竹縣");
    expect(detectCountyInBody("位於新竹產業園區的台灣松下，湖口現在外面超恐怖").region).toBe("新竹縣");
    expect(detectCountyInBody("新竹市東區說明竹市工業區活化").region).toBe("新竹市");
  });

  it("V4 中段「中央社記者…日電」署名剝除，一般括號保留", () => {
    expect(detectCountyInBody("編按（中央社記者王明台北4日電）台中市警方查獲詐團。").region).toBe("臺中市");
    expect(detectCountyInBody("編按（台北市電訊業者說明）台中市警方調查。").region).toBe("臺北市");
  });

  it("D2 編按後署名剝除（Devin 原始案例）", () => {
    expect(detectCountyInBody("太可惡！… 〔記者丁偉杰、蔡宗勳／嘉義報導〕三十八歲嘉義縣某國小…").region).toBe("嘉義縣");
  });

  it.each([["〔", "〕"], ["【", "】"], ["［", "］"], ["（", "）"], ["[", "]"], ["(", ")"]])("D2 中段署名 %s%s 逐一剝除，不刪一般括號", (open, close) => {
    expect(detectCountyInBody("編按 " + open + "記者王明／台北報導" + close + "前言 " + open + "中央社／新北報導" + close + "台中市警方查獲詐團。").region).toBe("臺中市");
    expect(detectCountyInBody("編按 " + open + "台北市通訊設備起火" + close + "台中市警方調查。").region).toBe("臺北市");
    expect(detectCountyInBody("編按 " + open + "台北市警方依記者報導調查" + close + "台中市警方支援。").region).toBe("臺北市");
  });

  it.each([{ entry: [] }, { entry: [entry] }])("D4 空 feed 或全明細失敗會 throw，carryOver 保留舊事件", (atom) => {
    let status;
    try { buildNcdrEvents(atom, {}, { now: date }); status = { ok: true }; }
    catch (error) { status = { ok: false, error: String(error) }; }
    expect(status.ok).toBe(false);
    expect(carryOver({ status, fresh: [], oldEvents: previous, match: "ncdr-cap-alert" })).toEqual(previous);
  });

  it("D4 fetch-live 的 NCDR catch 與 carryOver 串接保留舊快照", () => {
    const source = readFileSync(new URL("../scripts/fetch-live.mjs", import.meta.url), "utf8");
    expect(source).toMatch(/status\.ncdr = \{ ok: false, error: e\.message \}/);
    expect(source).toMatch(/carryOver\(\{ status: status\.ncdr, fresh: ncdr, dropStale, oldEvents: oldDomestic, match: NCDR_DATASET_ID \}\)/);
  });

  it.each([{ entry: [] }, { entry: [entry] }])("D4 fetchNcdrAlerts 空 feed／明細全失敗標失敗並保留舊資料", async (atom) => {
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => String(url).endsWith(".cap")
      ? new Response("unavailable", { status: 503 }) : new Response(JSON.stringify(atom));
    try {
      let status;
      let fresh = [];
      try { const result = await fetchNcdrAlerts(); fresh = result.events; status = { ok: true, ...result.status }; }
      catch (error) { status = { ok: false, error: String(error) }; }
      expect(status.ok).toBe(false);
      const { dropStale } = createSourcePlan({ argv: ["node", "fetch-live.mjs", "--exclusive", "--sources=ncdr"], env: {} });
      expect(carryOver({ status, fresh, dropStale, oldEvents: previous, match: "ncdr-cap-alert" })).toEqual(previous);
    }
    finally { globalThis.fetch = original; }
  });

  it.each([[{ "@term": "淹水" }], [{ "@term": "地震" }, { "@term": "淹水" }, { term: "火災" }]])("D5 category 陣列逐項找白名單，單筆事件不重複：%j", (...category) => {
    const atom = { entry: [{ ...entry, category }] };
    const result = buildNcdrEvents(atom, { [entry.link["@href"]]: cap });
    expect(result.events).toHaveLength(1);
    expect(result.status).toMatchObject({ raw: 1, whitelisted: 1, kept: 1, byCategory: { 淹水: 1 } });
    expect(result.status.excludedCategory).not.toHaveProperty("[object Object]");
    expect(buildNcdrEvents({ entry: [{ ...entry, category: [{ "@term": "地震" }, { term: "停水" }] }] }, {}).status.excludedCategory).toEqual({ 地震: 1, 停水: 1 });
  });

  it("D6 跨 info 找第一個有效幾何，事件文字與座標取自同一 info", () => {
    const xml = `<alert><identifier>multi-info</identifier>
      <info><headline>台北文字示警</headline><area><areaDesc>臺北市</areaDesc><circle>999,999 1</circle></area></info>
      <info><headline>嘉義淹水示警</headline><severity>Severe</severity>
        <area><areaDesc>嘉義市</areaDesc></area>
        <area><areaDesc>嘉義縣東石鄉</areaDesc><circle>23.45,120.25 1</circle></area></info>
      <info><headline>高雄示警</headline><area><areaDesc>高雄市</areaDesc><circle>22.62,120.30 1</circle></area></info>
    </alert>`;
    expect(parseCapAlert(xml)).toMatchObject({ headline: "嘉義淹水示警", geometryAreaDesc: "嘉義縣東石鄉", lat: 23.45, lng: 120.25 });
    const result = buildNcdrEvents({ entry: [entry] }, { [entry.link["@href"]]: xml }, { now: date });
    expect(result.events[0]).toMatchObject({ title: "嘉義淹水示警", region: "嘉義縣", lat: 23.45, lng: 120.25, riskLevel: "high", locationPrecision: "district" });
  });

  it("D6 所有 info 都沒有幾何時沿用第一個 info 的文字定位", () => {
    const xml = cap.replace("</alert>", "<info><headline>臺北市示警</headline><area><areaDesc>臺北市</areaDesc></area></info></alert>");
    expect(parseCapAlert(xml)).toMatchObject({ headline: "淹水示警", areaDesc: "嘉義縣東石鄉", lat: null, lng: null });
  });

  it("V6 無白名單是正常空結果，warning 隨 status 進入 provenance", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ entry: [{ ...entry, category: { "@term": "地震" } }] }));
    try {
      const result = await fetchNcdrAlerts({ now: Date.parse(date) });
      expect(result.events).toEqual([]);
      expect(result.status).toMatchObject({ raw: 1, whitelisted: 0, kept: 0, warning: expect.stringContaining("沒有任何白名單類別") });
      const source = readFileSync(new URL("../scripts/fetch-live.mjs", import.meta.url), "utf8");
      expect(source).toMatch(/status\.ncdr = \{ ok: true, \.\.\.result\.status \}/);
      expect(source).toMatch(/writeJson\("provenance\.json", \{[\s\S]*?pipeline: status,/);
    } finally { globalThis.fetch = original; }
    expect(buildNcdrEvents({ entry: [entry] }, { [entry.link["@href"]]: cap }).status).not.toHaveProperty("warning");
  });

  it("D8 院所數只計醫事機構代碼非空的列", async () => {
    const csv = "醫事機構名稱,醫事機構代碼\n甲院所,001\n備註,\n小計,   \n乙院所,002\n";
    const [event] = await fetchHealthcareFacilities({ fetchImpl: async () => new Response(csv) });
    expect(event.summary).toContain("2 家");
    expect(event.source.recordRef).toBe("facility-count|2");
  });

  it.each(Object.values(PARKING_SOURCE_PROFILES))("停車 source 只保留對外欄位：$datasetId", (profile) => {
    const [event] = mapParkingSummaryEvent([{ [profile.free]: "3", [profile.total]: "10", ...(profile.updated ? { [profile.updated]: "2026-11-04T08:00:00" } : {}) }], profile, { fetchedAt: date });
    const source = JSON.parse(JSON.stringify(event)).source;
    expect(source).toMatchObject({ name: profile.name, datasetId: profile.datasetId, url: profile.url, query: profile.query, license: profile.license, cadence: profile.cadence, maxAgeHours: profile.maxAgeHours });
    expect(Object.keys(source).sort()).toEqual([
      "name", "datasetId", "url", "query", "license", "cadence", "maxAgeHours", "type", "scope", "category", "fetchedAt", "recordRef", "retentionPolicy",
      ...(profile.updated ? ["latestDataDate"] : []),
    ].sort());
  });

  const invalid = [
    { key: "financeDerivatives", map: mapFinanceDerivativesEvent, payload: { columns: ["日期", "貨品", "淨額"], rows: [["20261103", "TXO", "999"]] } },
    { key: "socialPopulation", map: mapSocialPopulationEvent, payload: { columns: ["區別", "里別", "男女", "0-4歲合計數量"], rows: [["中區", "光復里", "計", "10"]] } },
    { key: "economy", map: mapEconomicIndicatorEvent, payload: { columns: ["日期（月別）", "新指標"], rows: [["202610", "999"]] } },
    { key: "education", map: mapEducationSnapshotEvent, payload: { columns: ["field1", "field2", "新指標"], rows: [["2025", "總計", "999"]] } },
    { key: "laborStats", map: mapLaborStatisticsEvent, payload: { columns: ["field1", "新指標"], rows: [["2025", "999"]] } },
  ];
  it.each(invalid)("D7 $key 欄位改名 throw，registry 標失敗並沿用舊資料", async ({ key, map, payload }) => {
    expect(() => map(payload)).toThrow();
    const result = await fetchDirectOfficialSources({ wants: () => true, sources: { [key]: { label: key, fetch: async () => [map(payload)] } }, logger: { log() {}, error() {} } });
    expect(result.statusByKey[key]).toMatchObject({ ok: false });
    const old = [{ id: "previous-" + key, source: { datasetId: key, fetchedAt: date } }];
    expect(carryOver({ status: result.statusByKey[key], fresh: result.freshByKey[key], oldEvents: old, match: key })).toEqual(old);
  });

  it("D7 金融缺商品或缺金額各自失敗，但有效零淨額可保留", () => {
    expect(() => mapFinanceDerivativesEvent({ columns: ["日期", "商品名稱", "淨額"], rows: [["20261103", "TXO", "999"]] })).toThrow();
    expect(() => mapFinanceDerivativesEvent({ columns: ["日期", "貨品", "多空未平倉契約金額淨額(千元)"], rows: [["20261103", "TXO", "999"]] })).toThrow();
    const result = mapFinanceDerivativesEvent({ columns: ["日期", "商品名稱", "多空未平倉契約金額淨額(千元)"], rows: [["20261103", "TXO", "100"], ["20261103", "TXO", "-100"]] });
    expect(result.summary).toContain("合計 0 千元");
  });

  it("D7 人口沒有有效年齡指標或合計為零時失敗", () => {
    expect(() => mapSocialPopulationEvent({ columns: ["區別", "性別", "人口"], rows: [["中區", "計", "999"]] })).toThrow();
    expect(() => mapSocialPopulationEvent({ columns: ["區別", "性別", "0-4歲合計數量"], rows: [["中區", "計", "0"]] })).toThrow();
  });
});
