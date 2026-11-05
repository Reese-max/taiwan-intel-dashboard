import {
  fetchAgriculturePrices,
  fetchCgaMaritime,
  fetchCdcInfluenza,
  fetchEconomicIndicators,
  fetchEducationSnapshot,
  fetchFinanceDerivatives,
  fetchFireStatistics,
  fetchHealthcareFacilities,
  fetchLaborStatistics,
  fetchMndActivity,
  fetchParkingHsinchu,
  fetchParkingTaoyuan,
  fetchSocialPopulation,
  fetchTaipowerSupply,
  fetchTfdaNoncompliant,
  fetchTwcertVulnerabilities,
  fetchWraReservoirLevels,
  fetchWraRiverLevels,
} from "./fetch-official.mjs";

export const DIRECT_OFFICIAL_SOURCES = Object.freeze({
  mnd: { label: "MND 臺海動態", fetch: () => fetchMndActivity({}) },
  cdc: { label: "CDC 官方監測", fetch: () => fetchCdcInfluenza({}) },
  tfda: { label: "TFDA 邊境查驗", fetch: () => fetchTfdaNoncompliant({}) },
  cga: { label: "海巡署海域事件", fetch: () => fetchCgaMaritime({}) },
  twcert: { label: "TWCERT/CC 漏洞公告", fetch: () => fetchTwcertVulnerabilities({}) },
  taipower: { label: "台電系統供需", fetch: () => fetchTaipowerSupply({}) },
  wra: { label: "水利署水庫水情", fetch: () => fetchWraReservoirLevels({}) },
  wraRiver: { label: "水利署即時河川水位", fetch: () => fetchWraRiverLevels({}) },
  parkingHsinchu: { label: "新竹市停車供給", fetch: () => fetchParkingHsinchu({}) },
  parkingTaoyuan: { label: "桃園市停車供給", fetch: () => fetchParkingTaoyuan({}) },
  economy: { label: "勞動部每月國內主要經濟指標", fetch: () => fetchEconomicIndicators({}) },
  agriPrices: { label: "農業部農產品價格", fetch: () => fetchAgriculturePrices({}) },
  healthFacilities: { label: "健保署居家醫療院所", fetch: () => fetchHealthcareFacilities({}) },
  fireStats: { label: "臺北市消防統計", fetch: () => fetchFireStatistics({}) },
  socialPopulation: { label: "臺中市人口結構", fetch: () => fetchSocialPopulation({}) },
  education: { label: "新北市教育概況", fetch: () => fetchEducationSnapshot({}) },
  financeDerivatives: { label: "期交所三大法人選擇權", fetch: () => fetchFinanceDerivatives({}) },
  laborStats: { label: "新北市失業率統計", fetch: () => fetchLaborStatistics({}) },
});

export const DIRECT_OFFICIAL_SOURCE_KEYS = Object.freeze(Object.keys(DIRECT_OFFICIAL_SOURCES));

export async function fetchDirectOfficialSources({
  wants,
  sources = DIRECT_OFFICIAL_SOURCES,
  logger = console,
} = {}) {
  if (typeof wants !== "function") throw new TypeError("fetchDirectOfficialSources requires wants(key)");

  const rows = await Promise.all(Object.entries(sources).map(async ([key, source]) => {
    if (!wants(key)) {
      return { key, label: source.label, events: [], status: { skipped: true } };
    }

    try {
      const events = await source.fetch();
      const provenance = events[0]?.source;
      const status = {
        ok: true,
        configured: true,
        count: events.length,
        ...(provenance?.datasetId ? { datasetId: provenance.datasetId } : {}),
        ...(provenance?.fallbackFrom ? { fallbackFrom: provenance.fallbackFrom } : {}),
      };
      logger.log(`${source.label}：${events.length} 筆${provenance?.fallbackFrom ? "（官方週報 fallback）" : ""}`);
      return { key, label: source.label, events, status };
    } catch (error) {
      const message = error?.message || String(error);
      logger.error(`${source.label}失敗：${message}`);
      return { key, label: source.label, events: [], status: { ok: false, configured: true, error: message } };
    }
  }));

  return {
    freshByKey: Object.fromEntries(rows.map(({ key, events }) => [key, events])),
    statusByKey: Object.fromEntries(rows.map(({ key, status }) => [key, status])),
    labelsByKey: Object.fromEntries(rows.map(({ key, label }) => [key, label])),
  };
}
