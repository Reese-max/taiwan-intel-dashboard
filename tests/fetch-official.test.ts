import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import {
  mapCgaEvents,
  fetchAqi,
  fetchCdcInfluenza,
  fetchMndActivity,
  fetchTfdaNoncompliant,
  mapAqiEvents,
  mapCdcInfluenzaEvent,
  mapMndActivityEvent,
  mapTaipowerSupplyEvent,
  mapTfdaEvents,
  mapTwcertEvents,
  mapWraReservoirEvents,
  parseCdcWeeklyReports,
  parseCgaNewsLinks,
  parseMndActivityLinks,
  parseTwcertRss,
  parseWraReservoirRows,
} from "../scripts/lib/fetch-official.mjs";
import { validateEventContract } from "../scripts/lib/event-contract.mjs";

const FETCHED_AT = "2026-07-16T02:00:00.000Z";

describe("第一波官方來源 mapper", () => {
  it("解析國防部空軍每日臺海動態並映射完整事件", () => {
    const links = parseMndActivityLinks(`
      <a href="/TW/News/News_Detail.aspx?CID=213&amp;ID=59083">
        中共解放軍臺海周邊海、空域動態（115年7月15日） 2026/07/15
      </a>
    `);
    expect(links).toEqual([{
      id: "59083",
      title: "中共解放軍臺海周邊海、空域動態（115年7月15日）",
      date: "2026/07/15",
      url: "https://air.mnd.gov.tw/TW/News/News_Detail.aspx?CID=213&ID=59083",
    }]);

    const event = mapMndActivityEvent({
      ...links[0],
      detailText: "迄0600時止，偵獲共機6架次（進入東部空域1架次）、共艦7艘及公務船3艘，持續在臺海周邊活動。",
    }, { fetchedAt: FETCHED_AT });
    expect(event).toMatchObject({
      category: "國防",
      scope: "domestic",
      region: "臺灣周邊海空域",
      riskLevel: "medium",
      source: { datasetId: "mnd-pla-activity", fetchedAt: FETCHED_AT },
    });
    expect(event.summary).toContain("共機6架次");
    expect(validateEventContract([event]).invalid).toEqual([]);
  });

  it("MND 單篇明細失敗時仍保留其他成功文章", async () => {
    const list = `
      <a href="/TW/News/News_Detail.aspx?CID=213&amp;ID=1">臺海動態一 2026/07/15</a>
      <a href="/TW/News/News_Detail.aspx?CID=213&amp;ID=2">臺海動態二 2026/07/14</a>
    `;
    const fetchImpl = async (url: string) => {
      if (url.includes("News_List")) return new Response(list, { status: 200 });
      if (url.includes("ID=1")) return new Response("暫時失敗", { status: 500 });
      return new Response("迄今日0600時止，偵獲共機1架、共艦5艘次，持續在臺海周邊活動。", { status: 200 });
    };
    const events = await fetchMndActivity({ limit: 2, fetchImpl });
    expect(events).toHaveLength(1);
    expect(events[0].summary).toContain("共機1架");
    expect(events[0].riskLevel).toBe("medium");
  });

  it("把 CDC 最新兩週類流感急診資料彙成一筆全國趨勢", () => {
    const rows = [
      { 年: "2026", 週: "26", 年齡別: "0-4", 縣市: "臺北市", 類流感急診就診人次: "100" },
      { 年: "2026", 週: "26", 年齡別: "0-4", 縣市: "新北市", 類流感急診就診人次: "100" },
      { 年: "2026", 週: "27", 年齡別: "0-4", 縣市: "臺北市", 類流感急診就診人次: "130" },
      { 年: "2026", 週: "27", 年齡別: "0-4", 縣市: "新北市", 類流感急診就診人次: "130" },
    ];
    const event = mapCdcInfluenzaEvent(rows, { fetchedAt: FETCHED_AT });
    expect(event).toMatchObject({
      category: "衛生",
      region: "全國",
      riskLevel: "medium",
      source: { datasetId: "cdc-rods-influenza", cadence: "daily", maxAgeHours: 48 },
    });
    expect(event.summary).toContain("260");
    expect(event.summary).toContain("30%");
    expect(validateEventContract([event]).invalid).toEqual([]);
  });

  it("CDC 官方端暫時性連線失敗時有限重試，成功後仍通過契約", async () => {
    const rows = [
      { 年: "2026", 週: "26", 類流感急診就診人次: "100" },
      { 年: "2026", 週: "27", 類流感急診就診人次: "120" },
    ];
    let attempts = 0;
    const fetchImpl = async () => {
      attempts += 1;
      if (attempts === 1) {
        const cause = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
        throw new TypeError("fetch failed", { cause });
      }
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const events = await fetchCdcInfluenza({ fetchImpl, retryDelayMs: 0 });
    expect(attempts).toBe(2);
    expect(events).toHaveLength(1);
    expect(validateEventContract(events).invalid).toEqual([]);
  });

  it("RODS 主機持續連線失敗時改用 CDC 官方疫情監測週報，且不冒充就診數", async () => {
    const weeklyHtml = `
      <table><tbody><tr>
        <td headers="weeks">27</td>
        <td headers="date">2026/7/5-2026/7/11</td>
        <td headers="link"><a href="/File/Get/report-27">例行記者會疫情監測週報_2026年第27週.pdf</a></td>
      </tr></tbody></table>
    `;
    expect(parseCdcWeeklyReports(weeklyHtml)).toEqual([{
      year: 2026,
      week: 27,
      dateRange: "2026/7/5-2026/7/11",
      url: "https://www.cdc.gov.tw/File/Get/report-27",
      title: "例行記者會疫情監測週報_2026年第27週.pdf",
    }]);

    let rodsAttempts = 0;
    const fetchImpl = async (url: string) => {
      if (url.includes("od.cdc.gov.tw")) {
        rodsAttempts += 1;
        const cause = Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" });
        throw new TypeError("fetch failed", { cause });
      }
      return new Response(weeklyHtml, { status: 200, headers: { "content-type": "text/html" } });
    };

    const events = await fetchCdcInfluenza({ fetchImpl, retryDelayMs: 0 });
    expect(rodsAttempts).toBe(3);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      category: "衛生",
      region: "全國",
      riskLevel: "low",
      source: {
        datasetId: "cdc-weekly-surveillance-report",
        fallbackFrom: "cdc-rods-influenza",
        url: "https://www.cdc.gov.tw/File/Get/report-27",
      },
    });
    expect(events[0].summary).not.toMatch(/就診人次\s*\d/);
    expect(validateEventContract(events).invalid).toEqual([]);
  });

  it("只收 TFDA 最近期間的不合格食品邊境查驗", () => {
    const events = mapTfdaEvents([
      { 產地: "日本", 主旨: "冷凍草莓", 原因: "農藥殘留不符規定", 進口商名稱: "甲公司", 處置情形: "退運或銷毀", 發布日期: "2026/07/14", 附圖: "https://example.test/a" },
      { 產地: "美國", 主旨: "舊資料", 原因: "不符規定", 進口商名稱: "乙公司", 處置情形: "退運", 發布日期: "2025/01/01" },
    ], { fetchedAt: FETCHED_AT, now: Date.parse(FETCHED_AT), retentionDays: 30 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      category: "食安",
      region: "全國",
      riskLevel: "medium",
      source: { datasetId: "tfda-noncompliant-food" },
    });
    expect(events[0].summary).toContain("日本");
    expect(validateEventContract(events).invalid).toEqual([]);
  });

  it("TFDA 回應 schema 漂移時拒絕標成成功 0 筆", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: "changed" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    await expect(fetchTfdaNoncompliant({ fetchImpl })).rejects.toThrow("TFDA 回應不是有效資料列陣列");
  });

  it("AQI 每縣市只留最高且超過 100 的測站，依官方狀態映射風險", () => {
    const events = mapAqiEvents({ records: [
      { county: "臺北市", sitename: "士林", aqi: "98", status: "普通", datacreationdate: "2026-07-16 10:00" },
      { county: "高雄市", sitename: "左營", aqi: "156", status: "對所有族群不健康", datacreationdate: "2026-07-16 10:00", latitude: "22.674", longitude: "120.292" },
      { county: "高雄市", sitename: "楠梓", aqi: "125", status: "對敏感族群不健康", datacreationdate: "2026-07-16 10:00" },
    ] }, { fetchedAt: FETCHED_AT });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      category: "環境",
      region: "高雄市",
      riskLevel: "high",
      lat: 22.674,
      lng: 120.292,
      locationPrecision: "exact",
      source: { datasetId: "moenv-aqi-hourly" },
    });
    expect(validateEventContract(events).invalid).toEqual([]);
  });

  it("AQI 空白官方座標回退縣市中心，缺 key 直接回報設定錯誤", async () => {
    const events = mapAqiEvents({ records: [
      { county: "臺北市", sitename: "士林", aqi: "120", status: "對敏感族群不健康", latitude: "", longitude: "", datacreationdate: "2026-07-16 10:00" },
    ] }, { fetchedAt: FETCHED_AT });
    expect(events[0]).toMatchObject({ lat: 25.0375, lng: 121.5637, locationPrecision: "county-center" });
    await expect(fetchAqi({ apiKey: "" })).rejects.toThrow("MOENV_API_KEY 未設定");
  });

  it("第二波四個官方來源皆映射為可驗證事件，且排除水庫計畫性空庫", () => {
    const cga = mapCgaEvents(parseCgaNewsLinks(`
      <a href="ct?xItem=168424&amp;ctNode=650&amp;mp=999">
        115/07/14 颱風甫過中國海警隨即襲擾金門 海巡強勢驅離
      </a>
    `), { fetchedAt: FETCHED_AT, now: Date.parse(FETCHED_AT) });
    const twcert = mapTwcertEvents(parseTwcertRss(`
      <item><title><![CDATA[範例系統 - SQL Injection]]></title>
      <link>https://www.twcert.org.tw/tw/cp-132-11035-test-1.html</link>
      <pubDate>Wed, 15 Jul 2026 07:11:00 GMT</pubDate></item>
    `), { fetchedAt: FETCHED_AT, now: Date.parse(FETCHED_AT) });
    const taipower = mapTaipowerSupplyEvent({ records: [
      { curr_load: "3727.4", curr_util_rate: "74" },
      { fore_peak_dema_load: "4050.0", fore_peak_resv_capacity: "324", fore_peak_resv_rate: "8.0", fore_peak_resv_indicator: "Y", publish_time: "115.07.16(四)09:20" },
    ] }, { fetchedAt: FETCHED_AT });
    const wra = mapWraReservoirEvents(parseWraReservoirRows(`
      <table><tr><th>水庫</th><th>有效蓄水量</th><th>水位</th><th>蓄水率</th><th>記錄時間</th></tr>
      <tr><td>石門水庫</td><td>5000</td><td>220</td><td>25%</td><td>115-07-16 09:00</td></tr>
      <tr><td>阿公店水庫 每年6/1至9/10為空庫防淤期不蓄水</td><td>64</td><td>30.47</td><td>4.32%</td><td>115-07-16 08:00</td></tr></table>
    `), { fetchedAt: FETCHED_AT });

    expect(cga[0]).toMatchObject({ category: "海事", region: "金門縣", source: { datasetId: "cga-maritime-news" } });
    expect(twcert[0]).toMatchObject({ category: "資安", region: "全國", source: { datasetId: "twcert-tvn-rss" } });
    expect(taipower).toMatchObject({
      category: "能源",
      timestamp: "2026-07-16T01:20:00.000Z",
      riskLevel: "high",
      source: { datasetId: "taipower-supply-demand" },
    });
    expect(wra).toHaveLength(1);
    expect(wra[0]).toMatchObject({ category: "水情", region: "桃園市", source: { datasetId: "wra-reservoir-levels" } });
    expect(validateEventContract([...cga, ...twcert, taipower, ...wra]).invalid).toEqual([]);
  });
});
