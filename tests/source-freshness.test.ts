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

  it("結構化來源本輪失敗且從未成功時，不得把本輪 fetchedAt 當成功時間", () => {
    const r = auditSourceFreshness(
      provenance([
        {
          name: "警政署 交通事故",
          type: "gov-open-data",
          category: "交通",
          fetchedAt: generatedAt,
          stale: true,
        },
      ]),
      { now },
    );

    expect(r.ok).toBe(false);
    expect(r.staleStructured[0]).toMatchObject({
      name: "警政署 交通事故",
      ageHours: null,
      reason: "no-success-timestamp",
    });
  });

  it("結構化來源本輪失敗但有近期成功快照時，仍依 lastSuccessAt 的寬限門檻判定", () => {
    const r = auditSourceFreshness(
      provenance([
        {
          name: "警政署 交通事故",
          type: "gov-open-data",
          category: "交通",
          fetchedAt: generatedAt,
          lastSuccessAt: "2026-07-04T12:00:00.000Z",
          stale: true,
        },
      ]),
      { now },
    );

    expect(r.ok).toBe(true);
  });

  it("來源可依官方更新頻率覆寫預設門檻", () => {
    const r = auditSourceFreshness(
      provenance([
        {
          name: "CDC 類流感急診就診人次",
          type: "gov-open-data",
          category: "衛生",
          lastSuccessAt: "2026-06-29T00:00:00.000Z",
          maxAgeHours: 192,
        },
      ]),
      { now },
    );
    expect(r.ok).toBe(true);
  });

  it("未設定必要憑證的可選來源列入資訊，但不冒充已檢查來源", () => {
    const r = auditSourceFreshness(
      provenance([
        {
          name: "未設定官方來源",
          type: "gov-open-data",
          category: "環境",
          configured: false,
          stale: true,
        },
      ]),
      { now },
    );
    expect(r.ok).toBe(true);
    expect(r.structuredChecked).toBe(0);
    expect(r.unconfiguredStructured).toEqual(["未設定官方來源"]);
  });

  it("本輪未嘗試（skippedThisRun）的陳舊來源 → 只警告不 gate（停擺後 hourly 自癒）", () => {
    const r = auditSourceFreshness(
      provenance([
        {
          name: "政府電子採購網 決標公告",
          type: "gov-open-data",
          category: "採購",
          lastSuccessAt: "2026-06-30T00:00:00.000Z",
          skippedThisRun: true,
        },
        {
          name: "警政署 交通事故",
          type: "gov-open-data",
          category: "交通",
          lastSuccessAt: "2026-07-04T00:30:00.000Z",
        },
      ]),
      { now },
    );

    expect(r.ok).toBe(true);
    expect(r.staleStructured).toHaveLength(0);
    expect(r.staleSkippedThisRun).toEqual([
      {
        name: "政府電子採購網 決標公告",
        type: "gov-open-data",
        category: "採購",
        ageHours: 120,
        threshold: 48,
      },
    ]);
  });

  it("本輪有嘗試的陳舊來源照常 gate，不受 skippedThisRun 機制影響", () => {
    const r = auditSourceFreshness(
      provenance([
        {
          name: "政府電子採購網 決標公告",
          type: "gov-open-data",
          category: "採購",
          lastSuccessAt: "2026-06-30T00:00:00.000Z",
          skippedThisRun: true,
        },
        {
          name: "食藥署 邊境查驗",
          type: "gov-open-data",
          category: "食安",
          lastSuccessAt: "2026-06-30T00:00:00.000Z",
        },
      ]),
      { now },
    );

    expect(r.ok).toBe(false);
    expect(r.staleStructured).toHaveLength(1);
    expect(r.staleStructured[0].name).toBe("食藥署 邊境查驗");
    expect(r.staleSkippedThisRun).toHaveLength(1);
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
