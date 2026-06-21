import { describe, it, expect } from "vitest";
import {
  validateQuery,
  sqlEscape,
  normalizeFraud,
  normalizeJudicial,
  normalizeDrug,
} from "../server/normalize.mjs";

describe("validateQuery", () => {
  it("trims and accepts a normal query", () => {
    expect(validateQuery("  bet365.com  ")).toBe("bet365.com");
  });
  it("rejects empty / whitespace-only", () => {
    expect(() => validateQuery("")).toThrow();
    expect(() => validateQuery("   ")).toThrow();
    expect(() => validateQuery(undefined as unknown as string)).toThrow();
  });
  it("rejects over-long input (>200)", () => {
    expect(() => validateQuery("a".repeat(201))).toThrow();
  });
});

describe("sqlEscape", () => {
  it("doubles single quotes to prevent breaking the string literal", () => {
    expect(sqlEscape("o'brien")).toBe("o''brien");
  });
  it("strips control chars and semicolons but keeps internal spaces", () => {
    expect(sqlEscape("abc;DROP")).toBe("abcDROP");
    expect(sqlEscape("假投資 博弈")).toBe("假投資 博弈");
  });
});

describe("normalizeFraud", () => {
  const stopped = {
    columns: ["民國年月", "網域", "網站性質", "法律依據", "聲請單位"],
    rows: [["11412", "bbhhshf.cc", "金融保險", "詐欺犯罪危害防制條例", "刑事警察局詐欺犯罪防制中心"]],
  };
  const gambling = {
    columns: ["WEBSITE_NM", "WEBURL", "CNT", "STA_SDATE", "STA_EDATE"],
    rows: [
      ["網站名稱", "網址", "件數", "統計起始日期", "統計結束日期"],
      ["0857娛樂城", "www.0857.games", "1", "2023/12/12", "2023/12/18"],
    ],
  };
  const debunk = {
    columns: ["編號", "標題", "發佈時間", "發佈內容"],
    rows: [["2", "注意詐騙集團假冒台電簡訊詐騙", "2023/07/28 15:32", "台電公司提醒..."]],
  };

  it("shapes hits from three lists, filters stray header, flags matched", () => {
    const out = normalizeFraud({ query: "test", stopped, gambling, debunk });
    expect(out.matched).toBe(true);
    expect(out.hits).toHaveLength(3);
    const gam = out.hits.find((h) => h.source.includes("假投資"));
    expect(gam?.url).toBe("www.0857.games");
    expect(out.hits.some((h) => h.url === "網址")).toBe(false);
    expect(out.verdict).toContain("命中");
  });

  it("honestly reports a miss without implying safety", () => {
    const empty = { columns: stopped.columns, rows: [] };
    const out = normalizeFraud({
      query: "test",
      stopped: empty,
      gambling: { columns: gambling.columns, rows: [] },
      debunk: { columns: debunk.columns, rows: [] },
    });
    expect(out.matched).toBe(false);
    expect(out.hits).toHaveLength(0);
    expect(out.verdict).toContain("不代表安全");
  });
});

describe("normalizeJudicial", () => {
  const parsed = {
    hits: [
      {
        jid: "PCDM,114,審金簡,229,20251117,1",
        jtitle: "詐欺等",
        jdate: "20251117",
        court_code: "PCDM",
        issue: "被告提供金融帳戶供詐欺集團使用並轉匯款項，是否構成洗錢罪及應如何科刑。",
        outcome_type: "有罪",
        winner: "公訴方",
        sentence: "有期徒刑陸月，罰金新臺幣貳萬元",
        key_reasoning: "x".repeat(500),
        jpdf: "https://data.judicial.gov.tw/opendl/JDocFile/PCDM/foo.pdf",
        similarity: 0.783,
      },
      {
        jid: "TNDM,114,金訴,1796,20250619,1",
        jtitle: "洗錢防制法等",
        jdate: "20250619",
        court_code: "TNDM",
        jpdf: "https://data.judicial.gov.tw/opendl/JDocFile/TNDM/bar.pdf",
        similarity: 0.765,
      },
    ],
  };

  it("maps cases with key fields and truncates long reasoning", () => {
    const out = normalizeJudicial({ query: "詐欺", parsed });
    expect(out.cases).toHaveLength(2);
    const c0 = out.cases[0];
    expect(c0.title).toBe("詐欺等");
    expect(c0.court).toBe("PCDM");
    expect(c0.date).toBe("20251117");
    expect(c0.outcome).toBe("有罪");
    expect(c0.sentence).toContain("陸月");
    expect(c0.reasoning.length).toBeLessThanOrEqual(303);
    expect(c0.pdf).toContain("foo.pdf");
  });

  it("tolerates cases missing optional fields", () => {
    const out = normalizeJudicial({ query: "詐欺", parsed });
    const c1 = out.cases[1];
    expect(c1.title).toBe("洗錢防制法等");
    expect(c1.outcome).toBe("");
    expect(c1.sentence).toBe("");
  });

  it("returns empty cases for no hits", () => {
    expect(normalizeJudicial({ query: "x", parsed: { hits: [] } }).cases).toEqual([]);
  });
});

describe("normalizeDrug", () => {
  const parsed = {
    hits: [
      {
        license_no: "衛部藥輸字第027961號",
        name_zh: "鹽酸愷他命",
        name_en: "Ketamine Hydrochloride",
        indication: "全身麻醉劑。",
        dosage_form: "（粉）",
        controlled_class: "第三級管制藥品",
      },
      {
        license_no: "衛部藥輸字第027961號",
        name_zh: "鹽酸愷他命",
        name_en: "Ketamine Hydrochloride",
        indication: "全身麻醉劑。",
        dosage_form: "（粉）",
        controlled_class: "第三級管制藥品",
      },
    ],
  };

  it("dedupes and surfaces controlled class, always with an honest caveat", () => {
    const out = normalizeDrug({ query: "愷他命", parsed });
    expect(out.found).toBe(true);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].controlledClass).toBe("第三級管制藥品");
    expect(out.caveat).toContain("查無");
  });

  it("reports not-found with caveat (street drugs absent from licensing DB)", () => {
    const out = normalizeDrug({ query: "海洛因", parsed: { hits: [] } });
    expect(out.found).toBe(false);
    expect(out.items).toEqual([]);
    expect(out.caveat).toContain("毒品危害防制條例");
  });
});
