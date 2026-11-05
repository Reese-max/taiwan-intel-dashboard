import { describe, expect, it } from "vitest";
import { detectCounty, detectCountyInBody, mapBulkNews } from "../scripts/lib/news-bulk.mjs";

describe("A：重複短名與無括號署名", () => {
  it("國1民雄事故由署名後的嘉義民雄路段判為縣", () => {
    const title = "國1民雄段聯結車疑爆胎翻覆! 後方4車追撞釀2死2傷";
    const description = "南部中心／鄭榮文、郭佩綺嘉義報導31號凌晨國道1號北上嘉義民雄路段，發生一起追撞連環車禍…";
    expect(detectCountyInBody(description).region).toBe("嘉義縣");
    expect(mapBulkNews([{ title, description, link: "https://example.test/a", source: "測試", hint: "交通", pubDate: "2026-11-04T00:00:00Z" }])[0].region).toBe("嘉義縣");
  });
  it.each([
    ["嘉義傳出事故，後續確認為嘉義民雄路段", "嘉義縣"],
    ["新竹傳出事故，後續確認為新竹湖口工廠", "新竹縣"],
    ["嘉義市傳出事故，嘉義民雄警消支援", "嘉義市"],
    ["竹市傳出事故，新竹湖口警消支援", "新竹市"],
    ["新竹發生事故，後續確認為新竹寶山路", "新竹市"],
    ["嘉義傳出事故，嘉義市民雄路車禍", "嘉義市"],
    ["嘉義東石路段車禍", "嘉義縣"],
  ])("每次命中獨立判斷：%s", (text, region) => expect(detectCounty(text).region).toBe(region));
  it("剝除無括號署名，沒有本文地點時仍可回退署名", () => {
    expect(detectCountyInBody("南部中心／鄭榮文、郭佩綺嘉義報導高雄市發生事故").region).toBe("高雄市");
    expect(detectCountyInBody("南部中心／鄭榮文、郭佩綺嘉義報導事故仍在調查").region).toBe("嘉義市");
  });
});

describe("R1–R3：事發地優先與署名邊界", () => {
  it.each([
    "嘉義市西區今日凌晨發生住宅火警，嘉義縣消防局亦派車跨區支援。",
    "〔記者王明／嘉義縣報導〕嘉義市西區住宅火警，嘉義縣消防局支援。",
    "南部中心／王小明嘉義縣報導嘉義市西區住宅火警，嘉義縣消防局支援。",
  ])("R1-1：摘要剝署名後先出現的明確市名優先：%s", (description) => {
    expect(mapBulkNews([{ title: "嘉義西區民宅火警", description, link: "https://example.test/r1", source: "測試", hint: "災防", pubDate: "2026-11-04T00:00:00Z" }])[0].region).toBe("嘉義市");
  });
  it.each([
    ["新竹巨城百貨竊案 嫌犯逃往新竹竹北落網", "新竹市"],
    ["嘉義文化路夜市發生鬥毆，嫌犯隨後逃回嘉義民雄藏匿。", "嘉義市"],
    ["新竹東區竊案 嫌犯逃往新竹縣竹北市落網", "新竹市"],
    ["新竹科學工業園區驚傳火警", "新竹市"],
    ["新竹香山工業區倉庫火警", "新竹市"],
    ["新竹香山產業園區倉庫火警", "新竹市"],
    ["新竹工業區倉庫火警", "新竹縣"],
    ["新竹湖口工業區倉庫火警", "新竹縣"],
    ["基隆路地下道淹水 北市警緊急封閉", "臺北市"],
    ["新竹寶山路段上班車潮追撞車禍 竹市警到場排除", "新竹市"],
    ["台北地檢署指揮破獲花蓮大型製毒工廠", "花蓮縣", "臺北市"],
    ["臺北市地方法院審理高雄市詐騙案", "高雄市", "臺北市"],
    ["台北地院審理花蓮詐騙案", "花蓮縣", "臺北市"],
    ["台北地方檢察署指揮破獲花蓮製毒案", "花蓮縣", "臺北市"],
  ])("事發地判定：%s", (text, region, bodyRegion = region) => {
    expect(detectCounty(text).region).toBe(region);
    expect(detectCountyInBody(text).region).toBe(bodyRegion);
  });
  it.each(["地檢署", "地院", "地方法院", "地方檢察署"])("R3-3：只有機關%s所在地仍回退使用", (agency) => {
    expect(detectCounty(`台北${agency}指揮破獲製毒工廠`).region).toBe("臺北市");
  });
  it.each(["路", "街", "大道", "巷"])("R3-1：短名接%s 不算縣市，仍可尋找後續同名", (suffix) => {
    expect(detectCounty(`基隆${suffix}淹水 北市警封閉`).region).toBe("臺北市");
    expect(detectCounty(`基隆${suffix}以外，基隆港也淹水`).region).toBe("基隆市");
  });
  it.each([
    ["獨家／嘉義市西區銀樓遭搶 綜合台媒報導，嫌犯作案後逃往高雄市。", "嘉義市"],
    ["新北市／板橋區民宅火警最新追蹤報導，屋主由臺北市家屬接回。", "新北市"],
    ["獨家／臺北火警報導，高雄市消防隊支援。", "臺北市"],
    ["民視新聞／記者鄭榮文／嘉義報導高雄市前鎮區今日發生追撞車禍。", "高雄市"],
    ["CNEWS匯流新聞網記者王小明／台北報導新竹縣竹北市今日發生工廠火警。", "新竹縣"],
    ["三立新聞網／社會中心／台北報導高雄市發生火警。", "高雄市"],
    ["社會中心／王毓珺 黃柏榕 新北市報導高雄市發生火警。", "高雄市"],
    ["民視新聞／記者鄭榮文／嘉義報導事故仍在調查。", "嘉義市"],
  ])("R2：署名形狀與正文保留：%s", (text, region) => expect(detectCountyInBody(text).region).toBe(region));
});

describe("r24：線上快照回歸", () => {
  it.each([
    ["半拖車國道狂飆133！司機辯「太重飆不快」拿GPS翻案 慘吞重罰再扣牌", "鄭姓男子駕駛重車行經國道1號彰化路段時，遭警方雷達測速拍下，高雄警方依法開罰。", ["彰化縣"]],
    ["國1南下嘉義路段凌晨重大事故 聯結車疑爆胎後方4車連環追撞釀2死2傷", "警方調查事故原因。", ["嘉義市", "嘉義縣"]],
    ["國道1號新北路段今（31）日凌晨發生墜橋事故", "警方調查事故原因。", ["新北市"]],
    ["基隆路地下道淹水 北市警緊急封閉", "警方封閉地下道。", ["臺北市"]],
  ])("R3-1：路段保留縣市，道路名仍排除：%s", (title, description, regions) => {
    expect(regions).toContain(mapBulkNews([{ title, description, link: "https://example.test/r24-road", source: "測試", hint: "交通", pubDate: "2026-11-04T00:00:00Z" }])[0].region);
  });

  it.each([
    ["偽造沈伯洋影音案 涉案男遭聲押禁見 (圖)", "台灣桃園地方檢察署表示，民主進步黨台北市長參選人沈伯洋遭人製作深度偽造影音檔案，鎖定發文者身分後，30日下午將涉案鄭姓男拘提。"],
    ["桃檢偵辦偽造沈伯洋聲音介選 男遭拘提聲押禁見", "（中央社記者吳睿騏桃園30日電）桃園地檢署獲知有人以深偽技術製作民主進步黨台北市長參選人沈伯洋影音。"],
  ])("R3-3：內文機關所在地不降權：%s", (title, description) => {
    expect(detectCountyInBody(description).region).toBe("桃園市");
    expect(mapBulkNews([{ title, description, link: "https://example.test/r24-agency", source: "測試", hint: "治安", pubDate: "2026-11-04T00:00:00Z" }])[0].region).toBe("桃園市");
  });
  it.each(["地檢署", "地院", "地方法院", "地方檢察署"])("R3-3：%s 只在標題有其他縣市才降權", (agency) => {
    expect(detectCounty(`台北${agency}指揮破獲花蓮製毒案`).region).toBe("花蓮縣");
    expect(detectCounty(`台北${agency}指揮破獲製毒工廠`, "高雄警方支援").region).toBe("臺北市");
    expect(detectCountyInBody(`台北${agency}指揮破獲花蓮製毒案`).region).toBe("臺北市");
  });

  it("R1-2：模糊標題可由摘要後續非移動的鄉鎮證據補足", () => {
    const title = "發展地方特色產業 嘉義瑞峰種植台灣原生山茶";
    const description = "嘉義梅山瑞峰茶農賴俊謀（中）介紹台灣山茶…";
    expect(detectCounty(title, description).region).toBe("嘉義縣");
    expect(detectCounty(`${title}，${description}`).region).toBe("嘉義縣");
    expect(detectCountyInBody(`${title}，${description}`).region).toBe("嘉義縣");
  });
  it.each(["逃往", "逃回", "逃到", "前往", "南下", "北上", "返回"])("R1-2：後續%s 的鄉鎮不改判", (movement) => {
    expect(detectCounty(`新竹發生竊案，嫌犯${movement}新竹竹北落網`).region).toBe("新竹市");
    expect(detectCounty("嘉義傳出竊案", `嫌犯${movement}嘉義民雄藏匿`).region).toBe("嘉義市");
  });
  it.each([
    ["嘉義市傳出事故，嘉義梅山警方支援", "嘉義市"],
    ["竹市傳出事故，新竹竹北警方支援", "新竹市"],
    ["新竹巨城百貨竊案，新竹竹北警方支援", "新竹市"],
    ["嘉義文化路夜市鬥毆，嘉義民雄警方支援", "嘉義市"],
    ["新竹東區竊案，新竹湖口警方支援", "新竹市"],
    ["新竹科學工業園區火警，新竹湖口警方支援", "新竹市"],
  ])("R1-2：第一處明確市區證據保留：%s", (text, region) => {
    expect(detectCounty(text).region).toBe(region);
    expect(detectCounty(text.split("，")[0], text.split("，")[1]).region).toBe(region);
  });
});
