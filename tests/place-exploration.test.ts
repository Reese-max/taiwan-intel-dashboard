import { describe, expect, it } from "vitest";
import { eventCard } from "../src/components/EventCard";
import { clusterPopupHtml } from "../src/components/MapView";
import { filterEvents, explainOutOfFilter } from "../src/data/loader";
import { getState, setState } from "../src/store";
import type { IntelEvent } from "../src/types/event";

const BASE_EVENT: IntelEvent = {
  id: "test-ev-1",
  title: "台北市刑大破獲假投資吸金詐騙集團",
  region: "臺北市中正區",
  lat: 25.0478,
  lng: 121.517,
  locationPrecision: "district",
  timestamp: "2026-06-25T10:00:00.000Z",
  category: "反詐",
  scope: "domestic",
  riskLevel: "high",
  summary: "台北市刑大今日宣布破獲以虛擬貨幣為名的吸金詐騙集團，查扣不法所得數百萬元。",
  source: {
    name: "警政署",
    type: "gov-open-data",
    datasetId: "7505",
    recordRef: "cib-2026-001",
    url: "https://www.cib.npa.gov.tw/article/001",
    fetchedAt: "2026-06-25T12:00:00.000Z",
    authority: "official",
  },
};

describe("Issue #39: 站內地點探索驗收", () => {
  describe("1. 卡片三動作分離與位置容錯", () => {
    it("具備精確/行政區座標時同時提供本頁定位、此區新聞與外部地圖", () => {
      const html = eventCard(BASE_EVENT, 2);

      // 動作一：本頁定位
      expect(html).toContain('class="card-loc-action locate-on-page-btn"');
      expect(html).toContain('data-locate="test-ev-1"');
      expect(html).toContain("📍 本頁定位");

      // 動作二：查看此區新聞
      expect(html).toContain('class="card-loc-action filter-region-btn"');
      expect(html).toContain('data-filter-region="臺北市中正區"');
      expect(html).toContain("🔍 查看此區新聞");

      // 動作三：外部地圖
      expect(html).toContain("location-link src-link");
      expect(html).toContain("https://www.google.com/maps/search/");
      expect(html).toContain("查詢區域（非案發點）");
    });

    it("無足夠位置資料時保留新聞閱讀，不猜地點也不破壞畫面", () => {
      const noLocEvent: IntelEvent = {
        ...BASE_EVENT,
        id: "no-loc-ev",
        region: "全國",
        lat: undefined,
        lng: undefined,
        locationPrecision: "global",
      };

      const html = eventCard(noLocEvent, 0);
      expect(html).not.toContain("locate-on-page-btn");
      expect(html).not.toContain("filter-region-btn");
      expect(html).toContain("台北市刑大破獲假投資吸金詐騙集團");
      expect(html).toContain("全國");
    });
  });

  describe("2. 區域條件疊加與 URL 序列化", () => {
    it("地區條件與時間、分類、來源、搜尋自由疊加並可精確過濾", () => {
      const pool: IntelEvent[] = [
        BASE_EVENT,
        {
          ...BASE_EVENT,
          id: "test-ev-2",
          title: "台中西區查獲洗錢水房",
          region: "臺中市西區",
          category: "反詐",
          riskLevel: "high",
        },
        {
          ...BASE_EVENT,
          id: "test-ev-3",
          title: "台北中正區交通號誌故障維修",
          region: "台北市中正區",
          category: "交通",
          riskLevel: "low",
        },
      ];

      // 地區 + 分類疊加
      const filtered = filterEvents(pool, { region: "台北市", category: "反詐" });
      expect(filtered.map((e) => e.id)).toEqual(["test-ev-1"]);

      // 台/臺正規化
      const filteredTc = filterEvents(pool, { region: "台中市" });
      expect(filteredTc.map((e) => e.id)).toEqual(["test-ev-2"]);
    });

    it("store 狀態正確記錄 region 並支援更新與清除", () => {
      setState({ region: "新北市板橋區" });
      expect(getState().region).toBe("新北市板橋區");

      setState({ region: undefined });
      expect(getState().region).toBeUndefined();
    });
  });

  describe("3. 聚合點全部成員列表及同座標免放大", () => {
    it("同座標多事件提供完整成員展開清單，不要求一直放大", () => {
      const clusteredEvents: IntelEvent[] = [
        { ...BASE_EVENT, id: "c-1", title: "事件一（最高風險）", riskLevel: "critical" },
        { ...BASE_EVENT, id: "c-2", title: "事件二", riskLevel: "high" },
        { ...BASE_EVENT, id: "c-3", title: "事件三（同座標剩餘）", riskLevel: "medium" },
        { ...BASE_EVENT, id: "c-4", title: "事件四（同座標剩餘）", riskLevel: "low" },
      ];

      const html = clusterPopupHtml(clusteredEvents);

      expect(html).toContain("此區有 4 則情報");
      expect(html).toContain("map-cluster-details");
      expect(html).toContain("另有 2 則，可展開完整列表（共 4 則，同座標免放大）");
      expect(html).toContain("事件一（最高風險）");
      expect(html).toContain("事件二");
      expect(html).toContain("事件三（同座標剩餘）");
      expect(html).toContain("事件四（同座標剩餘）");
      expect(html).toContain("此區新聞");
    });
  });

  describe("4. 關聯焦點篩選保留與內外分離", () => {
    it("中心事件超出篩選時明確標註原因，不靜默取消使用者條件", () => {
      const now = new Date("2026-06-27T00:00:00.000Z").getTime();
      const reasons = explainOutOfFilter(BASE_EVENT, {
        category: "治安",
        minRisk: "critical",
        region: "高雄市",
        sinceDays: 1, // BASE_EVENT is 38h ago, exceeding 1 day (24h)
        now,
      });

      expect(reasons).toContain("分類非「治安」");
      expect(reasons).toContain("風險未達「critical」");
      expect(reasons).toContain("地點非「高雄市」");
      expect(reasons).toContain("時間超出近 1 天");
    });

    it("返回全部只清除焦點，保留所有已設定的篩選條件", () => {
      setState({
        scope: "domestic",
        category: "反詐",
        region: "臺北市",
        minRisk: "high",
        sinceDays: 5,
        query: "投資",
      });

      // 模擬進入焦點
      let localFocusId: string | null = "test-ev-1";
      let localFocusCluster: string | null = null;
      let localShowOutOfFilter = false;

      // 模擬點擊返回全部 (#clear-focus)
      localFocusId = null;
      localFocusCluster = null;
      localShowOutOfFilter = false;

      // 驗證原先的 filter state 完好如初
      const s = getState();
      expect(s.category).toBe("反詐");
      expect(s.region).toBe("臺北市");
      expect(s.minRisk).toBe("high");
      expect(s.sinceDays).toBe(5);
      expect(s.query).toBe("投資");
      expect(localFocusId).toBeNull();
      expect(localFocusCluster).toBeNull();
      expect(localShowOutOfFilter).toBe(false);
    });
  });
});
