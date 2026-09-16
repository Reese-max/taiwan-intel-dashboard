import { describe, it, expect } from "vitest";
import * as jsGeo from "../scripts/lib/geo-policy.mjs";
import * as tsGeo from "../src/utils/geoPolicy";

describe("geo-policy — 座標合法性與數值邊界", () => {
  it.each([
    ["JS", jsGeo],
    ["TS", tsGeo],
  ])("%s: (0,0)、非有限數值、越界與非數值皆判定無效", (_, geo) => {
    expect(geo.isValidCoordinate(0, 0)).toBe(false);
    expect(geo.isValidCoordinate(NaN, 121.5)).toBe(false);
    expect(geo.isValidCoordinate(25.0, NaN)).toBe(false);
    expect(geo.isValidCoordinate(Infinity, 121.5)).toBe(false);
    expect(geo.isValidCoordinate(25.0, -Infinity)).toBe(false);
    expect(geo.isValidCoordinate(90.1, 121.5)).toBe(false);
    expect(geo.isValidCoordinate(-90.1, 121.5)).toBe(false);
    expect(geo.isValidCoordinate(25.0, 180.1)).toBe(false);
    expect(geo.isValidCoordinate(25.0, -180.1)).toBe(false);
    expect(geo.isValidCoordinate("25.0" as any, 121.5 as any)).toBe(false);
    expect(geo.isValidCoordinate(undefined as any, 121.5 as any)).toBe(false);
    expect(geo.isValidCoordinate(null as any, null as any)).toBe(false);
  });

  it.each([
    ["JS", jsGeo],
    ["TS", tsGeo],
  ])("%s: 合法有限數值（含赤道與本初子午線非雙零點）判定有效", (_, geo) => {
    expect(geo.isValidCoordinate(25.0375, 121.5637)).toBe(true);
    expect(geo.isValidCoordinate(0, 121.5637)).toBe(true);
    expect(geo.isValidCoordinate(25.0375, 0)).toBe(true);
    expect(geo.isValidCoordinate(-33.8688, 151.2093)).toBe(true);
  });
});

describe("geo-policy — 精度與角色判定", () => {
  it.each([
    ["JS", jsGeo],
    ["TS", tsGeo],
  ])("%s: exact / address 為精確精度，行政中心與推估為低精度", (_, geo) => {
    expect(geo.isExactPrecision("exact")).toBe(true);
    expect(geo.isExactPrecision("address")).toBe(true);
    expect(geo.isExactPrecision("city")).toBe(false);
    expect(geo.isExactPrecision("county-center")).toBe(false);
    expect(geo.isExactPrecision("district")).toBe(false);
    expect(geo.isExactPrecision("country")).toBe(false);
    expect(geo.isExactPrecision("unknown")).toBe(false);

    expect(geo.isLowPrecision("city")).toBe(true);
    expect(geo.isLowPrecision("county-center")).toBe(true);
    expect(geo.isLowPrecision("district")).toBe(true);
    expect(geo.isLowPrecision("country")).toBe(true);
    expect(geo.isLowPrecision("global")).toBe(true);
    expect(geo.isLowPrecision("unknown")).toBe(true);
    expect(geo.isLowPrecision("exact")).toBe(false);
  });

  it.each([
    ["JS", jsGeo],
    ["TS", tsGeo],
  ])("%s: 案發與查獲為 incident 角色，機關處所／提及／影響區域非案發角色", (_, geo) => {
    expect(geo.isIncidentRole("incident")).toBe(true);
    expect(geo.isIncidentRole("arrest")).toBe(true);
    expect(geo.isIncidentRole("agency")).toBe(false);
    expect(geo.isIncidentRole("mention")).toBe(false);
    expect(geo.isIncidentRole("impact_zone")).toBe(false);
    expect(geo.isIncidentRole("unknown")).toBe(false);

    expect(geo.isNonIncidentRole("agency")).toBe(true);
    expect(geo.isNonIncidentRole("mention")).toBe(true);
    expect(geo.isNonIncidentRole("impact_zone")).toBe(true);
    expect(geo.isNonIncidentRole("unknown")).toBe(true);
    expect(geo.isNonIncidentRole("incident")).toBe(false);
  });
});

describe("geo-policy — canClusterByDistance 案發地距離分群資格約束", () => {
  it.each([
    ["JS", jsGeo],
    ["TS", tsGeo],
  ])("%s: 只有精確座標＋案發/查獲角色才進入距離分群", (_, geo) => {
    // 案發地與查獲地具精確座標：可聚合成案發熱點
    expect(
      geo.canClusterByDistance({
        lat: 25.03,
        lng: 121.56,
        locationPrecision: "exact",
        locationRole: "incident",
      }),
    ).toBe(true);

    expect(
      geo.canClusterByDistance({
        lat: 25.03,
        lng: 121.56,
        locationPrecision: "address",
        locationRole: "arrest",
      }),
    ).toBe(true);
  });

  it.each([
    ["JS", jsGeo],
    ["TS", tsGeo],
  ])("%s: 行政中心/推估座標（city, county-center, district）絕不進入案發距離分群", (_, geo) => {
    expect(
      geo.canClusterByDistance({
        lat: 25.03,
        lng: 121.56,
        locationPrecision: "city",
        locationRole: "incident",
      }),
    ).toBe(false);

    expect(
      geo.canClusterByDistance({
        lat: 25.03,
        lng: 121.56,
        locationPrecision: "county-center",
        locationRole: "incident",
      }),
    ).toBe(false);

    expect(
      geo.canClusterByDistance({
        lat: 25.03,
        lng: 121.56,
        locationPrecision: "district",
        locationRole: "incident",
      }),
    ).toBe(false);
  });

  it.each([
    ["JS", jsGeo],
    ["TS", tsGeo],
  ])("%s: 精確座標但角色為機關／提及／未知時，不當成案發熱點", (_, geo) => {
    expect(
      geo.canClusterByDistance({
        lat: 25.03,
        lng: 121.56,
        locationPrecision: "exact",
        locationRole: "agency",
      }),
    ).toBe(false);

    expect(
      geo.canClusterByDistance({
        lat: 25.03,
        lng: 121.56,
        locationPrecision: "exact",
        locationRole: "mention",
      }),
    ).toBe(false);

    expect(
      geo.canClusterByDistance({
        lat: 25.03,
        lng: 121.56,
        locationPrecision: "exact",
        locationRole: "unknown",
      }),
    ).toBe(false);

    // exact 不自動等於發生地：未填 role 時不進距離分群
    expect(
      geo.canClusterByDistance({
        lat: 25.03,
        lng: 121.56,
        locationPrecision: "exact",
      }),
    ).toBe(false);
  });

  it.each([
    ["JS", jsGeo],
    ["TS", tsGeo],
  ])("%s: 既有測試 fixture 相容性（未帶 precision 與 role 的純座標 mock 可聚合）", (_, geo) => {
    expect(
      geo.canClusterByDistance({
        lat: 25.03,
        lng: 121.56,
      }),
    ).toBe(true);

    // (0,0) 或缺座標仍然為 false
    expect(
      geo.canClusterByDistance({
        lat: 0,
        lng: 0,
      }),
    ).toBe(false);

    expect(
      geo.canClusterByDistance({}),
    ).toBe(false);
  });
});

describe("geo-policy — 使用者面向標籤", () => {
  it.each([
    ["JS", jsGeo],
    ["TS", tsGeo],
  ])("%s: 產生正確繁體中文標籤", (_, geo) => {
    expect(geo.locationPrecisionLabel("exact")).toBe("精準位置");
    expect(geo.locationPrecisionLabel("address")).toBe("精準位置");
    expect(geo.locationPrecisionLabel("district")).toBe("行政區推論");
    expect(geo.locationPrecisionLabel("city")).toBe("縣市推論");
    expect(geo.locationPrecisionLabel("county-center")).toBe("縣市中心推論");
    expect(geo.locationPrecisionLabel("country")).toBe("國家層級");
    expect(geo.locationPrecisionLabel("global")).toBe("全球概略");
    expect(geo.locationPrecisionLabel("unknown")).toBe("未知");

    expect(geo.locationRoleLabel("incident")).toBe("案發地");
    expect(geo.locationRoleLabel("arrest")).toBe("查獲／逮捕地");
    expect(geo.locationRoleLabel("agency")).toBe("機關／辦公處所");
    expect(geo.locationRoleLabel("impact_zone")).toBe("警戒／影響區域");
    expect(geo.locationRoleLabel("mention")).toBe("報導提及處所");
    expect(geo.locationRoleLabel("unknown")).toBe("角色未知");
  });
});
