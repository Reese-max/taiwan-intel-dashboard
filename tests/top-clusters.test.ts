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
});
