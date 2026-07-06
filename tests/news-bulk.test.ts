import { describe, it, expect } from "vitest";
import {
  mapBulkNews,
  titleKey,
  cleanTitle,
  categoryFromItem,
  isForeignNonTaiwan,
  isNonEventNoise,
  isRelevantNewsItem,
  riskFromTitle,
} from "../scripts/lib/news-bulk.mjs";

const FETCHED_AT = "2026-06-20T00:00:00.000Z";

const ITEMS = [
  { title: "高雄街頭砍人 男子背部受傷送醫 - 自由時報", link: "https://x/1", description: "街頭鬥毆", source: "自由時報 社會", sourceUrl: "u1", hint: "治安", pubDate: "Fri, 20 Jun 2026 01:00:00 +0800" },
  { title: "新北詐騙集團車手落網", link: "https://news.google.com/rss/articles/2?oc=5", description: "假檢警詐騙", source: "GN 詐騙逮捕", sourceUrl: "https://news.google.com/rss/search?q=詐騙逮捕", hint: "反詐", pubDate: "Fri, 20 Jun 2026 02:00:00 +0800" },
  { title: "台南工廠火警濃煙竄天", link: "https://news.google.com/rss/articles/3?oc=5", description: "消防搶救", source: "GN 火警氣爆", sourceUrl: "https://news.google.com/rss/search?q=火警氣爆", hint: "災防", pubDate: "Fri, 20 Jun 2026 03:00:00 +0800" },
  // 重複標題（不同連結/媒體）→ 去重
  { title: "高雄街頭砍人 男子背部受傷送醫 - ETtoday", link: "https://x/4", description: "...", source: "GN 傷害鬥毆", sourceUrl: "u4", hint: "治安", pubDate: "x" },
];

describe("titleKey / cleanTitle", () => {
  it("strips media suffix for dedup key and display", () => {
    expect(cleanTitle("高雄街頭砍人 - 自由時報")).toBe("高雄街頭砍人");
    expect(titleKey("高雄街頭砍人 - 自由時報")).toBe(titleKey("高雄街頭砍人 - ETtoday"));
  });
});

describe("mapBulkNews", () => {
  it("標記 bulk categoryBasis：rule / hint / default，且 category 判定不變", () => {
    expect(categoryFromItem("新北詐騙集團車手落網", "治安")).toEqual({
      category: "反詐",
      basis: "rule:反詐",
    });
    expect(categoryFromItem("醫院資訊系統遭駭客攻擊 個資外洩", "資安")).toEqual({
      category: "資安",
      basis: "hint:資安",
    });
    expect(categoryFromItem("高雄街頭砍人 男子背部受傷送醫", undefined)).toEqual({
      category: "治安",
      basis: "default",
    });
  });

  it("協尋規則：失蹤/走失/尋人細分出協尋，且不搶災防/反詐既有規則", () => {
    expect(categoryFromItem("8旬失智翁走失2天 警調閱監視器尋獲", "治安")).toEqual({
      category: "協尋",
      basis: "rule:協尋",
    });
    expect(categoryFromItem("15歲少女離家失聯 家屬急尋人", "治安")).toEqual({
      category: "協尋",
      basis: "rule:協尋",
    });
    // 災防語境優先：溺水/搜救類失蹤維持災防。
    expect(categoryFromItem("東港漁民落海失蹤 海巡搜救中", "治安").category).toBe("災防");
    // 反詐優先：詐團話術含失聯不得改判協尋。
    expect(categoryFromItem("假投資群組收錢後失聯 受害者報案", "治安").category).toBe("反詐");
    // 一般治安不受影響。
    expect(categoryFromItem("持刀搶超商 嫌犯落網", "治安").category).toBe("治安");
    // 負向排除：失聯移工查緝、命案報導、通緝逃亡、詐團失聯話術皆非尋人。
    expect(categoryFromItem("桃警攔違停意外逮6失聯移工 車內通緝犯落網", "治安").category).toBe("治安");
    expect(categoryFromItem("泰山姊弟命案 失聯父遺體今相驗", "治安").category).toBe("治安");
    expect(categoryFromItem("醫美負責人境外失聯 不甩檢方遭通緝", "治安").category).toBe("治安");
    expect(categoryFromItem("匯數萬元買裝備 對方一句查帳中秒失聯被騙", "反詐").category).toBe("反詐");
  });

  it("dedupes by title, classifies by hint, geocodes by county, scores risk", () => {
    const ev = mapBulkNews(ITEMS, { fetchedAt: FETCHED_AT });
    expect(ev).toHaveLength(3); // 去重後 3
    const ks = ev.find((e) => e.title.includes("砍人"));
    expect(ks!.region).toBe("高雄市");
    expect(ks!.lat).toBeCloseTo(22.6273, 2);
    expect(ks!.category).toBe("治安");
    expect(ks!.categoryBasis).toBe("hint:治安");
    expect(ks!.riskLevel).toBe("high"); // 砍人
    expect(ks!.scope).toBe("domestic");
    expect(ks!.source.datasetId).toBe("tw-news");

    const fraud = ev.find((e) => e.title.includes("車手"));
    expect(fraud!.region).toBe("新北市");
    expect(fraud!.category).toBe("反詐");
    expect(fraud!.categoryBasis).toBe("rule:反詐");
    expect(fraud!.riskLevel).toBe("medium"); // 詐騙
    expect(fraud!.source.name.startsWith("GN ")).toBe(false);
    expect(fraud!.source.aggregatorName).toBe("Google News");
    expect(fraud!.locationPrecision).toBe("city");

    const fire = ev.find((e) => e.title.includes("火警"));
    expect(fire!.region).toBe("臺南市");
    expect(fire!.category).toBe("災防");
    expect(fire!.categoryBasis).toBe("rule:災防");
  });

  it("excludes titles already enriched", () => {
    const exclude = new Set([titleKey("高雄街頭砍人 男子背部受傷送醫 - 自由時報")]);
    const ev = mapBulkNews(ITEMS, { fetchedAt: FETCHED_AT, excludeKeys: exclude });
    expect(ev.find((e) => e.title.includes("砍人"))).toBeUndefined();
    expect(ev).toHaveLength(2);
  });

  it("filters out non-police items (health/culture/policy noise)", () => {
    const noise = [
      { title: "癌症篩檢抽大獎 嘉義縣送iPhone 17", link: "https://x/a", description: "鼓勵民眾顧健康", source: "s", sourceUrl: "u", hint: "治安", pubDate: "x" },
      { title: "新北市躋身全球幸福城市前50名", link: "https://x/b", description: "英國評比", source: "s", sourceUrl: "u", hint: "治安", pubDate: "x" },
      { title: "高雄街頭砍人送醫", link: "https://x/c", description: "", source: "s", sourceUrl: "u", hint: "治安", pubDate: "x" },
    ];
    const ev = mapBulkNews(noise, { fetchedAt: FETCHED_AT });
    expect(ev).toHaveLength(1); // 只留砍人
    expect(ev[0].title).toContain("砍人");
  });

  it("falls back to 全國 with null coords when no county in title", () => {
    const ev = mapBulkNews(
      [{ title: "立委質詢打詐成效", link: "https://x/9", description: "", source: "s", sourceUrl: "u", hint: "反詐", pubDate: "x" }],
      { fetchedAt: FETCHED_AT },
    );
    expect(ev[0].region).toBe("全國");
    expect(ev[0].lat).toBeNull();
  });
});

describe("isRelevantNewsItem（hint 分派主題漏斗）", () => {
  const mk = (title: string, hint: string, description = "") => ({
    title,
    hint,
    description,
    link: "https://x/t",
    source: "s",
    sourceUrl: "u",
    pubDate: "x",
  });

  it("食安 hint 用食安關鍵字（不再被警政漏斗擋掉）", () => {
    expect(isRelevantNewsItem(mk("知名餐廳使用餿水油遭勒令下架", "食安"))).toBe(true);
    expect(isRelevantNewsItem(mk("農委會推廣有機農業補助說明會", "食安"))).toBe(false);
  });

  it("衛生 hint 用衛生關鍵字", () => {
    expect(isRelevantNewsItem(mk("腸病毒疫情升溫 幼兒園爆群聚", "衛生"))).toBe(true);
    expect(isRelevantNewsItem(mk("醫院擴建工程動土典禮", "衛生"))).toBe(false);
  });

  it("環境 hint 用環境關鍵字", () => {
    expect(isRelevantNewsItem(mk("電鍍廠偷排廢水遭裁罰百萬", "環境"))).toBe(true);
    expect(isRelevantNewsItem(mk("公園綠美化志工招募", "環境"))).toBe(false);
  });

  it("資安 hint 用資安關鍵字", () => {
    expect(isRelevantNewsItem(mk("駭客入侵上市公司 個資外洩百萬筆", "資安"))).toBe(true);
    expect(isRelevantNewsItem(mk("新款筆電開箱評測", "資安"))).toBe(false);
    expect(isRelevantNewsItem(mk("南投仁愛鄉土石流紅色警戒 對外道路坍方", "資安"))).toBe(false);
  });

  it("食安 hint 涵蓋動物疫病爆發（農業部 feed 分診：H5N1 確診遭誤殺）", () => {
    expect(isRelevantNewsItem(mk("屏東高樹蛋中雞確診H5N1高原病性禽流感，請業者落實各項生物安全工作", "食安"))).toBe(true);
    expect(isRelevantNewsItem(mk("彰化雞場爆禽流感疫情 撲殺上萬隻蛋雞", "食安"))).toBe(true);
    // 行政公告/知識文章仍須擋下（高精度：認事件詞，不認病名）。
    expect(isRelevantNewsItem(mk("修正「豬瘟檢驗方法」，並自即日生效", "食安"))).toBe(false);
    expect(isRelevantNewsItem(mk("「Ｏ型口蹄疫東南亞株」之簡介與防治宣導單張", "食安"))).toBe(false);
    expect(isRelevantNewsItem(mk("紐西蘭產食用馬鈴薯輸入檢疫條件", "食安"))).toBe(false);
    expect(isRelevantNewsItem(mk("2026台北國際食品展「台灣館」盛大登場", "食安"))).toBe(false);
  });

  it("災防 hint 用災害預警與事故傷亡關鍵字", () => {
    expect(isRelevantNewsItem(mk("南投仁愛鄉土石流紅色警戒 對外道路坍方", "災防"))).toBe(true);
    expect(isRelevantNewsItem(mk("台8線邊坡滑動預警 預防性封閉", "災防"))).toBe(true);
    expect(isRelevantNewsItem(mk("民宅火警2人送醫", "災防"))).toBe(true);
    expect(isRelevantNewsItem(mk("全民防災週系列宣導起跑", "災防"))).toBe(false);
  });

  it("未列 TOPIC_RE 的 hint 照舊走警政漏斗（回歸保護）", () => {
    expect(isRelevantNewsItem(mk("高雄街頭砍人送醫", "治安"))).toBe(true);
    expect(isRelevantNewsItem(mk("新北市躋身全球幸福城市前50名", "治安"))).toBe(false);
    expect(isRelevantNewsItem(mk("球團回應打假球傳聞 聯盟啟動調查", "治安"))).toBe(true);
  });
});

describe("isForeignNonTaiwan（bulk domestic 純外國負面閘門）", () => {
  const mk = (title: string, hint = "災防", description = "") => ({
    title,
    hint,
    description,
    link: `https://x/${encodeURIComponent(title)}`,
    source: "Google News",
    sourceUrl: "u",
    pubDate: "x",
  });

  it("必移明確外國且無台灣關聯事件，不成為 bulk domestic 事件", () => {
    const foreignOnly = [
      mk("委內瑞拉強震2600死"),
      mk("巴基斯坦客運墜深谷 已知40死"),
      mk("俄羅斯襲基輔至少17死"),
      mk("奈及利亞爆發流血衝突釀48死"),
      mk("法國熱浪已導致千人喪命"),
      // 2026-07-06 災防漏斗聯集後實測漏網：地名/語境不在表內的純外國災難。
      mk("洪災不斷！祕魯狂暴土石流女子連人帶房被沖走"),
      mk("象牙海岸暴雨成災！雨季剛開始已奪59命 經濟首都成重災區"),
      mk("印度孟買暴雨成災！貧民窟房屋倒塌奪6命、交通大癱瘓"),
      mk("丹佛西南山火迫數千人疏散 焚毀超160建築"),
    ];

    for (const item of foreignOnly) {
      expect(isForeignNonTaiwan(item), item.title).toBe(true);
      expect(isRelevantNewsItem(item), item.title).toBe(false);
    }
    // negated-context：「與台灣無關」不算台灣關聯，純外國災難仍移除。
    expect(isForeignNonTaiwan({
      ...mk("委內瑞拉強震釀2600死 逾萬人無家可歸"),
      summary: "此震災與台灣無直接關聯。",
    })).toBe(true);

    expect(mapBulkNews(foreignOnly, { fetchedAt: FETCHED_AT })).toHaveLength(0);
  });

  it("必留含台灣關聯、資安豁免與無外國地名的正常台灣事件", () => {
    const mustKeep = [
      mk("台灣捐款委內瑞拉震災"),
      mk("台商在越南工廠火災"),
      mk("國人在日本遇車禍身亡"),
      mk("外交部關切加薩情勢"),
      mk("南韓酷澎個資外洩", "資安"),
      mk("高雄街頭砍人送醫", "治安"),
      mk("新北詐騙集團車手落網", "反詐"),
      mk("颱風來襲 氣象署發警報", "災防"),
    ];

    for (const item of mustKeep) {
      expect(isForeignNonTaiwan(item), item.title).toBe(false);
    }

    const domesticContextMustKeep = [
      mk("林口大賣場隨機砍人 印度籍男遭砍傷", "治安"),
      mk("內政部：依托咪酯走私來源部分來自越南或馬來西亞", "治安"),
      mk("越南移工二林溪抓螃蟹失聯 消防救援上岸已死亡", "災防"),
      mk("台德合作偵破液態K他命德國走私來台", "治安"),
      // 收窄回歸：這些含外國地名但屬台灣事件/豁免類，廣版曾誤刪，須保留。
      mk("去日本都看過通緝令！八田與一逃亡4年抓嘸 警擴大緝捕", "治安"), // 台語「抓嘸」台灣通緝案
      mk("美國豆換巴西豆引食安風暴? 中聯油脂：產季輪換", "食安"), // 台廠食安（食安豁免）
      mk("緬甸三佛塔成電詐園區新據點 陸退伍軍人淪豬仔", "反詐"), // 詐騙園區（反詐豁免、國人相關）
      mk("新加坡修法加重打詐 涉詐最高可處24下鞭刑", "反詐"), // 打詐借鏡（反詐豁免）
      // 收窄行為：外國一般犯罪（無天災/戰爭/大量傷亡）不再過濾，保留以免誤刪台灣邊案。
      mk("東京上野餐廳老闆遭殺害棄屍 2共犯判刑30年", "治安"),
      // T8-17 回歸保護：新增地名/語境不可誤殺台灣關聯或台灣本地事件。
      mk("祕魯強震 外交部：目前無國人傷亡", "治安"),
      mk("新竹626豪雨成災 議員質疑整修工程", "災防"),
    ];
    for (const item of domesticContextMustKeep) {
      expect(isForeignNonTaiwan(item), item.title).toBe(false);
    }
    expect(isForeignNonTaiwan({ title: "南韓酷澎個資外洩", category: "資安" })).toBe(false);

    expect(isRelevantNewsItem(mustKeep[0])).toBe(false);
    expect(isRelevantNewsItem(mustKeep[1])).toBe(true);
    expect(isRelevantNewsItem(mustKeep[2])).toBe(true);
    expect(isRelevantNewsItem(mustKeep[3])).toBe(false);
    expect(isRelevantNewsItem(mustKeep[4])).toBe(true);
    expect(isRelevantNewsItem(mustKeep[5])).toBe(true);
    expect(isRelevantNewsItem(mustKeep[6])).toBe(true);
    expect(isRelevantNewsItem(mustKeep[7])).toBe(true);

    const bulkEvents = mapBulkNews(mustKeep, { fetchedAt: FETCHED_AT });
    expect(bulkEvents.map((event) => event.title)).toEqual([
      "台商在越南工廠火災",
      "國人在日本遇車禍身亡",
      "南韓酷澎個資外洩",
      "高雄街頭砍人送醫",
      "新北詐騙集團車手落網",
      "颱風來襲 氣象署發警報",
    ]);
  });
});

describe("isNonEventNoise / bulk domestic 負面閘門", () => {
  const mk = (title: string, hint = "環境", description = "", source = "Google News") => ({
    title,
    hint,
    description,
    link: `https://x/${encodeURIComponent(title)}`,
    source,
    sourceUrl: "u",
    pubDate: "x",
  });

  it("必剔高確定性 landing page / 參考頁 / 娛樂劇情雜訊", () => {
    const noise = [
      mk("Vares 空氣品質指數（AQI）和波斯尼亞 空氣污染 | IQAir"),
      mk("Annobon 空氣品質指數（AQI）和赤道幾內亞 空氣污染 | IQAir"),
      mk("固定空氣污染源管理資訊系統-環境部"),
      mk("列管污染源資料查詢系統"),
      mk("持久性有機污染物(POPs)資訊網站"),
      mk("國家溫室氣體排放清冊報告"),
      mk("環保稽查處分管制系統"),
      mk("非份之罪劇透1-10集｜賴慰玲捲石棺命案", "治安"),
      mk("玩命關頭11線上看 完整版預告片", "治安"),
    ];

    for (const item of noise) {
      expect(isNonEventNoise(item), item.title).toBe(true);
    }

    const ev = mapBulkNews(noise, { fetchedAt: FETCHED_AT });
    expect(ev).toHaveLength(0);
  });

  it("必留真實 bulk 事件，避免誤殺犯罪/交通/災防/環境/食安/衛生事件", () => {
    const events = [
      mk("雨後巨量海廢淹沒林園貝殼灣 志工淨灘清出268公斤", "環境"),
      mk("苗栗台13線死亡車禍 重機男過彎自撞墜橋亡", "交通"),
      mk("台中豐原透天厝火警 72歲翁全身72%燒燙傷", "災防"),
      mk("雲林全面下架問題大豆油 54家業者稽查 423件產品急回收", "食安"),
      mk("屏東旅館驚見冰鎮女屍 高大成相驗：死因與毒品有關", "治安"),
      mk("高雄工廠偷排廢水遭稽查裁罰", "環境"),
      mk("知名餐廳使用餿水油遭勒令下架", "食安"),
      mk("腸病毒疫情升溫 幼兒園爆群聚", "衛生"),
      mk("台南工廠火警濃煙竄天 消防搶救", "災防"),
      mk("新北詐騙集團車手落網", "反詐"),
      mk("高雄街頭砍人 男子背部受傷送醫", "治安"),
      mk("警方破獲個資外洩詐騙系統 逮捕嫌犯", "治安"),
      mk("醫院資訊系統遭駭客攻擊 個資外洩", "資安"),
      mk("食藥署稽查違規食品 下架回收", "食安"),
      mk("賽道狂人、冰雪奇緣2線上看？LINE帳號恐遭登入盜用", "反詐"),
    ];

    for (const item of events) {
      expect(isNonEventNoise(item), item.title).toBe(false);
    }

    const relevantEvents = events.filter(isRelevantNewsItem);
    const ev = mapBulkNews(relevantEvents, { fetchedAt: FETCHED_AT });
    expect(ev).toHaveLength(relevantEvents.length);
  });
});

describe("mapBulkNews 新主題分類", () => {
  it("食安/環境/資安 item 入庫且歸到自己的分類", () => {
    const items = [
      {
        title: "台中查獲黑心食品工廠",
        link: "https://x/f1",
        description: "",
        source: "GN 食安黑心",
        sourceUrl: "u",
        hint: "食安",
        pubDate: "x",
      },
      {
        title: "高雄工廠偷排廢水遭稽查裁罰",
        link: "https://x/e1",
        description: "",
        source: "環境部官網",
        sourceUrl: "u",
        hint: "環境",
        pubDate: "x",
      },
      {
        title: "勒索病毒攻擊醫院系統 個資外洩",
        link: "https://x/c1",
        description: "",
        source: "TechNews",
        sourceUrl: "u",
        hint: "資安",
        pubDate: "x",
      },
    ];
    const ev = mapBulkNews(items, { fetchedAt: FETCHED_AT });
    expect(ev).toHaveLength(3);
    expect(ev.find((e) => e.title.includes("黑心"))!.category).toBe("食安");
    expect(ev.find((e) => e.title.includes("廢水"))!.category).toBe("環境");
    expect(ev.find((e) => e.title.includes("勒索病毒"))!.category).toBe("資安");
  });
});

describe("EN 來源支援（Focus Taiwan / Taipei Times）", () => {
  const mk = (title: string) => ({ title, hint: "治安", description: "", link: "https://x/en", source: "Focus Taiwan (EN)", sourceUrl: "u", pubDate: "x" });

  it("英文警政標題通過相關性漏斗", () => {
    expect(isRelevantNewsItem(mk("Police arrest fraud ring leader in Taipei"))).toBe(true);
    expect(isRelevantNewsItem(mk("Drug smuggling suspects detained at port"))).toBe(true);
    expect(isRelevantNewsItem(mk("Taiwan shares close higher on tech gains"))).toBe(false);
  });

  it("英文標題風險評級正確（不再全判 low）", () => {
    const ev = mapBulkNews(
      [
        { ...mk("Man killed in Kaohsiung shooting incident"), link: "https://x/en1" },
        { ...mk("Police arrest fraud suspects in Taichung"), link: "https://x/en2" },
      ],
      { fetchedAt: FETCHED_AT },
    );
    expect(ev.find((e) => e.title.includes("killed"))!.riskLevel).toBe("high");
    expect(ev.find((e) => e.title.includes("fraud"))!.riskLevel).toBe("medium");
  });
});

describe("riskFromTitle 主題感知", () => {
  it("重大傷亡與大規模事件升為 critical，但一般重案不灌水", () => {
    expect(riskFromTitle("台中隨機殺人釀3死", "治安")).toBe("critical");
    expect(riskFromTitle("新北氣爆釀2死 多人送醫", "災防")).toBe("critical");
    expect(riskFromTitle("高雄命案嫌犯落網", "治安")).toBe("high");
  });

  it("依 hint 套用主題高風險關鍵字優先，維持警政備援", () => {
    expect(riskFromTitle("餿水油流入市面 廠商遭起訴", "食安")).toBe("high");
    expect(riskFromTitle("黑心廠商瘦肉精超標遭下架", "食安")).toBe("medium");
    expect(riskFromTitle("食安稽查員遭殺害", "食安")).toBe("high");
    expect(riskFromTitle("醫院爆院內感染 2 死", "衛生")).toBe("high");
    expect(riskFromTitle("北部群聚確診再增", "衛生")).toBe("medium");
    expect(riskFromTitle("工廠毒物外洩 居民急疏散", "環境")).toBe("high");
    expect(riskFromTitle("電鍍廠偷排廢水遭裁罰", "環境")).toBe("medium");
    expect(riskFromTitle("駭客勒索病毒癱瘓醫院系統", "資安")).toBe("high");
    expect(riskFromTitle("電商個資外洩", "資安")).toBe("medium");
  });

  it("無 hint 時維持既有警政風險邏輯", () => {
    expect(riskFromTitle("北部群聚確診再增")).toBe("low");
    expect(riskFromTitle("公安局深夜緝毒失聯槍擊")).toBe("high");
    expect(riskFromTitle("反詐宣導說明會", "反詐")).toBe("low");
  });

  it("資安事件不靠 hint 也會全域升級，且大規模個資外洩升 high", () => {
    expect(riskFromTitle("駭客公開勒索200萬美金 台灣上市櫃企業", "治安")).toBe("high");
    expect(riskFromTitle("醫院遭駭癱瘓系統")).toBe("high");
    expect(riskFromTitle("3370萬筆個資外洩")).toBe("high");
    expect(riskFromTitle("9300萬筆個資遭竊", "治安")).toBe("high");
    expect(riskFromTitle("某公司資料庫個資外洩")).toBe("medium");
  });

  it("資安非事件與宣導教育產品語境不因資安詞誤升", () => {
    expect(riskFromTitle("個資保護法宣導講座", "資安")).toBe("low");
    expect(riskFromTitle("校園資安意識研習", "資安")).toBe("low");
    expect(riskFromTitle("大學生駭客松競賽", "資安")).toBe("low");
    expect(riskFromTitle("新款防毒軟體上市開箱", "資安")).toBe("low");
  });

  it("死亡與武裝暴力同義詞至少升 high，補回 bulk 致死漏報", () => {
    expect(riskFromTitle("高雄60多歲男遭刺殺不治倒臥住家", "治安")).toBe("high");
    expect(riskFromTitle("高雄男疑債務糾紛家門口中2刀不治", "治安")).toBe("high");
    expect(riskFromTitle("彰化男子失去生命徵象送醫不治", "災防")).toBe("high");
    expect(riskFromTitle("登玉山失足墜50米邊坡傷重不治", "災防")).toBe("high");
    expect(riskFromTitle("桃園街頭槍手開3槍", "治安")).toBe("high");
    expect(riskFromTitle("苗栗車禍1人死亡", "災防")).toBe("high");
    expect(riskFromTitle("中壢4死案", "治安")).toBe("high");
  });

  it("二位數以上或十百千萬級死亡升 critical，個位數死亡不升 critical", () => {
    expect(riskFromTitle("委國雙強震近3,000死", "災防")).toBe("critical");
    expect(riskFromTitle("巴基斯坦客運墜深谷 已知40死", "災防")).toBe("critical");
    expect(riskFromTitle("俄羅斯襲基輔至少17死90多傷", "治安")).toBe("critical");
    expect(riskFromTitle("苗栗車禍1人死亡", "災防")).toBe("high");
    expect(riskFromTitle("中壢4死案", "治安")).toBe("high");
  });

  it("死亡字面雜訊與無傷亡反向詞不誤升", () => {
    expect(riskFromTitle("生死關頭消防員即時救援", "災防")).toBe("low");
    expect(riskFromTitle("打詐死角 立委籲補強", "治安")).toBe("low");
    expect(riskFromTitle("無人傷亡的住宅火警", "災防")).toBe("medium");
    expect(riskFromTitle("交通安全宣導記者會", "災防")).toBe("low");
  });
});
