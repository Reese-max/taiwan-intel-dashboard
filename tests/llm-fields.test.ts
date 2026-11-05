import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import {
  clampTwRelevance,
  clampSentiment,
  cleanActors,
  cleanRelations,
  buildDeepAnalysisPrompt,
  applyDomesticCountyLocation,
  TW_CATEGORIES,
} from "../scripts/lib/nvidia.mjs";
import { mapBulkNews } from "../scripts/lib/news-bulk.mjs";

describe("嘉義縣標題的 LLM 地點 fallback", () => {
  it("保留縣市全名並套用嘉義縣中心點", () => {
    const event = applyDomesticCountyLocation({
      region: "全國",
      title: "嘉義縣東石鄉車禍 騎士送醫",
      summary: "交通事故",
    });
    expect(event).toMatchObject({ region: "嘉義縣", locationPrecision: "city" });
    expect(event.lat).toBeCloseTo(23.4518, 3);
    expect(event.lng).toBeCloseTo(120.2555, 3);
  });

  it("短名不足以區分縣市時不猜測", () => {
    const event = applyDomesticCountyLocation({
      region: "嘉義",
      title: "嘉義東石鄉車禍 騎士送醫",
      summary: "交通事故",
    });
    expect(event).toMatchObject({ region: "全國", lat: null, lng: null, locationPrecision: "unknown" });
  });
});

describe("LLM optional field clamps", () => {
  it("clampTwRelevance: clamp 0-100, round, non-number/null -> undefined", () => {
    expect(clampTwRelevance(150)).toBe(100);
    expect(clampTwRelevance(-5)).toBe(0);
    expect(clampTwRelevance(0)).toBe(0);
    expect(clampTwRelevance(100)).toBe(100);
    expect(clampTwRelevance(73.6)).toBe(74);
    expect(clampTwRelevance("85")).toBe(85);
    expect(clampTwRelevance("abc")).toBe(undefined);
    expect(clampTwRelevance(undefined)).toBe(undefined);
    expect(clampTwRelevance(null)).toBe(undefined);
    expect(clampTwRelevance("")).toBe(undefined);
  });

  it("clampSentiment: only the four enum values, else undefined", () => {
    expect(clampSentiment("negative")).toBe("negative");
    expect(clampSentiment("neutral")).toBe("neutral");
    expect(clampSentiment("positive")).toBe("positive");
    expect(clampSentiment("mixed")).toBe("mixed");
    expect(clampSentiment("angry")).toBe(undefined);
    expect(clampSentiment("")).toBe(undefined);
    expect(clampSentiment(undefined)).toBe(undefined);
    expect(clampSentiment(null)).toBe(undefined);
  });

  it("cleanActors: trims, dedupes, caps 5, drops too-short/long, non-array -> undefined", () => {
    expect(cleanActors(["Lazarus Group", " APT28 ", "APT28", "x"])).toEqual(["Lazarus Group", "APT28"]);
    expect(cleanActors(["柬埔寨詐騙集團", "竹聯幫"])).toEqual(["柬埔寨詐騙集團", "竹聯幫"]);
    expect(cleanActors(["a".repeat(30)])).toBe(undefined); // too long dropped
    expect(cleanActors(["A", "B"])).toBe(undefined); // single chars (len<2) all dropped -> undefined
    expect(cleanActors(["集團甲", "集團乙", "集團丙", "集團丁", "集團戊", "集團己"]).length).toBe(5); // caps at 5
    expect(cleanActors([])).toBe(undefined);
    expect(cleanActors("not-array")).toBe(undefined);
    expect(cleanActors(undefined)).toBe(undefined);
  });

  it("cleanRelations: keeps valid {from,to,type}, drops malformed, dedupes, caps 8", () => {
    expect(cleanRelations([{ from: "美國", to: "烏克蘭", type: "軍援" }, { from: " 美國 ", to: "烏克蘭", type: "軍援" }])).toEqual([
      { from: "美國", to: "烏克蘭", type: "軍援" },
    ]);
    expect(cleanRelations([{ from: "A", to: "", type: "x" }, { from: "A", to: "B" }])).toBe(undefined); // missing/empty fields
    expect(cleanRelations([{ from: "a".repeat(30), to: "B", type: "t" }])).toBe(undefined); // too long
    expect(
      cleanRelations(Array.from({ length: 12 }, (_, i) => ({ from: `甲${i}`, to: `乙${i}`, type: "關" }))).length,
    ).toBe(8); // caps at 8
    expect(cleanRelations("not-array")).toBe(undefined);
    expect(cleanRelations([])).toBe(undefined);
  });

  it("buildDeepAnalysisPrompt: 2-message prompt embedding the event fields", () => {
    const msgs = buildDeepAnalysisPrompt({
      title: "南海對峙升溫",
      region: "南海",
      category: "地緣政治",
      riskLevel: "critical",
      summary: "兩國艦艇對峙",
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
    expect(msgs[1].content).toContain("南海對峙升溫");
    expect(msgs[1].content).toContain("兩國艦艇對峙");
    expect(msgs[1].content).toContain("影響評估");
  });
});

describe("applyDomesticCountyLocation（國內縣市定位 fallback）", () => {
  it("region 為「全國」時對標題＋摘要＋原文描述做縣市 fallback（台17線案例）", () => {
    const ev = applyDomesticCountyLocation(
      {
        region: "全國",
        title: "省道台17線 115K+0 道路封閉",
        summary: "道路封閉示警",
      },
      "嘉義縣 東石鄉 台17線 115K+0 道路封閉，請用路人改道。",
    );
    expect(ev).toMatchObject({ region: "嘉義縣", locationPrecision: "city" });
    expect(ev.lat).toBeCloseTo(23.4518, 3);
    expect(ev.lng).toBeCloseTo(120.2555, 3);
  });

  it("region 已是縣市全名時不吃 fallback", () => {
    const ev = applyDomesticCountyLocation(
      { region: "高雄市", title: "事件標題", summary: "嘉義縣出現在摘要" },
      "嘉義縣",
    );
    expect(ev.region).toBe("高雄市");
  });

  it("region 為短名（非縣市全名）時用短名比對", () => {
    const ev = applyDomesticCountyLocation({ region: "新北", title: "事件", summary: "摘要" });
    expect(ev.region).toBe("新北市");
    expect(ev.lat).toEqual(expect.any(Number));
  });

  it("region、標題、摘要、原文全部無縣市時才保留「全國」", () => {
    const ev = applyDomesticCountyLocation(
      { region: "全國", title: "全國性政策說明會", summary: "中央公告" },
      "行政院新聞稿",
    );
    expect(ev).toMatchObject({ region: "全國", lat: null, lng: null, locationPrecision: "unknown" });
  });

  it("fallback 原文先剝發稿地、取最早出現縣市（宜蘭報導不被新北市蓋過）", () => {
    const ev = applyDomesticCountyLocation(
      { region: "全國", title: "寺廟住持涉侵占信徒捐款 檢方偵結", summary: "檢方偵辦" },
      "〔記者江志雄／宜蘭報導〕宜蘭彌陀之家東林寺住持釋見寰，遭控侵占信徒捐款，並搜索其新北市住處。",
    );
    expect(ev.region).toBe("宜蘭縣");
  });

  it("已有較精確 locationPrecision（exact/address/district）不被覆蓋成 city", () => {
    for (const locationPrecision of ["exact", "address", "district"]) {
      const ev = applyDomesticCountyLocation(
        {
          region: "全國",
          title: "幾何座標事件",
          summary: "高雄市出現在摘要",
          lat: 24.15,
          lng: 120.68,
          locationPrecision,
        },
        "高雄市",
      );
      expect(ev).toMatchObject({ lat: 24.15, lng: 120.68, locationPrecision });
    }
  });

  it("已有 exact 座標仍照常補 region（座標與精度保留）", () => {
    const ev = applyDomesticCountyLocation({
      region: "全國",
      title: "高雄市火警",
      summary: "",
      lat: 22.63,
      lng: 120.3,
      locationPrecision: "exact",
    });
    expect(ev).toMatchObject({ region: "高雄市", lat: 22.63, lng: 120.3, locationPrecision: "exact" });
  });

  it("LLM fallback 與 bulk 路徑對同一標題判定一致（高雄車禍 新北警協助 → 新北市）", () => {
    const title = "高雄車禍 新北警協助";
    const llm = applyDomesticCountyLocation({ region: "全國", title, summary: "" });
    const [bulk] = mapBulkNews(
      [{ title, link: "https://x/consistent", description: "", source: "s", sourceUrl: "u", hint: "治安", pubDate: "x" }],
      { fetchedAt: "2026-07-25T00:00:00.000Z" },
    );
    expect(bulk.region).toBe("新北市");
    expect(llm.region).toBe(bulk.region);
  });

  it("短名 region 只作最後備援：標題/摘要命中優先，皆無命中才用短名 region", () => {
    const ev = applyDomesticCountyLocation({ region: "北市", title: "高雄火警", summary: "高雄市工廠火災" });
    expect(ev.region).toBe("高雄市");
    const fallback = applyDomesticCountyLocation({ region: "北市", title: "工廠火警", summary: "設備起火" });
    expect(fallback.region).toBe("臺北市");
  });

  it("署名剝除只限開頭署名結構（括號內「通訊設備」不誤剝）且支援全形方括號", () => {
    const ev = applyDomesticCountyLocation(
      { region: "全國", title: "通訊設備起火", summary: "" },
      "〔記者王明／台北報導〕（高雄市通訊設備起火）新北市警方協助調查。",
    );
    expect(ev.region).toBe("高雄市");
    const fullwidth = applyDomesticCountyLocation(
      { region: "全國", title: "火警", summary: "" },
      "［記者王明／台北報導］高雄市發生火警。",
    );
    expect(fullwidth.region).toBe("高雄市");
  });
});

describe("TW_CATEGORIES 新主題分類", () => {
  it("含四個新分類（LLM 精修不再把新主題 clamp 回社會）", () => {
    for (const c of ["食安", "衛生", "環境", "資安"]) expect(TW_CATEGORIES).toContain(c);
    for (const c of ["治安", "社會", "交通", "災防", "反詐"]) expect(TW_CATEGORIES).toContain(c);
  });
});
