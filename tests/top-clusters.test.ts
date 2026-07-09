import { describe, expect, it } from "vitest";
import { renderTopClusters } from "../src/components/TopClusters";
import type { NetCluster } from "../src/data/network";

function container(): HTMLElement {
  return { innerHTML: "" } as HTMLElement;
}

describe("renderTopClusters", () => {
  it("非雜燴群優先於 size 較大的 incoherent 雜燴群", () => {
    const el = container();
    const clusters: NetCluster[] = [
      { id: "junk", members: [], size: 477, representativeTitle: "舊詐騙雜燴", topCategory: "詐欺", latestTs: "2026-06-22T00:00:00+08:00", incoherent: true, dominantCategoryShare: 0.22 },
      { id: "story", members: [], size: 42, representativeTitle: "連貫詐騙水房案", topCategory: "詐欺", latestTs: "2026-06-21T00:00:00+08:00", incoherent: false, dominantCategoryShare: 0.86 },
    ];

    renderTopClusters(el, clusters, {}, 2);

    expect(el.innerHTML.indexOf('data-cluster="story"')).toBeLessThan(el.innerHTML.indexOf('data-cluster="junk"'));
  });

  it("預設只顯示前三群且只保留第一群摘要，避免側欄過長", () => {
    const el = container();
    const clusters: NetCluster[] = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      members: [],
      size: 10 - i,
      representativeTitle: `群組 ${i}`,
      topCategory: "治安",
      latestTs: "2026-06-22T00:00:00+08:00",
    }));
    const summaries = Object.fromEntries(clusters.map((c) => [c.id, `這是 ${c.id} 的很長 AI 摘要，應該只在前兩群顯示並被縮短以降低側欄高度。`]));

    renderTopClusters(el, clusters, summaries);

    expect((el.innerHTML.match(/data-cluster="/g) ?? [])).toHaveLength(3);
    expect((el.innerHTML.match(/class="cluster-summary"/g) ?? [])).toHaveLength(1);
    expect(el.innerHTML).toContain('title="這是 c0 的很長 AI 摘要');
    expect(el.innerHTML).not.toContain('data-cluster="c3"');
  });
});
