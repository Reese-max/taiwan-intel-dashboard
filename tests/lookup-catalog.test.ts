import { describe, it, expect } from "vitest";
import { validateDatasetId, normalizeCatalog, normalizeDatasetPreview } from "../server/normalize.mjs";

describe("validateDatasetId", () => {
  it("accepts digit ids and slug ids", () => {
    expect(validateDatasetId("102772")).toBe("102772");
    expect(validateDatasetId(" taipei-crime ")).toBe("taipei-crime");
  });
  it("rejects empty and unsafe ids", () => {
    expect(() => validateDatasetId("")).toThrow();
    expect(() => validateDatasetId("a;b")).toThrow();
    expect(() => validateDatasetId("a' OR '1")).toThrow();
    expect(() => validateDatasetId("a".repeat(65))).toThrow();
  });
});

describe("normalizeCatalog", () => {
  const parsed = {
    hits: [
      {
        dataset_id: "102772",
        name: "臺南市停車場即時剩餘車位資訊",
        agency: "臺南市政府交通局",
        primary_domain: "transport",
        domains: ["transport"],
        update_freq: "不定期更新",
        quality_tier: "白金",
        formats: ["JSON"],
        is_normalised: true,
        geo_has_latlon: false,
        geo_has_twd97: false,
      },
      {
        dataset_id: "122902",
        name: "新北市公有路外停車場即時賸餘車位數",
        agency: "新北市政府交通局",
        primary_domain: "transport",
        domains: ["transport"],
        update_freq: "每3分",
        quality_tier: "無(白名單)",
        formats: ["CSV"],
        is_normalised: true,
        geo_has_latlon: true,
        geo_has_twd97: false,
      },
    ],
    count: 2,
  };

  it("maps dataset cards with key metadata", () => {
    const out = normalizeCatalog({ query: "停車場", parsed });
    expect(out.count).toBe(2);
    expect(out.datasets).toHaveLength(2);
    const d0 = out.datasets[0];
    expect(d0.id).toBe("102772");
    expect(d0.name).toBe("臺南市停車場即時剩餘車位資訊");
    expect(d0.agency).toBe("臺南市政府交通局");
    expect(d0.domain).toBe("transport");
    expect(d0.updateFreq).toBe("不定期更新");
    expect(d0.quality).toBe("白金");
    expect(d0.formats).toEqual(["JSON"]);
    expect(out.datasets[1].hasGeo).toBe(true);
  });

  it("returns empty datasets for no hits", () => {
    expect(normalizeCatalog({ query: "x", parsed: { hits: [], count: 0 } }).datasets).toEqual([]);
  });
});

describe("normalizeDatasetPreview", () => {
  const big = { columns: ["a", "b"], rows: Array.from({ length: 80 }, (_, i) => [String(i), "x"]) };

  it("passes columns and caps rows, reporting true total", () => {
    const out = normalizeDatasetPreview({ id: "102772", parsed: big });
    expect(out.id).toBe("102772");
    expect(out.columns).toEqual(["a", "b"]);
    expect(out.rows.length).toBeLessThanOrEqual(50);
    expect(out.rowCount).toBe(80);
  });

  it("tolerates empty / missing fields", () => {
    const out = normalizeDatasetPreview({ id: "x", parsed: {} });
    expect(out.columns).toEqual([]);
    expect(out.rows).toEqual([]);
    expect(out.rowCount).toBe(0);
  });
});
