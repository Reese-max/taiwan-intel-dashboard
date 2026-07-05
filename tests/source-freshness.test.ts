import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { auditSourceFreshness } from "../scripts/audit-source-freshness.mjs";

const generatedAt = "2026-07-05T00:00:00.000Z";
const now = Date.parse(generatedAt);

const provenance = (sources: unknown[]) => ({ generatedAt, sources });

describe("auditSourceFreshness（來源新鮮度看門狗）", () => {
  it("結構化來源在門檻內 → ok", () => {
    const r = auditSourceFreshness(
      provenance([
        {
          name: "警政署 交通事故",
          type: "gov-open-data",
          category: "交通",
          lastSuccessAt: "2026-07-04T00:30:00.000Z",
        },
        {
          name: "中央氣象署 天氣警特報",
          type: "cwa",
          category: "災防",
          lastSuccessAt: "2026-07-04T19:00:00.000Z",
        },
      ]),
      { now },
    );

    expect(r.ok).toBe(true);
    expect(r.structuredChecked).toBe(2);
    expect(r.staleStructured).toHaveLength(0);
  });

  it("gov-open-data 源 age 5 天（>48h）→ 進 staleStructured", () => {
    const r = auditSourceFreshness(
      provenance([
        {
          name: "政府電子採購網 決標公告",
          type: "gov-open-data",
          category: "採購",
          lastSuccessAt: "2026-06-30T00:00:00.000Z",
        },
      ]),
      { now },
    );

    expect(r.ok).toBe(false);
    expect(r.staleStructured).toEqual([
      {
        name: "政府電子採購網 決標公告",
        type: "gov-open-data",
        category: "採購",
        ageHours: 120,
        threshold: 48,
      },
    ]);
  });

  it("news-rss 源 age 很久 → 不 gate，只加 newsStaleCount", () => {
    const r = auditSourceFreshness(
      provenance([
        {
          name: "台灣新聞：自由時報 社會",
          type: "news-rss",
          category: "治安",
          fetchedAt: "2026-06-25T00:00:00.000Z",
        },
      ]),
      { now },
    );

    expect(r.ok).toBe(true);
    expect(r.staleStructured).toHaveLength(0);
    expect(r.newsStaleCount).toBe(1);
  });

  it("無 lastSuccessAt 時用 fetchedAt 算", () => {
    const r = auditSourceFreshness(
      provenance([
        {
          name: "中央氣象署 顯著有感地震報告",
          type: "cwa",
          category: "災防",
          fetchedAt: "2026-07-04T12:00:00.000Z",
        },
      ]),
      { now },
    );

    expect(r.ok).toBe(false);
    expect(r.staleStructured[0]).toMatchObject({
      name: "中央氣象署 顯著有感地震報告",
      ageHours: 12,
      threshold: 6,
    });
  });

  it("generatedAt 可作固定 now 預設值", () => {
    const r = auditSourceFreshness(
      provenance([
        {
          name: "警政署 防空避難設施",
          type: "gov-open-data",
          category: "災防",
          lastSuccessAt: "2026-07-04T00:00:00.000Z",
        },
      ]),
    );

    expect(r.ok).toBe(true);
    expect(r.generatedAt).toBe(generatedAt);
    expect(r.worst).toEqual({ name: "警政署 防空避難設施", ageHours: 24 });
  });
});
