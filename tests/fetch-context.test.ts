import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import {
  mapEducationSnapshotEvent,
  mapAgriculturePriceEvent,
  mapEconomicIndicatorEvent,
  mapFinanceDerivativesEvent,
  mapFireStatisticsEvent,
  mapHealthcareFacilityEvent,
  mapLegislatureBillsEvent,
  mapLaborStatisticsEvent,
  mapMoenvAirQualityEvents,
  mapParkingSummaryEvent,
  mapSocialPopulationEvent,
  mapTourismSnapshotEvent,
  PARKING_SOURCE_PROFILES,
} from "../scripts/lib/fetch-official.mjs";

describe("補充領域官方資料 mapper", () => {
  it("把環境部逐站逐污染物小時值彙整成可定位空品事件", () => {
    const payload = {
      columns: ["siteid", "sitename", "itemengname", "monitordate", "monitorvalue22", "monitorvalue23"],
      rows: [
        ["140", "林森", "PM2.5", "2026-07-24", "42", "55"],
        ["140", "林森", "O3", "2026-07-24", "80", "91"],
      ],
    };
    const stations = [{ attributes: { Stcode: 140, SiteName: "林森", County: "臺北市", TWD97_Lon: 121.532, TWD97_Lat: 25.047 } }];

    const events = mapMoenvAirQualityEvents(payload, stations, { fetchedAt: "2026-07-25T00:00:00.000Z" });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      category: "環境",
      region: "臺北市",
      lat: 25.047,
      lng: 121.532,
      timestamp: "2026-07-24T15:00:00.000Z",
      source: { datasetId: "28178", latestDataDate: "2026-07-24" },
    });
    expect(events[0].summary).toContain("PM2.5 55");
  });

  it("把停車剩餘量彙整成城市交通供給事件", () => {
    const profile = PARKING_SOURCE_PROFILES.hsinchu;
    const events = mapParkingSummaryEvent(
      [
        { PARKINGNAME: "甲停車場", FREEQUANTITY: "2", TOTALQUANTITY: "100", UPDATETIME: "2026-07-24T10:00:00" },
        { PARKINGNAME: "乙停車場", FREEQUANTITY: "3", TOTALQUANTITY: "100", UPDATETIME: "2026-07-24T10:01:00" },
      ],
      profile,
      { fetchedAt: "2026-07-25T00:00:00.000Z" },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      category: "交通",
      region: "新竹市",
      timestamp: "2026-07-24T02:01:00.000Z",
      riskLevel: "high",
      source: { datasetId: "129136", latestDataDate: "2026-07-24T10:01:00" },
    });
    expect(events[0].summary).toContain("5／200");
  });

  it("保留經濟指標資料月份，避免把抓取時間誤當資料時間", () => {
    const payload = {
      columns: ["日期（月別）", "經濟成長率", "失業率（百分比）", "消費者物價-年增率", "工業及服務業平均月薪資（元）"],
      rows: [["202605", "…", "3.27", "2.20", "…"]],
    };

    const event = mapEconomicIndicatorEvent(payload, { fetchedAt: "2026-07-25T00:00:00.000Z" });

    expect(event).toMatchObject({
      category: "經濟",
      region: "全國",
      timestamp: "2026-05-31T15:59:59.000Z",
      source: { datasetId: "13228", latestDataDate: "2026-05" },
    });
    expect(event.summary).toContain("失業率 3.27%");
  });

  it("把農產品價格保留最新資料日，且不推導交易風險", () => {
    const event = mapAgriculturePriceEvent({
      columns: ["AVGPRICE", "PRODUCTNAME", "ORGNAME", "YEAR", "MONTH", "PERIOD"],
      rows: [
        ["20", "青香蕉", "當日平均價", "2026", "07", "23"],
        ["80.42", "芒果", "當日平均價", "2026", "07", "24"],
      ],
    }, { fetchedAt: "2026-07-25T00:00:00.000Z" });

    expect(event).toMatchObject({
      category: "農業",
      region: "全國",
      timestamp: "2026-07-23T16:00:00.000Z",
      source: { datasetId: "70930", latestDataDate: "2026-07-24" },
    });
    expect(event.summary).toContain("芒果 80.42 元");
    expect(event.riskBasis).toContain("不由單一品項價格推導");
  });

  it("把健保院所數量放在衛生參考層，不灌入事件統計", () => {
    const event = mapHealthcareFacilityEvent({ columns: ["n"], rows: [[5102]] }, {
      fetchedAt: "2026-07-25T00:00:00.000Z",
    });

    expect(event).toMatchObject({
      category: "衛生",
      region: "全國",
      timestamp: "2026-07-25T00:00:00.000Z",
      source: { datasetId: "39331", retentionPolicy: "reference" },
    });
    expect(event.summary).toContain("5102 家");
  });

  it("把地方消防期間統計標成參考層並保留統計期間", () => {
    const event = mapFireStatisticsEvent({
      columns: ["統計期間", "行政區", "受理火災統計數值", "受理救護統計數值", "總計"],
      rows: [
        ["115年1-4月", "中正區", "12", "300", "350"],
        ["115年1-4月", "信義區", "8", "280", "320"],
      ],
    }, { fetchedAt: "2026-07-25T00:00:00.000Z" });

    expect(event).toMatchObject({
      category: "消防",
      region: "臺北市",
      timestamp: "2026-04-29T16:00:00.000Z",
      source: { datasetId: "134922", latestDataDate: "115年1-4月", retentionPolicy: "reference" },
    });
    expect(event.summary).toContain("火災 20 件");
  });

  it("把立法院議案進度彙整為國會參考快照", () => {
    const event = mapLegislatureBillsEvent({
      columns: ["議案編號", "議案名稱", "最新進度日期", "議案狀態"],
      rows: [
        ["A1", "教育法案", "2026-07-20", "排入院會"],
        ["A2", "預算案", "2026-07-21", "審查中"],
        ["A3", "附件欄位位移", "2026-07-21", "HTML結果 https://example.test/bill/html"],
      ],
    }, { fetchedAt: "2026-07-25T00:00:00.000Z" });

    expect(event).toMatchObject({
      category: "國會",
      region: "全國",
      timestamp: "2026-07-21T00:00:00.000Z",
      source: { datasetId: "ly-bills", latestDataDate: "2026-07-21", retentionPolicy: "reference" },
    });
    expect(event.summary).toContain("3 筆議案");
    expect(event.summary).not.toContain("HTML結果");
  });

  it("把觀光署五大客源群彙整為觀光參考快照", () => {
    const event = mapTourismSnapshotEvent({
      columns: ["name", "value"],
      rows: [["日本", "100"], ["其他", "25"]],
    }, { fetchedAt: "2026-07-25T00:00:00.000Z" });

    expect(event).toMatchObject({
      category: "觀光",
      region: "全國",
      timestamp: "2026-07-25T00:00:00.000Z",
      source: { datasetId: "tad-index-inbound-lastmonth", retentionPolicy: "reference" },
    });
    expect(event.summary).toContain("合計 125");
  });

  it("把臺中市人口結構彙整為地方社福參考快照", () => {
    const event = mapSocialPopulationEvent({
      columns: ["區別", "里別", "性別", "0-4歲合計數量", "5-9歲合計數量", "100歲以上數量"],
      rows: [["中區", "大誠里", "計", "10", "20", "1"], ["中區", "大誠里", "男", "5", "10", "0"]],
    }, { fetchedAt: "2026-07-25T00:00:00.000Z" });

    expect(event).toMatchObject({
      category: "社福",
      region: "臺中市",
      timestamp: "2026-07-25T00:00:00.000Z",
      source: { datasetId: "84049", retentionPolicy: "reference" },
    });
    expect(event.summary).toContain("31 人口");
  });

  it("保留新北市教育年度資料的最新年度並標成參考層", () => {
    const event = mapEducationSnapshotEvent({
      columns: ["field1", "field2", "item value3", "item value16"],
      rows: [["2024", " 總計", "60", "97119"], ["2025", " 總計", "61", "98000"]],
    }, { fetchedAt: "2026-07-25T00:00:00.000Z" });

    expect(event).toMatchObject({
      category: "教育",
      region: "新北市",
      timestamp: "2025-12-31T15:59:59.000Z",
      source: { datasetId: "124173", latestDataDate: "2025", retentionPolicy: "reference" },
    });
    expect(event.summary).toContain("學生 98000");
  });

  it("把期貨三大法人每日選擇權統計標成金融參考層", () => {
    const event = mapFinanceDerivativesEvent({
      columns: ["日期", "商品名稱", "身份別", "多空未平倉契約金額淨額(千元)"],
      rows: [
        ["20260629", "臺指選擇權", "外資", "100"],
        ["20260630", "臺指選擇權", "外資", "120"],
        ["20260630", "電子選擇權", "自營商", "-20"],
      ],
    }, { fetchedAt: "2026-07-25T00:00:00.000Z" });

    expect(event).toMatchObject({
      category: "金融",
      region: "全國",
      timestamp: "2026-06-29T16:00:00.000Z",
      source: { datasetId: "11598", latestDataDate: "2026-06-30", retentionPolicy: "reference" },
    });
    expect(event.summary).toContain("涵蓋 2 類選擇權商品");
    expect(event.riskBasis).toContain("不產生買賣訊號");
  });

  it("把新北市失業率年度統計標成勞動參考層", () => {
    const event = mapLaborStatisticsEvent({
      columns: ["field1", "item value2", "item value3", "item value4", "item value5", "item value6", "item value7"],
      rows: [
        ["2023", "3.1", "3.0", "2.1", "2.2", "4.0", "4.1"],
        ["2024", "3.2", "3.3", "2.2", "2.3", "4.2", "4.3"],
      ],
    }, { fetchedAt: "2026-07-25T00:00:00.000Z" });

    expect(event).toMatchObject({
      category: "勞動",
      region: "新北市",
      timestamp: "2024-12-31T15:59:59.000Z",
      source: { datasetId: "123349", latestDataDate: "2024", retentionPolicy: "reference" },
    });
    expect(event.summary).toContain("未婚男 3.2%");
  });
});
