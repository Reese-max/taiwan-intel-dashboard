import { afterEach, describe, expect, it, vi } from "vitest";
import { applySearchSubnet, relateExternal } from "../src/search";
import type { IntelEvent } from "../src/types/event";
import type { NetworkIndex } from "../src/data/network";

const event = (id: string, title: string, timestamp = "2026-11-16T12:00:00Z"): IntelEvent => ({
  id, title, timestamp, summary: "", region: "", category: "", scope: "domestic", riskLevel: "low",
  source: { name: "測試來源", type: "manual", fetchedAt: timestamp },
});
afterEach(() => vi.useRealTimers());

describe("解析後的站內搜尋", () => {
  it("同義詞命中並排除時間窗外的直接命中與關聯事件", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
    const events = [event("new", "遠傳基地台修復"), event("related", "工程進度"),
      event("old", "電信斷訊", "2026-10-01T00:00:00Z")];
    const net = { related: () => [{ id: "old" }, { id: "related" }] } as unknown as NetworkIndex;
    expect(applySearchSubnet(events, net, "最近的電信新聞").map(e => e.id)).toEqual(["new", "related"]);
  });

  it("多個詞時每個詞（含同義詞）都要命中", () => {
    const events = [event("hit", "台北酒駕追撞"), event("place", "台北市議會開議"), event("other", "台中車禍")];
    const net = { related: () => [] } as unknown as NetworkIndex;
    expect(applySearchSubnet(events, net, "台北 車禍").map(e => e.id)).toEqual(["hit"]);
  });

  it("只有時間詞時列出時間窗內的新聞", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
    const events = [event("new", "最新消息"), event("old", "舊消息", "2026-10-01T00:00:00Z")];
    expect(applySearchSubnet(events, { related: () => [] } as unknown as NetworkIndex, "最近新聞")).toEqual([events[0]]);
  });
});

describe("站外標題與站內事件配對", () => {
  it("相似標題依相似度排序、最多三筆且標記重複", () => {
    const events = [event("a", "台北工廠火災消防搶救"), event("b", "台北工廠火災傷者送醫"),
      event("c", "台北工廠火災持續延燒"), event("d", "台北工廠火災交通管制"), event("x", "颱風接近東部海域")];
    const result = relateExternal({ title: "台北工廠火災消防搶救" }, events);
    expect(result.duplicate).toBe(true);
    expect(result.related).toHaveLength(3);
    expect(result.related[0].id).toBe("a");
    expect(result.related.map(e => e.id)).not.toContain("x");
    expect(relateExternal({ title: "台北工廠火災現場" }, events).duplicate).toBe(false);
    expect(relateExternal({ title: "！" }, events)).toEqual({ related: [], duplicate: false });
  });
});
