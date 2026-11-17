// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { applySearchSubnet } from "../src/search";
import { collapseSameIncident } from "../src/utils/collapse";
import { renderEventList } from "../src/components/EventList";
import type { IntelEvent } from "../src/types/event";
import type { NetworkIndex, RelatedRef } from "../src/data/network";

const event = (id: string, title: string, summary = ""): IntelEvent => ({
  id, title, summary, region: "", category: "", scope: "domestic", riskLevel: "low",
  timestamp: "2026-11-17T00:00:00Z",
  source: { name: "CTWANT", publisherName: "CTWANT", type: "news-rss",
    url: `https://example.test/${id}`, recordRef: `record:${id}`, fetchedAt: "2026-11-17T00:00:00Z" },
});
const net = (refs: Record<string, RelatedRef[]> = {}) => ({ related: (id: string) => refs[id] ?? [] }) as unknown as NetworkIndex;
const follow = (id: string): RelatedRef => ({ id, type: "follow-up", weight: 1, why: "後續" });
const ids = (events: IntelEvent[]) => events.map(e => e.id);
afterEach(() => { document.body.innerHTML = ""; });

describe("搜尋排序與標題重複收合", () => {
  it("標題須命中所有詞組；台臺、小寫與同義詞共用，三層各自穩定", () => {
    const events = [event("related1", "工程進度"), event("summary1", "政見發表會", "台北火災 ABC"),
      event("title1", "臺北火警 ABC"), event("partial", "台北施政 ABC", "火災"),
      event("title2", "台北火災 abc"), event("related2", "後續救援"),
      event("summary2", "競選活動", "臺北火災 abc"), event("excluded", "無關訊息")];
    const network = net({ title1: [follow("related1"), follow("related2"), follow("summary1")] });
    expect(ids(applySearchSubnet(events, network, "台北 火災 abc")))
      .toEqual(["title1", "title2", "summary1", "partial", "summary2", "related1", "related2"]);
    expect(applySearchSubnet(events, network, "  ")).toBe(events);
  });

  it("地區、分類、來源的直接命中也排在標題之後、關聯之前", () => {
    const region = event("region", "地區報導"); region.region = "台北";
    const category = event("category", "分類報導"); category.category = "台北";
    const source = event("source", "來源報導"); source.source.name = "臺北媒體";
    const events = [event("related", "其他報導"), region, category, source, event("title", "臺北最新動態")];
    expect(ids(applySearchSubnet(events, net({ title: [follow("related")] }), "台北")))
      .toEqual(["title", "region", "category", "source", "related"]);
  });

  it("同媒體不同 URL 與 recordRef 的相同標題收合，不增加發布者數", () => {
    const a = event("a", "台北工廠火災消防搶救");
    const b = event("b", a.title); b.source.name = "GN CTWANT";
    b.source.url = "https://news.google.com/rss/articles/b";
    const groups = collapseSameIncident([a, b], net());
    expect(groups).toHaveLength(1);
    expect(ids(groups[0].members)).toEqual(["a", "b"]);
    expect(groups[0]).toMatchObject({ sourceCount: 1, rawReportCount: 2 });
  });

  it.each(["臺北 工廠火災，消防搶救！", "台北工廠火災消防搶救 | 社會 | CTWANT",
    "台北工廠火災消防搶救｜社會｜CTWANT", "台北工廠火災消防搶救 - CTWANT",
    "台北工廠火災消防搶救-CTWANT", "台北工廠火災消防搶救 - 自由時報",
    "台北工廠火災消防搶救中"])("正規化或 Jaccard 達門檻的標題可收合：%s", title => {
    expect(collapseSameIncident([event("a", "台北工廠火災消防搶救"), event("b", title)], net())).toHaveLength(1);
  });

  it("無關標題、空標題與純標點不因正規化而合併", () => {
    const events = [event("a", "台北工廠火災消防搶救"), event("b", "候選人發表競選政見"),
      event("c", "！"), event("d", ""), event("e", "？？")];
    expect(collapseSameIncident(events, net())).toHaveLength(events.length);
  });

  it.each([["abcdef", 1], ["abcdefg", 2]] as const)("Jaccard 0.8 含邊界、低於門檻不收合：%s", (title, count) => {
    expect(collapseSameIncident([event("a", "abcde"), event("b", title)], net())).toHaveLength(count);
  });

  it("破折號後不是媒體名稱時保留標題內容", () => {
    const events = [event("a", "今日焦點 - 港區工廠火災"), event("b", "今日焦點 - 山區颱風警報")];
    expect(collapseSameIncident(events, net())).toHaveLength(2);
  });

  it("標題相似也需全連接，不能透過第三者傳遞", () => {
    const events = [event("b", "abcdefghijk"), event("a", "abcdefghij"), event("c", "bcdefghijkl")];
    expect(collapseSameIncident(events, net()).map(g => ids(g.members))).toEqual([["b", "a"], ["c"]]);
  });

  it("搜尋經收合與列表後，仍按代表事件所在層級及輸入位置排序", () => {
    const related = event("related", "後續消息"); related.riskLevel = "high";
    const events = [related, event("summary", "候選人發表政見", "火災"),
      event("member", "工廠火災"), event("title", "住宅火警")];
    const network = net({ member: [{ id: "related", type: "same-incident", weight: 1.5, why: "同案" }] });
    const groups = collapseSameIncident(applySearchSubnet(events, network, "火災"), network);
    expect(groups.map(g => g.representative.id)).toEqual(["title", "summary", "related"]);
    const el = document.createElement("div");
    renderEventList(el, groups);
    expect([...el.querySelectorAll<HTMLElement>(".event-card")].map(card => card.dataset.id))
      .toEqual(["title", "summary", "related"]);
  });

  it.each([1, 2])("sourceCount=%i 只顯示代表卡片，原生按鈕可聚焦並切換成員", sourceCount => {
    const a = event("a", "代表標題"), b = event("b", "成員標題");
    const el = document.createElement("div"); document.body.append(el);
    const groups = [{ representative: a, members: [a, b], sourceCount }];
    renderEventList(el, groups);
    expect(el.querySelectorAll(".event-card")).toHaveLength(1);
    expect(el.querySelector("h3")?.textContent).toBe(a.title);
    const button = el.querySelector<HTMLButtonElement>("button.collapse-toggle")!;
    expect(button).not.toBeNull();
    expect(button.type).toBe("button");
    expect(button.textContent).toBe(sourceCount === 1 ? "🗂 收合 2 則" : "🗂 收合 2 源");
    const members = el.querySelector<HTMLElement>(".collapse-members")!;
    expect(members.hidden).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    button.focus(); expect(document.activeElement).toBe(button);
    button.click();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(members.hidden).toBe(false);
    expect(members.querySelector("a")?.getAttribute("href")).toBe(b.source.url);
    renderEventList(el, structuredClone(groups));
    expect(document.activeElement).toBe(button);
    button.click();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(members.hidden).toBe(true);
  });
});
