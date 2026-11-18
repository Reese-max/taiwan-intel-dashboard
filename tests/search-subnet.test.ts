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
    const strong = { type: "same-incident", weight: 1.5 };
    const net = { related: () => [{ id: "old", ...strong }, { id: "related", ...strong }] } as unknown as NetworkIndex;
    expect(applySearchSubnet(events, net, "最近的電信新聞").map(e => e.id)).toEqual(["new", "related"]);
  });

  it("多個詞時每個詞（含同義詞）都要命中", () => {
    const events = [event("hit", "台北連環車禍"), event("place", "台北市議會開議"), event("other", "台中車禍")];
    const net = { related: () => [] } as unknown as NetworkIndex;
    expect(applySearchSubnet(events, net, "台北 車禍").map(e => e.id)).toEqual(["hit"]);
  });

  it("只帶強關聯與人工後續報導，不帶同城同類的弱關聯", () => {
    const events = [event("hit", "販毒集團落網"), event("same", "同案另一家報導"), event("follow", "後續起訴"),
      event("weak", "同城別案"), event("topic", "同類議題")];
    const net = { related: (id: string) => id === "hit" ? [
      { id: "same", type: "same-incident", weight: 1.5 }, { id: "follow", type: "follow-up", weight: 1 },
      { id: "weak", type: "same-incident", weight: 1.2 }, { id: "topic", type: "same-topic", weight: 0.3 },
    ] : [] } as unknown as NetworkIndex;
    expect(applySearchSubnet(events, net, "毒品").map(e => e.id)).toEqual(["hit", "same", "follow"]);
  });

  it("台與臺視為同字，通訊不算電信", () => {
    const events = [event("tw", "臺北市南港連環車禍"), event("comm", "駭客入侵救護通訊系統")];
    const net = { related: () => [] } as unknown as NetworkIndex;
    expect(applySearchSubnet(events, net, "台北 車禍").map(e => e.id)).toEqual(["tw"]);
    expect(applySearchSubnet(events, net, "電信")).toEqual([]);
  });

  it("具體詞不放大成整個主題", () => {
    const events = [event("crash", "南港連環車禍"), event("police", "老翁迷途警助返家")];
    events[1].source.name = "臺北市政府警察局交通警察大隊";
    const net = { related: () => [] } as unknown as NetworkIndex;
    expect(applySearchSubnet(events, net, "車禍").map(e => e.id)).toEqual(["crash"]);
    expect(applySearchSubnet(events, net, "交通").map(e => e.id)).toEqual(["crash"]);
    expect(applySearchSubnet(events, net, "交通警察大隊").map(e => e.id)).toEqual(["police"]);
    expect(applySearchSubnet(events, net, "交通 測試來源").map(e => e.id)).toEqual(["crash"]);
    expect(applySearchSubnet(events, net, "交通 交通警察大隊")).toEqual([]);
    expect(applySearchSubnet(events, net, "constructor")).toEqual([]);
  });

  it("只有時間詞時列出時間窗內的新聞", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
    const events = [event("new", "最新消息"), event("old", "舊消息", "2026-10-01T00:00:00Z")];
    expect(applySearchSubnet(events, { related: () => [] } as unknown as NetworkIndex, "最近新聞")).toEqual([events[0]]);
  });
});

describe("站外標題與站內事件配對", () => {
  it("台與臺視為同字判斷重複", () => {
    expect(relateExternal({ title: "臺北工廠火災" }, [event("a", "台北工廠火災")]).duplicate).toBe(true);
  });

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
