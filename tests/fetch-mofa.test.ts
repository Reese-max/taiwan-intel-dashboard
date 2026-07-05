import { describe, expect, it } from "vitest";

import {
  mapMofaTravelWarningEvent,
  mapMofaTravelWarningEvents,
  parseTravelWarning,
} from "../scripts/lib/fetch-mofa.mjs";
import { validateEventContract } from "../scripts/lib/event-contract.mjs";

const FETCHED_AT = "2026-07-05T00:00:00.000Z";

const item = (title: string, overrides = {}) => ({
  title,
  link: `https://www.boca.gov.tw/test/${encodeURIComponent(title)}`,
  description: `摘要：${title}`,
  pubDate: "Sun, 05 Jul 2026 00:00:00 GMT",
  ...overrides,
});

describe("fetch-mofa mapper", () => {
  it("parses travel warning region and risk level from standard titles", () => {
    expect(parseTravelWarning("第四級：紅色儘速離境 - 加薩走廊 -")).toEqual({
      region: "加薩走廊",
      riskLevel: "critical",
    });
    expect(parseTravelWarning("第三級：橙色避免前往 - 以色列 - Israel")).toEqual({
      region: "以色列",
      riskLevel: "high",
    });
    expect(parseTravelWarning("第二級：黃色注意 - 智利 - Chile")).toEqual({
      region: "智利",
      riskLevel: "medium",
    });
    expect(parseTravelWarning("第一級：灰色提醒 - 澳大利亞 - Australia")).toEqual({
      region: "澳大利亞",
      riskLevel: "low",
    });
  });

  it("maps RSS items to complete international IntelEvents", () => {
    const event = mapMofaTravelWarningEvent(item("第三級：橙色避免前往 - 以色列 - Israel"), {
      fetchedAt: FETCHED_AT,
    });

    expect(event.id).toMatch(/^intl-/);
    expect(event.title).toBe("第三級：橙色避免前往 - 以色列 - Israel");
    expect(event.region).toBe("以色列");
    expect(event.timestamp).toBe("2026-07-05T00:00:00.000Z");
    expect(event.category).toBe("地緣政治");
    expect(event.scope).toBe("international");
    expect(event.riskLevel).toBe("high");
    expect(event.summary).toContain("以色列");
    expect(event.locationPrecision).toBe("country");
    expect(event.source).toMatchObject({
      name: "外交部領事事務局 旅遊警示",
      type: "gov-open-data",
      datasetId: "mofa-travel-warning",
      fetchedAt: FETCHED_AT,
    });

    expect(validateEventContract([event])).toEqual({ valid: [event], invalid: [] });
  });

  it("keeps all required fields across warning levels", () => {
    const events = mapMofaTravelWarningEvents(
      [
        item("第四級：紅色儘速離境 - 加薩走廊 -"),
        item("第三級：橙色避免前往 - 以色列 - Israel"),
        item("第二級：黃色注意 - 智利 - Chile"),
        item("第一級：灰色提醒 - 澳大利亞 - Australia"),
      ],
      { fetchedAt: FETCHED_AT },
    );

    expect(events.map((e) => e.riskLevel)).toEqual(["critical", "high", "medium", "low"]);
    expect(events.map((e) => e.region)).toEqual(["加薩走廊", "以色列", "智利", "澳大利亞"]);
    const result = validateEventContract(events);
    expect(result.invalid).toEqual([]);
    expect(result.valid).toHaveLength(4);
  });

  it("does not crash on malformed titles or missing dates", () => {
    const event = mapMofaTravelWarningEvent(
      item("未符合格式的旅遊警示標題", {
        pubDate: "",
        description: "",
      }),
      { fetchedAt: FETCHED_AT },
    );

    expect(event.region).toBe("國外");
    expect(event.riskLevel).toBe("low");
    expect(event.summary).toBe("未符合格式的旅遊警示標題");
    expect(event.timestamp).toBe(FETCHED_AT);
    expect(validateEventContract([event]).invalid).toEqual([]);
  });
});
