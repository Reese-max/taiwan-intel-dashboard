import { describe, expect, it, vi } from "vitest";
import { renderPoliceHealthPanel } from "../src/components/PoliceHealthPanel";

type FakeElement = HTMLElement | null;
type FakeContainer = {
  innerHTML: string;
  querySelector: (selector: string) => FakeElement;
  querySelectorAll: (selector: string) => [];
};

const makeManifest = (newPoliceRelatedCount: number, minimumNewPerHour: number) => ({
  generatedAt: "2026-06-21T00:00:00+08:00",
  pipeline: {
    police: {
      newPoliceRelatedCount,
      deferredNewCandidateCount: 1,
      newMinimumPerHour: minimumNewPerHour,
    },
  },
  sources: [
    {
      key: "police-missing",
      name: "警政署 165 反詐騙",
      count: 12,
      fetchedAt: "2026-06-21T00:00:00+08:00",
    },
  ],
});

const makeHistory = (newPoliceRelatedCount: number, minimumNewPerHour: number) => ({
  runs: [
    {
      hourLocal: "2026-06-21 01:00",
      newPoliceRelatedCount,
      minimumNewPerHour,
      deferredNewCandidateCount: 0,
    },
  ],
});

const stubFetch = (manifest: object, history: object, provenanceOk = true): FakeContainer => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).endsWith("provenance.json")) {
        return new Response(JSON.stringify(manifest), { status: provenanceOk ? 200 : 500 });
      }
      if (String(url).endsWith("police-hourly-history.json")) {
        return new Response(JSON.stringify(history), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }),
  );

  const container: FakeContainer = {
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: () => [],
  };

  return container;
};

describe("renderPoliceHealthPanel", () => {
  it("達標情境會渲染趨勢為 ok 樣式", async () => {
    const manifest = makeManifest(250, 200);
    const history = makeHistory(250, 200);
    const container = stubFetch(manifest, history);

    try {
      await renderPoliceHealthPanel(container);

      expect(container.innerHTML).toContain("class=\"fill ok\"");
      expect(container.innerHTML).not.toContain("class=\"fill warn\"");
      expect(container.innerHTML).toContain("目標：200 筆／小時");
      expect(container.innerHTML).toContain("處理建議");
      expect(container.innerHTML).toContain("來源狀態正常");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("未達標情境會渲染趨勢為 warn 樣式", async () => {
    const manifest = makeManifest(80, 200);
    const history = makeHistory(80, 200);
    const container = stubFetch(manifest, history);

    try {
      await renderPoliceHealthPanel(container);

      expect(container.innerHTML).toContain("class=\"fill warn\"");
      expect(container.innerHTML).not.toContain("class=\"fill ok\"");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("顯示 7 日分布校準資訊", async () => {
    const manifest = makeManifest(93, 93);
    const history = {
      ...makeHistory(93, 93),
      calibration: { minimumNewPerHour: 93, lookbackDays: 7, percentile: 25, sampleSize: 2 },
    };
    const container = stubFetch(manifest, history);

    try {
      await renderPoliceHealthPanel(container);

      expect(container.innerHTML).toContain("7 日 P25 動態門檻：93 筆／小時（2 個有效時段）");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("本輪未跑 police 時沿用最新 hourly 入帳結果，不顯示假 0", async () => {
    const manifest = {
      ...makeManifest(0, 200),
      pipeline: { police: { skipped: true } },
    };
    const history = makeHistory(93, 200);
    const container = stubFetch(manifest, history);

    try {
      await renderPoliceHealthPanel(container);

      expect(container.innerHTML).toContain("<b>93</b><span>本小時全新</span>");
      expect(container.innerHTML).toContain("顯示上次警政入帳結果");
      expect(container.innerHTML).toContain("警政時段：2026-06-21 01:00");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("分列官方與媒體警政新聞筆數及各自新鮮度", async () => {
    const manifest = {
      ...makeManifest(93, 100),
      sources: [
        {
          key: "policeNews",
          name: "警政署 各警察機關新聞發布",
          type: "gov-open-data",
          datasetId: "7505",
          count: 120,
          fetchedAt: "2026-06-21T00:00:00+08:00",
        },
        {
          name: "台灣新聞：移民署 新聞",
          type: "news-rss",
          datasetId: "tw-news",
          authority: "official",
          count: 30,
          fetchedAt: "2026-06-20T23:30:00+08:00",
        },
        {
          name: "台灣新聞：自由時報 社會",
          type: "news-rss",
          datasetId: "tw-news",
          count: 70,
          fetchedAt: "2026-06-17T23:00:00+08:00",
        },
      ],
    };
    const container = stubFetch(manifest, makeHistory(93, 100));

    try {
      await renderPoliceHealthPanel(container);

      expect(container.innerHTML).toContain("<b>150</b><span>官方警政新聞</span>");
      expect(container.innerHTML).toContain("<b>70</b><span>媒體警政新聞</span>");
      expect(container.innerHTML).toContain("24 小時內｜最新同步");
      expect(container.innerHTML).toContain("超過 3 日｜最新同步");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("限制警政來源展開明細並截斷錯誤堆疊", async () => {
    const longStack = `Error: source failed\n${"x".repeat(520)}`;
    const manifest = {
      generatedAt: "2026-06-21T00:00:00+08:00",
      pipeline: {
        police: {
          "police-01": { ok: false, error: "HTTP 500", stack: longStack },
          newPoliceRelatedCount: 80,
          deferredNewCandidateCount: 1,
          newMinimumPerHour: 200,
        },
      },
      sources: Array.from({ length: 12 }, (_, index) => ({
        key: `police-${String(index + 1).padStart(2, "0")}`,
        name: `警政來源 ${String(index + 1).padStart(2, "0")}`,
        count: 100 - index,
        fetchedAt: "2026-06-21T00:00:00+08:00",
      })),
    };
    const history = makeHistory(80, 200);
    const container = stubFetch(manifest, history);

    try {
      await renderPoliceHealthPanel(container);

      expect(container.innerHTML.match(/class="health-source-item"/g)?.length).toBe(10);
      expect(container.innerHTML).toContain("查看 6 個來源明細（另 2 個省略）");
      expect(container.innerHTML).toContain("另有 2 個正常來源已省略");
      expect(container.innerHTML).toContain("錯誤摘要");
      expect(container.innerHTML).toContain("…已截斷");
      expect(container.innerHTML).toContain("警政來源 10");
      expect(container.innerHTML).not.toContain("警政來源 11");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("provenance fetch 不可用時會顯示不可用空狀態", async () => {
    const container = stubFetch({}, { runs: [] }, false);

    try {
      await renderPoliceHealthPanel(container);

      expect(container.innerHTML).toContain("警政健康檢查不可用");
      expect(container.innerHTML).toContain("<p class=\"empty\">警政健康檢查不可用</p>");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
