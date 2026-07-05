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

