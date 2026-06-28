import { describe, expect, it, vi } from "vitest";
import { renderSourcePanel } from "../src/components/SourcePanel";

describe("renderSourcePanel", () => {
  it("呈現來源總覽、同步新鮮度與授權脈絡", async () => {
    const manifest = {
      generatedAt: "2026-06-21T00:00:00+08:00",
      note: "測試備註",
      sources: [
        {
          name: "警政署 165 反詐騙",
          type: "gov-open-data",
          datasetId: "123",
          scope: "domestic",
          category: "反詐",
          count: 100,
          fetchedAt: "2026-06-20T23:00:00+08:00",
          lastSuccessAt: "2026-06-20T23:00:00+08:00",
          query: "query_rows 123",
          license: "政府資料開放授權條款-第1版",
        },
        {
          name: "國際資安新聞",
          type: "news-rss",
          scope: "international",
          category: "資安",
          count: 10,
          fetchedAt: "2026-06-17T00:00:00+08:00",
          lastSuccessAt: "2026-06-17T00:00:00+08:00",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(manifest), { status: 200 })),
    );
    const container = { innerHTML: "" } as HTMLElement;

    try {
      await renderSourcePanel(container);

      expect(container.innerHTML).toContain("來源總覽");
      expect(container.innerHTML).toContain("2 個來源");
      expect(container.innerHTML).toContain("110 筆");
      expect(container.innerHTML).toContain("官方來源 1");
      expect(container.innerHTML).toContain("同步正常");
      expect(container.innerHTML).toContain("需檢查");
      expect(container.innerHTML).toContain("政府資料開放授權條款-第1版");
      expect(container.innerHTML).toContain("https://data.gov.tw/dataset/123");
      expect(container.innerHTML).toContain("測試備註");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("顯示台灣新聞低貢獻來源，提醒新增來源可能被去重或過濾掉", async () => {
    const manifest = {
      generatedAt: "2026-06-21T00:00:00+08:00",
      pipeline: {
        twnews: {
          ok: true,
          lowContributionFeeds: ["GN 數位時代資安", "司法院官網"],
          sourceContributionTotals: {
            raw: 200,
            rawUnique: 150,
            policeRelevant: 20,
            finalEvents: 1,
          },
        },
      },
      sources: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(manifest), { status: 200 })),
    );
    const container = { innerHTML: "" } as HTMLElement;

    try {
      await renderSourcePanel(container);

      expect(container.innerHTML).toContain("新聞來源低貢獻警示");
      expect(container.innerHTML).toContain("GN 數位時代資安");
      expect(container.innerHTML).toContain("司法院官網");
      expect(container.innerHTML).toContain("最終 1／原始 200");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
