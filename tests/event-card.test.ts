import { describe, expect, it } from "vitest";
import { eventCard } from "../src/components/EventCard";
import type { IntelEvent } from "../src/types/event";

describe("eventCard", () => {
  it("呈現事件的完整來源與脈絡欄位", () => {
    const event: IntelEvent = {
      id: "evt-1",
      title: "詐騙網站新增通報",
      region: "臺北市",
      timestamp: "2026-06-20T10:00:00+08:00",
      category: "反詐",
      scope: "domestic",
      riskLevel: "high",
      summary: "165 通報新增涉詐網站。",
      source: {
        name: "165反詐騙 涉詐網站停解析",
        type: "gov-open-data",
        datasetId: "176455",
        recordRef: "row-9",
        url: "https://data.gov.tw/dataset/176455",
        fetchedAt: "2026-06-20T23:00:00+08:00",
        query: "query_rows 176455",
      },
    };

    const html = eventCard(event, 3);

    expect(html).toContain("完整脈絡");
    expect(html).toContain("資料時間");
    expect(html).toContain("擷取時間");
    expect(html).toContain("開放資料");
    expect(html).toContain("資料集 176455");
    expect(html).toContain("原始編號 row-9");
    expect(html).toContain("可重現查詢");
    expect(html).toContain("關聯 3");
  });
});
