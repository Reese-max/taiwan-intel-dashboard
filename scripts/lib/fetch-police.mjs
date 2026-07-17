// 警政 live fetcher：Tier-1 事件級 + Tier-2 統計／熱點
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { countyCoordFromAddr } from "./coords.mjs";
import { queryTwinkleRows, rowVal } from "./twinkle-query.mjs";
import {
  crimeRisk,
  dedupeTrafficRows,
  formatNtd,
  fraudDashRisk,
  parseCasualties,
  parseSlashDateTime,
  regionFromTaipeiAddr,
  rocYmToIso,
  rocYmdHmToIso,
  rocYmd7ToIso,
  speedRisk,
  TAIPEI_CENTER,
  trafficRisk,
  trafficTimestamp,
  weeklyCrimeRisk,
  calendarTimestamp,
  parseCoordPair,
  slashDateToIso,
  gregorianYmd8ToIso,
  localDateTimeToIso,
  rocChineseDateTimeToIso,
  riskByPrice,
} from "./police-mappers.mjs";

const TAICHUNG_TRAFFIC_DATASET = "176086";
const TAICHUNG_HOTSPOT_DATASET = "176610";
const TAOYUAN_THEFT_DATASET = "167673";
const TAINAN_ALERT_DATASET = "100208";
const NTPC_ALERT_DATASET = "125645";
const FRAUD_INVEST_DATASET = "160055";
const POLICE_NEWS_DATASET = "7505";
const HISTORICAL_TRAFFIC_DATASET = "12197";
const DRUG_CRIME_DATASET = "57268";
const ASSEMBLY_DATASET = "11307";
const TAIPEI_TRAFFIC_SPOTS_DATASET = "136123";
const TAIPEI_TRAFFIC_VIOLATION_DATASET = "173625";
const KHH_A3_TRAFFIC_DATASET = "168403";
const KHH_FIXED_CAMERA_DATASET = "169080";
const KHH_AVG_SPEED_CAMERA_DATASET = "146885";
const HSINCHU_CITY_TRAFFIC_STATS_DATASET = "167814";
const HSINCHU_COUNTY_AVG_SPEED_DATASET = "172950";
const YILAN_CCTV_DATASET = "143467";
const MIAOLI_REPORT_STATS_DATASET = "171164";
const MIAOLI_CASE_STATS_DATASET = "171167";
const NANTOU_TECH_ENFORCEMENT_DATASET = "176021";
const NANTOU_IMPOUND_LOTS_DATASET = "78638";
const PINGTUNG_CCTV_DATASET = "155895";
const PINGTUNG_CRASH_HOTSPOTS_DATASET = "90589";
const PINGTUNG_TECH_ENFORCEMENT_DATASET = "159972";
const HUALIEN_AVG_SPEED_DATASET = "171349";
const TAITUNG_AIR_RAID_SHELTERS_DATASET = "173142";
const PENGHU_SCIENCE_ENFORCEMENT_DATASET = "172940";
const PENGHU_TRAFFIC_ORDER_STATS_DATASET = "157949";
const KINMEN_AIR_RAID_SHELTERS_DATASET = "151006";
const LIENCHIANG_SERVICE_STATS_DATASET = "146936";
// Tier-2 統計型新增來源（刑案率／酒駕／家暴通報）
const CRIME_RATE_DATASET = "103351"; // 刑案發生率（按機關別）
const CRIME_CLEARANCE_DATASET = "103352"; // 刑案破獲率（按機關別）
const DUI_TAICHUNG_DATASET = "88170"; // 臺中市取締酒駕情形
const DV_TAIPEI_DATASET = "145744"; // 臺北市家暴通報案件數統計

const CHIAYI_THEFT_DATASETS = [
  { datasetId: "133922", label: "住宅竊盜" },
  { datasetId: "133923", label: "汽車竊盜" },
  { datasetId: "133924", label: "自行車竊盜" },
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRIME_WEEKLY_SCRIPT = join(__dirname, "parse-crime-weekly.py");

const TAIPEI_CRIME_DATASETS = [
  { datasetId: "130105", label: "街頭隨機搶奪" },
  { datasetId: "130106", label: "街頭隨機強盜" },
  { datasetId: "130312", label: "住宅竊盜" },
  { datasetId: "145818", label: "汽車竊盜" },
  { datasetId: "130107", label: "機車竊盜" },
  { datasetId: "145839", label: "自行車竊盜" },
];

const PCC_POLICE_QUERY =
  "announcement_type='決標公告' AND (agency LIKE '%警察%' OR agency LIKE '%警政%') AND award_price != '' AND date <= '{TODAY}' ORDER BY date DESC";

export const POLICE_HOURLY_MINIMUM = 200;
export const POLICE_NEW_PER_HOUR_FALLBACK = 200;
export const POLICE_TODAY_MINIMUM = 150;

export const POLICE_DEFAULT_LIMITS = {
  traffic: 500,
  fraudDomains: 300,
  fraudDebunk: 120,
  crimePerDataset: 180,
  pcc: 400,
  speedHotspots: 300,
  fraudDashboard: 60,
  taichungTraffic: 400,
  tainanAlerts: 30,
  ntpcAlerts: 30,
  fraudInvest: 180,
  taichungHotspots: 30,
  taoyuanTheft: 400,
  policeNews: 120,
  historicalTraffic: 400,
  drugCrime: 300,
  assemblies: 120,
  taipeiTrafficSpots: 300,
  taipeiTrafficViolations: 300,
  kaohsiungA3Traffic: 200,
  kaohsiungFixedCameras: 260,
  kaohsiungAvgSpeedCameras: 10,
  hsinchuCityTrafficStats: 20,
  hsinchuCountyAvgSpeed: 10,
  chiayiTheftPerDataset: 30,
  yilanCctv: 320,
  miaoliReportStats: 12,
  miaoliCaseStats: 12,
  nantouTechEnforcement: 10,
  nantouImpoundLots: 10,
  pingtungCctv: 520,
  pingtungCrashHotspots: 30,
  pingtungTechEnforcement: 30,
  hualienAvgSpeed: 20,
  taitungAirRaidShelters: 320,
  penghuScienceEnforcement: 50,
  penghuTrafficOrderStats: 36,
  kinmenAirRaidShelters: 160,
  lienchiangServiceStats: 10,
  crimeRate: 400,
  duiTaichung: 300,
  dvTaipei: 1000,
};

export function plannedPoliceFetchCapacity(limits = POLICE_DEFAULT_LIMITS) {
  const cfg = { ...POLICE_DEFAULT_LIMITS, ...limits };
  return (
    cfg.traffic +
    cfg.fraudDomains +
    cfg.fraudDebunk +
    cfg.crimePerDataset * TAIPEI_CRIME_DATASETS.length +
    cfg.pcc +
    cfg.speedHotspots +
    cfg.fraudDashboard +
    cfg.taichungTraffic +
    cfg.tainanAlerts +
    cfg.ntpcAlerts +
    cfg.fraudInvest +
    cfg.taichungHotspots +
    cfg.taoyuanTheft +
    cfg.policeNews +
    cfg.historicalTraffic +
    cfg.drugCrime +
    cfg.assemblies +
    cfg.taipeiTrafficSpots +
    cfg.taipeiTrafficViolations +
    cfg.kaohsiungA3Traffic +
    cfg.kaohsiungFixedCameras +
    cfg.kaohsiungAvgSpeedCameras +
    cfg.hsinchuCityTrafficStats +
    cfg.hsinchuCountyAvgSpeed +
    cfg.chiayiTheftPerDataset * CHIAYI_THEFT_DATASETS.length +
    cfg.yilanCctv +
    cfg.miaoliReportStats +
    cfg.miaoliCaseStats +
    cfg.nantouTechEnforcement +
    cfg.nantouImpoundLots +
    cfg.pingtungCctv +
    cfg.pingtungCrashHotspots +
    cfg.pingtungTechEnforcement +
    cfg.hualienAvgSpeed +
    cfg.taitungAirRaidShelters +
    cfg.penghuScienceEnforcement +
    cfg.penghuTrafficOrderStats +
    cfg.kinmenAirRaidShelters +
    cfg.lienchiangServiceStats
  );
}

export function crimeWeeklySpawnEnv(baseEnv = process.env) {
  return {
    ...baseEnv,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
  };
}

export function policeNewsRisk(title, content) {
  const text = `${title || ""} ${content || ""}`;
  if (/槍擊|爆裂物|炸彈|殺人|重大刑案|毒駕|販毒|製毒|羈押/.test(text)) return "high";
  if (/詐欺|毒品|查緝|查獲|竊盜|搶奪|強盜|婦幼|酒駕|攔阻/.test(text)) return "medium";
  return "low";
}

export function drugCrimeRisk(weight, suspects) {
  const grams = Number(weight);
  const people = Number(suspects);
  if ((Number.isFinite(grams) && grams >= 1000) || (Number.isFinite(people) && people >= 5)) return "high";
  if ((Number.isFinite(grams) && grams >= 50) || (Number.isFinite(people) && people >= 2)) return "medium";
  return "low";
}

export function assemblyRisk(category, route) {
  const text = `${category || ""} ${route || ""}`;
  if (/遊行|車隊|道路|封閉|管制/.test(text)) return "medium";
  return "low";
}

export function enforcementRisk(text, speedLimit) {
  const n = Number(String(speedLimit || "").replace(/\D/g, ""));
  const s = String(text || "");
  if (/闖紅燈|酒駕|逆向|危險|人行道|紅燈/.test(s)) return "medium";
  if (Number.isFinite(n) && n >= 80) return "medium";
  return "low";
}

function cleanCell(value) {
  return String(value ?? "")
    .replace(/\u200c|\u200d/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function numericCell(value) {
  const n = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

export function coordOrCounty(county, { lat, lng, text } = {}) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= 21 &&
    latitude <= 27 &&
    longitude >= 118 &&
    longitude <= 123
  ) {
    return { lat: latitude, lng: longitude, region: county.replace(/^台/, "臺") };
  }
  return countyCoordFromAddr(`${county}${text || ""}`) || { ...(countyCoordFromAddr(county) || {}), region: county.replace(/^台/, "臺") };
}

function regionFromCountyPlace(county, ...parts) {
  const text = parts.map(cleanCell).filter(Boolean).join(" ");
  const match = text.match(/([\u4e00-\u9fff]{1,8}[鄉鎮市區])/);
  return match ? `${county.replace(/^台/, "臺")}${match[1]}` : county.replace(/^台/, "臺");
}

function rocChineseYmToIso(text) {
  const match = String(text || "").match(/(\d{2,3})年\s*(\d{1,2})月/);
  if (!match) return null;
  return rocYmToIso(`${match[1]}${match[2].padStart(2, "0")}`);
}

function provenance({ name, datasetId, recordRef, url, fetchedAt, query }) {
  return {
    name,
    type: "gov-open-data",
    datasetId,
    recordRef,
    url,
    fetchedAt,
    query,
  };
}

async function fetchTraffic({ url, token, limit = 8 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: "177136",
    order_by: "發生日期 DESC, 發生時間 DESC",
    limit: Math.max(40, limit * 4),
  });
  const fetchedAt = new Date().toISOString();
  const unique = dedupeTrafficRows(rows, columns).slice(0, limit);
  return unique.map((row, n) => {
    const date = rowVal(row, columns, "發生日期");
    const time = rowVal(row, columns, "發生時間");
    const loc = rowVal(row, columns, "發生地點");
    const cls = rowVal(row, columns, "事故類別名稱");
    const unit = rowVal(row, columns, "處理單位名稱警局層");
    const casualties = rowVal(row, columns, "死亡受傷人數");
    const lng = Number(rowVal(row, columns, "經度"));
    const lat = Number(rowVal(row, columns, "緯度"));
    const ref = `${date}-${time}-${n}`;
    const coord = countyCoordFromAddr(loc) || {};
    return {
      id: `traffic-${ref}`,
      title: `${cls || "交通事故"}｜${String(loc || "").slice(0, 36)}`,
      region: coord.region || "全國",
      lat: Number.isFinite(lat) ? lat : coord.lat,
      lng: Number.isFinite(lng) ? lng : coord.lng,
      timestamp: trafficTimestamp(date, time),
      category: "交通",
      scope: "domestic",
      riskLevel: trafficRisk(cls, casualties),
      summary: `${unit || "警察機關"}通報${cls || "事故"}，${casualties || "傷亡待查"}，地點：${loc || "—"}。`,
      source: provenance({
        name: "警政署 114年傷亡道路交通事故資料",
        datasetId: "177136",
        recordRef: ref,
        url: "https://data.gov.tw/dataset/177136",
        fetchedAt,
        query: "query_rows 177136 ORDER BY 發生日期 DESC, 發生時間 DESC",
      }),
    };
  });
}

async function fetchFraudDomains({ url, token, limit = 6 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: "176455",
    order_by: "民國年月 DESC",
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row) => {
    const ym = rowVal(row, columns, "民國年月");
    const domain = rowVal(row, columns, "網域");
    const kind = rowVal(row, columns, "網站性質");
    const law = rowVal(row, columns, "法律依據");
    const unit = rowVal(row, columns, "聲請單位");
    return {
      id: `fraud-domain-${ym}-${domain}`,
      title: `涉詐網站停解析：${domain}`,
      region: "全國",
      timestamp: rocYmToIso(ym) || fetchedAt,
      category: "反詐",
      scope: "domestic",
      riskLevel: "medium",
      summary: `${unit || "刑事警察局"}依${law || "詐欺犯罪危害防制條例"}申請停止解析，網站性質：${kind || "—"}。`,
      source: provenance({
        name: "165反詐騙諮詢專線 涉詐網站停解析",
        datasetId: "176455",
        recordRef: String(domain),
        url: "https://data.gov.tw/dataset/176455",
        fetchedAt,
        query: "query_rows 176455 ORDER BY 民國年月 DESC",
      }),
    };
  });
}

async function fetchFraudDebunk({ url, token, limit = 3 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: "38262",
    order_by: "發佈時間 DESC",
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row) => {
    const ref = rowVal(row, columns, "編號");
    const title = rowVal(row, columns, "標題");
    const published = rowVal(row, columns, "發佈時間");
    const body = rowVal(row, columns, "發佈內容");
    return {
      id: `fraud-debunk-${ref}`,
      title: title || "165闢謠公告",
      region: "全國",
      timestamp: parseSlashDateTime(published),
      category: "反詐",
      scope: "domestic",
      riskLevel: "low",
      summary: String(body || "").slice(0, 200),
      source: provenance({
        name: "165反詐騙諮詢專線 詐騙闢謠專區",
        datasetId: "38262",
        recordRef: String(ref),
        url: "https://data.gov.tw/dataset/38262",
        fetchedAt,
        query: "query_rows 38262 ORDER BY 發佈時間 DESC",
      }),
    };
  });
}

async function fetchTaipeiCrime({ url, token, perDataset = 2 }) {
  const fetchedAt = new Date().toISOString();
  const events = [];
  for (const ds of TAIPEI_CRIME_DATASETS) {
    const { columns, rows } = await queryTwinkleRows({
      url,
      token,
      dataset_id: ds.datasetId,
      order_by: "發生日期 DESC",
      limit: perDataset,
    });
    for (const row of rows) {
      const ref = rowVal(row, columns, "編號");
      const caseType = rowVal(row, columns, "案類") || ds.label;
      const date = rowVal(row, columns, "發生日期");
      const slot = rowVal(row, columns, "發生時段");
      const addr = rowVal(row, columns, "發生地點");
      const region = regionFromTaipeiAddr(addr);
      events.push({
        id: `crime-tpe-${ds.datasetId}-${ref}`,
        title: `臺北市${caseType}｜${region}`,
        region,
        lat: TAIPEI_CENTER.lat,
        lng: TAIPEI_CENTER.lng,
        timestamp: rocYmd7ToIso(date) || fetchedAt,
        category: "治安",
        scope: "domestic",
        riskLevel: crimeRisk(caseType),
        summary: `${caseType}案，發生時段 ${slot || "—"}，地點：${addr || "—"}（地址已模糊化）。`,
        source: provenance({
          name: `臺北市政府警察局 ${ds.label}點位`,
          datasetId: ds.datasetId,
          recordRef: String(ref),
          url: `https://data.gov.tw/dataset/${ds.datasetId}`,
          fetchedAt,
          query: `query_rows ${ds.datasetId} ORDER BY 發生日期 DESC LIMIT ${perDataset}`,
        }),
      });
    }
  }
  return events;
}

async function fetchSpeedHotspots({ url, token, limit = 8 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: "13908",
    order_by: "當年累計件數 DESC",
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row, n) => {
    const date = rowVal(row, columns, "日期");
    const unit = rowVal(row, columns, "轄區單位");
    const loc = rowVal(row, columns, "設置位置");
    const daily = rowVal(row, columns, "當日件數");
    const monthly = rowVal(row, columns, "當月累計件數");
    const yearly = rowVal(row, columns, "當年累計件數");
    const ref = `${date}-${n}`;
    const coord = countyCoordFromAddr(`${unit || ""}${loc || ""}`) || { region: "全國" };
    return {
      id: `speed-${ref}`,
      title: `測速熱點｜${String(loc || "").slice(0, 40)}`,
      region: coord.region,
      lat: coord.lat,
      lng: coord.lng,
      timestamp: rocYmd7ToIso(date) || fetchedAt,
      category: "交通",
      scope: "domestic",
      riskLevel: speedRisk(daily, yearly),
      summary: `${unit || "警察機關"}測速點累計取締 ${yearly || "—"} 件（當日 ${daily || "—"}／當月 ${monthly || "—"}），位置：${loc || "—"}。此為統計熱點，非即時事件。`,
      source: provenance({
        name: "警政署 測速執法點取締件數",
        datasetId: "13908",
        recordRef: ref,
        url: "https://data.gov.tw/dataset/13908",
        fetchedAt,
        query: "query_rows 13908 ORDER BY 當年累計件數 DESC",
      }),
    };
  });
}

async function fetchFraudDashboard({ url, token, limit = 3 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: "172159",
    order_by: "年度 DESC, 月 DESC",
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row) => {
    const year = rowVal(row, columns, "年度");
    const month = rowVal(row, columns, "月");
    const groups = rowVal(row, columns, "查緝不法犯罪集團團數");
    const people = rowVal(row, columns, "查緝不法犯罪集團人數");
    const seized = rowVal(row, columns, "查扣不法所得金額");
    const blocked = rowVal(row, columns, "攔阻金額");
    const ref = `${year}-${month}`;
    return {
      id: `fraud-dash-${ref}`,
      title: `打詐儀表板｜${year}年${month}月`,
      region: "全國",
      timestamp: rocYmToIso(`${year}${String(month).padStart(2, "0")}`) || fetchedAt,
      category: "反詐",
      scope: "domestic",
      riskLevel: fraudDashRisk(blocked),
      summary: `警政署打詐成效（月統計）：查緝集團 ${groups || "—"} 團／${people || "—"} 人，查扣不法所得 ${formatNtd(seized)}，攔阻金額 ${formatNtd(blocked)}。`,
      source: provenance({
        name: "內政部警政署 打詐儀表板執行成效",
        datasetId: "172159",
        recordRef: ref,
        url: "https://data.gov.tw/dataset/172159",
        fetchedAt,
        query: "query_rows 172159 ORDER BY 年度 DESC, 月 DESC",
      }),
    };
  });
}

async function fetchTaichungTraffic({ url, token, limit = 6 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: TAICHUNG_TRAFFIC_DATASET,
    order_by: "年 DESC, 月 DESC, 日 DESC, 時 DESC",
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row, n) => {
    const year = rowVal(row, columns, "年");
    const month = rowVal(row, columns, "月");
    const day = rowVal(row, columns, "日");
    const hour = rowVal(row, columns, "時");
    const minute = rowVal(row, columns, "分");
    const district = rowVal(row, columns, "區");
    const deaths = rowVal(row, columns, "死亡數量");
    const injuries = rowVal(row, columns, "受傷數量");
    const loc = rowVal(row, columns, "事故位置");
    const cls = rowVal(row, columns, "事故類別");
    const lng = Number(rowVal(row, columns, "GPS座標X"));
    const lat = Number(rowVal(row, columns, "GPS座標Y"));
    const ref = `${year}${month}${day}-${hour}${minute}-${n}`;
    const coord = countyCoordFromAddr(`臺中市${district || ""}`) || { region: "臺中市" };
    const casualtyText = `死亡${deaths || 0};受傷${injuries || 0}`;
    return {
      id: `taichung-traffic-${ref}`,
      title: `臺中市交通事故｜${district || "—"}`,
      region: `臺中市${district || ""}`,
      lat: Number.isFinite(lat) ? lat : coord.lat,
      lng: Number.isFinite(lng) ? lng : coord.lng,
      timestamp: calendarTimestamp(year, month, day, hour, minute) || fetchedAt,
      category: "交通",
      scope: "domestic",
      riskLevel: trafficRisk(cls, casualtyText),
      summary: `臺中市${district || ""}交通事故（類別 ${cls || "—"}），${casualtyText.replace(";", "、")}，地點：${loc || "—"}。`,
      source: provenance({
        name: "臺中市政府警察局 114年10月份交通事故",
        datasetId: TAICHUNG_TRAFFIC_DATASET,
        recordRef: ref,
        url: `https://data.gov.tw/dataset/${TAICHUNG_TRAFFIC_DATASET}`,
        fetchedAt,
        query: `query_rows ${TAICHUNG_TRAFFIC_DATASET} ORDER BY 年 DESC, 月 DESC, 日 DESC, 時 DESC`,
      }),
    };
  });
}

async function fetchTaichungHotspots({ url, token, limit = 5 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: TAICHUNG_HOTSPOT_DATASET,
    order_by: "總件數 DESC",
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row) => {
    const ref = rowVal(row, columns, "編號");
    const junction = rowVal(row, columns, "路口名稱");
    const bureau = rowVal(row, columns, "轄區分局");
    const total = rowVal(row, columns, "總件數");
    const deaths = rowVal(row, columns, "死亡人數");
    const injuries = rowVal(row, columns, "受傷人數");
    const slot = rowVal(row, columns, "發生時間");
    const cause = rowVal(row, columns, "主要肇因");
    const coord = countyCoordFromAddr(junction) || { region: "臺中市" };
    const casualtyText = `死亡${deaths || 0};受傷${injuries || 0}`;
    return {
      id: `taichung-hotspot-${ref}`,
      title: `臺中高肇事路口｜${String(junction || "").slice(0, 36)}`,
      region: coord.region || "臺中市",
      lat: coord.lat,
      lng: coord.lng,
      timestamp: fetchedAt,
      category: "交通",
      scope: "domestic",
      riskLevel: trafficRisk("A2", casualtyText),
      summary: `${bureau || "臺中市警察局"}十大高肇事路口：${junction || "—"}，累計 ${total || "—"} 件（A1 ${rowVal(row, columns, "A1") || 0}/A2 ${rowVal(row, columns, "A2") || 0}/A3 ${rowVal(row, columns, "A3") || 0}），高峰 ${slot || "—"}，主因 ${cause || "—"}。`,
      source: provenance({
        name: "臺中市政府警察局 114年11月份十大高肇事路口",
        datasetId: TAICHUNG_HOTSPOT_DATASET,
        recordRef: String(ref),
        url: `https://data.gov.tw/dataset/${TAICHUNG_HOTSPOT_DATASET}`,
        fetchedAt,
        query: `query_rows ${TAICHUNG_HOTSPOT_DATASET} ORDER BY 總件數 DESC`,
      }),
    };
  });
}

async function fetchTaoyuanTheftPoints({ url, token, limit = 6 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: TAOYUAN_THEFT_DATASET,
    where: "發生年度 >= '2024'",
    order_by: "日期 DESC",
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row, n) => {
    const caseType = rowVal(row, columns, "案件類型");
    const date = rowVal(row, columns, "日期");
    const bureau = rowVal(row, columns, "管轄分局");
    const station = rowVal(row, columns, "管轄派出所");
    const lat = Number(rowVal(row, columns, "緯度"));
    const lng = Number(rowVal(row, columns, "經度"));
    const ref = `${date}-${n}`;
    const coord = countyCoordFromAddr("桃園市") || { region: "桃園市" };
    return {
      id: `taoyuan-theft-${ref}`,
      title: `桃園市${caseType || "竊盜"}｜${bureau || "—"}`,
      region: "桃園市",
      lat: Number.isFinite(lat) ? lat : coord.lat,
      lng: Number.isFinite(lng) ? lng : coord.lng,
      timestamp: gregorianYmd8ToIso(date) || fetchedAt,
      category: "治安",
      scope: "domestic",
      riskLevel: crimeRisk(caseType),
      summary: `${bureau || "桃園市政府警察局"}${caseType || "竊盜"}點位（${station || "派出所待查"}），發生日 ${date || "—"}。`,
      source: provenance({
        name: "桃園市政府警察局 竊盜點位統計",
        datasetId: TAOYUAN_THEFT_DATASET,
        recordRef: ref,
        url: `https://data.gov.tw/dataset/${TAOYUAN_THEFT_DATASET}`,
        fetchedAt,
        query: `query_rows ${TAOYUAN_THEFT_DATASET} WHERE 發生年度 >= '2024' ORDER BY 日期 DESC`,
      }),
    };
  });
}

async function fetchPoliceNews({ url, token, limit = 10 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: POLICE_NEWS_DATASET,
    where: "postDate LIKE '20%'",
    order_by: "postDate DESC",
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row) => {
    const ref = rowVal(row, columns, "serialNo");
    const title = rowVal(row, columns, "stitle");
    const dept = rowVal(row, columns, "deptName");
    const posted = rowVal(row, columns, "postDate");
    const content = rowVal(row, columns, "content");
    const coord = countyCoordFromAddr(`${title || ""}${content || ""}`) || { region: "全國" };
    return {
      id: `police-news-${ref}`,
      title: `警察機關新聞｜${String(title || "最新發布").slice(0, 42)}`,
      region: coord.region,
      lat: coord.lat,
      lng: coord.lng,
      timestamp: localDateTimeToIso(posted) || fetchedAt,
      category: "治安",
      scope: "domestic",
      riskLevel: policeNewsRisk(title, content),
      summary: `${dept || "警政署"}發布：${String(content || title || "").replace(/\s+/g, " ").trim().slice(0, 220)}。`,
      source: provenance({
        name: "警政署 各警察機關新聞發布",
        datasetId: POLICE_NEWS_DATASET,
        recordRef: String(ref),
        url: `https://data.gov.tw/dataset/${POLICE_NEWS_DATASET}`,
        fetchedAt,
        query: `query_rows ${POLICE_NEWS_DATASET} WHERE postDate LIKE '20%' ORDER BY postDate DESC`,
      }),
    };
  });
}

async function fetchHistoricalTraffic({ url, token, limit = 10 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: HISTORICAL_TRAFFIC_DATASET,
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row, n) => {
    const occurred = rowVal(row, columns, "發生時間");
    const loc = rowVal(row, columns, "發生地點");
    const casualties = rowVal(row, columns, "死亡受傷人數");
    const vehicles = rowVal(row, columns, "車種");
    const ref = `${occurred}-${String(loc || "").slice(0, 24)}-${n}`;
    const coord = countyCoordFromAddr(loc) || { region: "全國" };
    return {
      id: `traffic-history-${ref}`,
      title: `歷史交通事故｜${String(loc || "地點待查").slice(0, 36)}`,
      region: coord.region,
      lat: coord.lat,
      lng: coord.lng,
      timestamp: rocChineseDateTimeToIso(occurred) || fetchedAt,
      category: "交通",
      scope: "domestic",
      riskLevel: trafficRisk("", casualties),
      summary: `警政署歷史 A1/A2 交通事故資料，${casualties || "傷亡待查"}，車種：${vehicles || "—"}，地點：${loc || "—"}。`,
      source: provenance({
        name: "警政署 歷史交通事故資料",
        datasetId: HISTORICAL_TRAFFIC_DATASET,
        recordRef: ref,
        url: `https://data.gov.tw/dataset/${HISTORICAL_TRAFFIC_DATASET}`,
        fetchedAt,
        query: `query_rows ${HISTORICAL_TRAFFIC_DATASET}`,
      }),
    };
  });
}

async function fetchDrugCrime({ url, token, limit = 10 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: DRUG_CRIME_DATASET,
    where: "oc_dt LIKE '1%'",
    order_by: "oc_dt DESC",
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row) => {
    const ref = rowVal(row, columns, "no");
    const caseType = rowVal(row, columns, "type");
    const date = rowVal(row, columns, "oc_dt");
    const addr = rowVal(row, columns, "oc_addr");
    const place1 = rowVal(row, columns, "oc_p1");
    const place2 = rowVal(row, columns, "oc_p2");
    const suspects = rowVal(row, columns, "proc_no");
    const kind = rowVal(row, columns, "kind");
    const weight = rowVal(row, columns, "weight_g");
    const coord = countyCoordFromAddr(addr) || { region: "全國" };
    return {
      id: `drug-crime-${date}-${ref}`,
      title: `毒品犯罪資料｜${String(addr || "地點待查").slice(0, 28)}`,
      region: coord.region,
      lat: coord.lat,
      lng: coord.lng,
      timestamp: rocYmd7ToIso(date) || fetchedAt,
      category: "治安",
      scope: "domestic",
      riskLevel: drugCrimeRisk(weight, suspects),
      summary: `${caseType || "毒品"}案件，嫌疑犯 ${suspects || "—"} 人，品項 ${kind || "—"}、淨重 ${weight || "—"} 克，場所：${[place1, place2].filter(Boolean).join("/") || "—"}。`,
      source: provenance({
        name: "警政署 毒品犯罪資料",
        datasetId: DRUG_CRIME_DATASET,
        recordRef: `${date}-${ref}`,
        url: `https://data.gov.tw/dataset/${DRUG_CRIME_DATASET}`,
        fetchedAt,
        query: `query_rows ${DRUG_CRIME_DATASET} WHERE oc_dt LIKE '1%' ORDER BY oc_dt DESC`,
      }),
    };
  });
}

async function fetchAssemblyEvents({ url, token, limit = 10 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: ASSEMBLY_DATASET,
    where: "actStTime LIKE '20%'",
    order_by: "actStTime DESC",
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row, n) => {
    const start = rowVal(row, columns, "actStTime");
    const end = rowVal(row, columns, "actEndTime");
    const category = rowVal(row, columns, "actCategory");
    const route = rowVal(row, columns, "placeOrRoute");
    const authority = rowVal(row, columns, "authorities");
    const coord = countyCoordFromAddr(`${route || ""}${authority || ""}`) || { region: "全國" };
    const ref = `${start}-${String(route || "").slice(0, 32)}-${n}`;
    return {
      id: `assembly-${ref}`,
      title: `集會遊行資訊｜${category || "活動"} ${coord.region || ""}`.trim(),
      region: coord.region,
      lat: coord.lat,
      lng: coord.lng,
      timestamp: parseSlashDateTime(start),
      category: "治安",
      scope: "domestic",
      riskLevel: assemblyRisk(category, route),
      summary: `${authority || "主管警察機關"}公告${category || "集會遊行"}，時間 ${start || "—"} 至 ${end || "—"}，地點／路線：${String(route || "—").slice(0, 180)}。`,
      source: provenance({
        name: "警政署 集會遊行資訊",
        datasetId: ASSEMBLY_DATASET,
        recordRef: ref,
        url: `https://data.gov.tw/dataset/${ASSEMBLY_DATASET}`,
        fetchedAt,
        query: `query_rows ${ASSEMBLY_DATASET} WHERE actStTime LIKE '20%' ORDER BY actStTime DESC`,
      }),
    };
  });
}

async function fetchTaipeiTrafficSpots({ url, token, limit = 10 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: TAIPEI_TRAFFIC_SPOTS_DATASET,
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row, n) => {
    const occurred = rowVal(row, columns, "發生時間");
    const proc = rowVal(row, columns, "處理別");
    const loc = String(rowVal(row, columns, "肇事地點") || "").replace(/^"+|"+$/g, "");
    const lng = Number(rowVal(row, columns, "座標-X"));
    const lat = Number(rowVal(row, columns, "座標-Y"));
    const coord = countyCoordFromAddr(`臺北市${loc}`) || TAIPEI_CENTER;
    const ref = `${occurred}-${loc.slice(0, 28)}-${n}`;
    const casualtyText = proc === "1" ? "死亡1;受傷0" : proc === "2" ? "死亡0;受傷1" : "死亡0;受傷0";
    return {
      id: `taipei-traffic-spot-${ref}`,
      title: `臺北交通事故斑點｜${loc.slice(0, 32) || "地點待查"}`,
      region: coord.region || "臺北市",
      lat: Number.isFinite(lat) ? lat : coord.lat,
      lng: Number.isFinite(lng) ? lng : coord.lng,
      timestamp: localDateTimeToIso(occurred) || fetchedAt,
      category: "交通",
      scope: "domestic",
      riskLevel: trafficRisk(proc === "1" ? "A1" : proc === "2" ? "A2" : "A3", casualtyText),
      summary: `臺北市道路交通事故斑點圖，處理別 ${proc || "—"}，地點：${loc || "—"}。`,
      source: provenance({
        name: "臺北市政府警察局 道路交通事故斑點圖",
        datasetId: TAIPEI_TRAFFIC_SPOTS_DATASET,
        recordRef: ref,
        url: `https://data.gov.tw/dataset/${TAIPEI_TRAFFIC_SPOTS_DATASET}`,
        fetchedAt,
        query: `query_rows ${TAIPEI_TRAFFIC_SPOTS_DATASET}`,
      }),
    };
  });
}

async function fetchTaipeiTrafficViolations({ url, token, limit = 10 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: TAIPEI_TRAFFIC_VIOLATION_DATASET,
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row, n) => {
    const year = rowVal(row, columns, "西元年");
    const month = rowVal(row, columns, "月份");
    const time = rowVal(row, columns, "時間") || "00:00:00";
    const fact = rowVal(row, columns, "fact");
    const area = rowVal(row, columns, "AreaName");
    const road = rowVal(row, columns, "Road");
    const law = rowVal(row, columns, "law");
    const coord = countyCoordFromAddr(`臺北市${area || ""}${road || ""}`) || TAIPEI_CENTER;
    const ref = `${year}-${month}-${time}-${area}-${road}-${law}-${n}`;
    return {
      id: `taipei-violation-${ref}`,
      title: `臺北交通違規舉發｜${String(road || area || "地點待查").slice(0, 32)}`,
      region: coord.region || "臺北市",
      lat: coord.lat,
      lng: coord.lng,
      timestamp: `${year || "2024"}-${String(month || "01").padStart(2, "0")}-01T${time}+08:00`,
      category: "交通",
      scope: "domestic",
      riskLevel: enforcementRisk(fact, ""),
      summary: `臺北市交通違規舉發紀錄：${fact || "違規事實待查"}，地點：${area || "—"} ${road || "—"}，法條代碼 ${law || "—"}。`,
      source: provenance({
        name: "臺北市政府警察局 交通違規舉發項目及地點",
        datasetId: TAIPEI_TRAFFIC_VIOLATION_DATASET,
        recordRef: ref,
        url: `https://data.gov.tw/dataset/${TAIPEI_TRAFFIC_VIOLATION_DATASET}`,
        fetchedAt,
        query: `query_rows ${TAIPEI_TRAFFIC_VIOLATION_DATASET}`,
      }),
    };
  });
}

async function fetchKaohsiungA3Traffic({ url, token, limit = 10 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: KHH_A3_TRAFFIC_DATASET,
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row) => {
    const ref = rowVal(row, columns, "Seq");
    const occurred = rowVal(row, columns, "發生日期");
    const district = rowVal(row, columns, "鄉鎮市區");
    const road = rowVal(row, columns, "街路");
    const cross = rowVal(row, columns, "街路交岔路");
    const type = rowVal(row, columns, "事故類型及型態說明");
    const loc = `高雄市${district || ""}${road || ""}${cross ? `/${cross}` : ""}`;
    const coord = countyCoordFromAddr(loc) || { region: "高雄市", lat: 22.6273, lng: 120.3014 };
    return {
      id: `khh-a3-traffic-${ref}`,
      title: `高雄 A3 交通事故｜${district || "—"}`,
      region: `高雄市${district || ""}`,
      lat: coord.lat,
      lng: coord.lng,
      timestamp: localDateTimeToIso(occurred) || slashDateToIso(occurred) || fetchedAt,
      category: "交通",
      scope: "domestic",
      riskLevel: "low",
      summary: `高雄市政府警察局 A3 交通事故資料：${type || "事故型態待查"}，地點：${road || "—"}${cross ? `／${cross}` : ""}。`,
      source: provenance({
        name: "高雄市政府警察局 小港區 A3 交通事故",
        datasetId: KHH_A3_TRAFFIC_DATASET,
        recordRef: String(ref),
        url: `https://data.gov.tw/dataset/${KHH_A3_TRAFFIC_DATASET}`,
        fetchedAt,
        query: `query_rows ${KHH_A3_TRAFFIC_DATASET}`,
      }),
    };
  });
}

async function fetchKaohsiungFixedCameras({ url, token, limit = 10 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: KHH_FIXED_CAMERA_DATASET,
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row) => {
    const ref = rowVal(row, columns, "編號");
    const kind = rowVal(row, columns, "型式");
    const loc = rowVal(row, columns, "測照地點");
    const direction = rowVal(row, columns, "測照方向");
    const speed = rowVal(row, columns, "速限");
    const district = rowVal(row, columns, "行政區");
    const enforcement = rowVal(row, columns, "測照型式");
    const lat = Number(rowVal(row, columns, "座標緯度"));
    const lng = Number(rowVal(row, columns, "座標經度"));
    const coord = countyCoordFromAddr(`高雄市${district || ""}`) || { region: "高雄市", lat: 22.6273, lng: 120.3014 };
    return {
      id: `khh-fixed-camera-${ref}`,
      title: `高雄固定式違規照相｜${String(loc || "地點待查").slice(0, 34)}`,
      region: `高雄市${district || ""}`,
      lat: Number.isFinite(lat) ? lat : coord.lat,
      lng: Number.isFinite(lng) ? lng : coord.lng,
      timestamp: fetchedAt,
      category: "交通",
      scope: "domestic",
      riskLevel: enforcementRisk(enforcement, speed),
      summary: `高雄市科技執法固定式設備：${kind || "設備型式待查"}，取締 ${enforcement || "—"}，方向 ${direction || "—"}，速限 ${speed || "—"}，地點：${loc || "—"}。`,
      source: provenance({
        name: "高雄市政府警察局 固定式違規照相設備",
        datasetId: KHH_FIXED_CAMERA_DATASET,
        recordRef: String(ref),
        url: `https://data.gov.tw/dataset/${KHH_FIXED_CAMERA_DATASET}`,
        fetchedAt,
        query: `query_rows ${KHH_FIXED_CAMERA_DATASET}`,
      }),
    };
  });
}

async function fetchKaohsiungAverageSpeedCameras({ url, token, limit = 10 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: KHH_AVG_SPEED_CAMERA_DATASET,
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row) => {
    const ref = rowVal(row, columns, "Seq") || rowVal(row, columns, "編號");
    const loc = rowVal(row, columns, "地點");
    const speed = rowVal(row, columns, "速限");
    const item = rowVal(row, columns, "取締項目");
    const length = rowVal(row, columns, "偵側長度");
    const lat = Number(rowVal(row, columns, "座標緯N度"));
    const lng = Number(rowVal(row, columns, "座標經E度"));
    const coord = countyCoordFromAddr(`高雄市${loc || ""}`) || { region: "高雄市", lat: 22.6273, lng: 120.3014 };
    return {
      id: `khh-avg-speed-camera-${ref}`,
      title: `高雄區間測速｜${String(loc || "地點待查").slice(0, 34)}`,
      region: coord.region || "高雄市",
      lat: Number.isFinite(lat) ? lat : coord.lat,
      lng: Number.isFinite(lng) ? lng : coord.lng,
      timestamp: fetchedAt,
      category: "交通",
      scope: "domestic",
      riskLevel: enforcementRisk(item, speed),
      summary: `高雄市區間平均速率執法設備：${item || "取締項目待查"}，速限 ${speed || "—"}，偵測長度 ${length || "—"}，地點：${loc || "—"}。`,
      source: provenance({
        name: "高雄市政府警察局 區間平均速率執法設備",
        datasetId: KHH_AVG_SPEED_CAMERA_DATASET,
        recordRef: String(ref),
        url: `https://data.gov.tw/dataset/${KHH_AVG_SPEED_CAMERA_DATASET}`,
        fetchedAt,
        query: `query_rows ${KHH_AVG_SPEED_CAMERA_DATASET}`,
      }),
    };
  });
}

async function fetchHsinchuCityTrafficStats({ url, token, limit = 10 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: HSINCHU_CITY_TRAFFIC_STATS_DATASET,
    order_by: "年度 DESC, 月份 DESC",
    limit,
  });
  const fetchedAt = new Date().toISOString();
  const coord = countyCoordFromAddr("新竹市") || { region: "新竹市", lat: 24.8138, lng: 120.9675 };
  return rows.map((row) => {
    const year = rowVal(row, columns, "年度");
    const month = rowVal(row, columns, "月份");
    const a1Cases = rowVal(row, columns, "A1件數");
    const deaths = rowVal(row, columns, "A1死亡");
    const a1Injuries = rowVal(row, columns, "A1受傷");
    const a2Cases = rowVal(row, columns, "A2件數");
    const a2Injuries = rowVal(row, columns, "A2受傷");
    const ref = `${year}-${month}`;
    return {
      id: `hcc-traffic-stats-${ref}`,
      title: `新竹市交通事故月統計｜${year}年${month}月`,
      region: "新竹市",
      lat: coord.lat,
      lng: coord.lng,
      timestamp: rocYmToIso(`${year}${String(month || "").padStart(2, "0")}`) || fetchedAt,
      category: "交通",
      scope: "domestic",
      riskLevel: trafficRisk(Number(deaths) > 0 ? "A1" : "A2", `死亡${deaths || 0};受傷${Number(a1Injuries || 0) + Number(a2Injuries || 0)}`),
      summary: `新竹市警察局每月交通事故統計：A1 ${a1Cases || "—"} 件／死亡 ${deaths || "0"} 人／受傷 ${a1Injuries || "0"} 人，A2 ${a2Cases || "—"} 件／受傷 ${a2Injuries || "0"} 人。`,
      source: provenance({
        name: "新竹市警察局 每月交通事故統計",
        datasetId: HSINCHU_CITY_TRAFFIC_STATS_DATASET,
        recordRef: ref,
        url: `https://data.gov.tw/dataset/${HSINCHU_CITY_TRAFFIC_STATS_DATASET}`,
        fetchedAt,
        query: `query_rows ${HSINCHU_CITY_TRAFFIC_STATS_DATASET} ORDER BY 年度 DESC, 月份 DESC`,
      }),
    };
  });
}

async function fetchHsinchuCountyAverageSpeed({ url, token, limit = 10 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: HSINCHU_COUNTY_AVG_SPEED_DATASET,
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row) => {
    const ref = rowVal(row, columns, "編號");
    const loc = rowVal(row, columns, "設置地點");
    const precinct = rowVal(row, columns, "轄區分局");
    const item = rowVal(row, columns, "取締項目");
    const speed = rowVal(row, columns, "速度限制");
    const length = rowVal(row, columns, "偵測長度");
    const coord = countyCoordFromAddr(`新竹縣${loc || ""}`) || { region: "新竹縣", lat: 24.8389, lng: 121.0177 };
    return {
      id: `hsinchu-county-avg-speed-${ref}`,
      title: `新竹縣區間測速｜${String(loc || "地點待查").slice(0, 34)}`,
      region: coord.region || "新竹縣",
      lat: coord.lat,
      lng: coord.lng,
      timestamp: fetchedAt,
      category: "交通",
      scope: "domestic",
      riskLevel: enforcementRisk(item, speed),
      summary: `${precinct || "新竹縣政府警察局"}區間平均速率裝置：${item || "取締項目待查"}，速限 ${speed || "—"}，偵測長度 ${length || "—"}，地點：${loc || "—"}。`,
      source: provenance({
        name: "新竹縣政府警察局 區間平均速率裝置",
        datasetId: HSINCHU_COUNTY_AVG_SPEED_DATASET,
        recordRef: String(ref),
        url: `https://data.gov.tw/dataset/${HSINCHU_COUNTY_AVG_SPEED_DATASET}`,
        fetchedAt,
        query: `query_rows ${HSINCHU_COUNTY_AVG_SPEED_DATASET}`,
      }),
    };
  });
}

async function fetchChiayiTheftPoints({ url, token, perDataset = 10 }) {
  const fetchedAt = new Date().toISOString();
  const events = [];
  for (const ds of CHIAYI_THEFT_DATASETS) {
    const { columns, rows } = await queryTwinkleRows({
      url,
      token,
      dataset_id: ds.datasetId,
      limit: perDataset,
    });
    for (const row of rows) {
      const ref = rowVal(row, columns, "編號");
      const desc = rowVal(row, columns, "描述");
      const occurred = rowVal(row, columns, "發生時間");
      const loc = rowVal(row, columns, "發生地點");
      const coord = countyCoordFromAddr(loc) || { region: "嘉義縣", lat: 23.4518, lng: 120.2555 };
      const recordRef = `${occurred}-${ref}`;
      events.push({
        id: `chiayi-theft-${ds.datasetId}-${recordRef}`,
        title: `嘉義縣${ds.label}｜${String(loc || "地點待查").slice(0, 28)}`,
        region: coord.region || "嘉義縣",
        lat: coord.lat,
        lng: coord.lng,
        timestamp: rocYmdHmToIso(occurred) || fetchedAt,
        category: "治安",
        scope: "domestic",
        riskLevel: crimeRisk(ds.label),
        summary: `嘉義縣警察局${ds.label}點位資訊，發生時間 ${occurred || "—"}，地點：${loc || "—"}。${desc || ""}`,
        source: provenance({
          name: `嘉義縣警察局 ${ds.label}點位資訊`,
          datasetId: ds.datasetId,
          recordRef,
          url: `https://data.gov.tw/dataset/${ds.datasetId}`,
          fetchedAt,
          query: `query_rows ${ds.datasetId}`,
        }),
      });
    }
  }
  return events;
}

async function fetchYilanCctv({ url, token, limit = 200 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: YILAN_CCTV_DATASET,
    limit,
  });
  const fetchedAt = new Date().toISOString();
  const county = "宜蘭縣";
  return rows.map((row, idx) => {
    const year = rowVal(row, columns, "建置年度");
    const precinct = rowVal(row, columns, "分局");
    const loc = rowVal(row, columns, "建置地點");
    const cameras = rowVal(row, columns, "鏡頭數");
    const ref = `${year}-${precinct}-${loc || idx}`;
    const coord = coordOrCounty(county, { text: loc });
    return {
      id: `yilan-cctv-${ref}`,
      title: `宜蘭治安交通監錄｜${cleanCell(loc || "地點待查").slice(0, 34)}`,
      region: regionFromCountyPlace(county, loc),
      lat: coord.lat,
      lng: coord.lng,
      timestamp: fetchedAt,
      category: "治安",
      scope: "domestic",
      riskLevel: numericCell(cameras) >= 8 ? "medium" : "low",
      summary: `宜蘭縣政府警察局治安與交通要點監錄系統：${precinct || "分局待查"}，建置年度 ${year || "—"}，鏡頭數 ${cameras || "—"}，地點：${loc || "—"}。`,
      source: provenance({
        name: "宜蘭縣政府警察局 治安與交通要點監錄系統",
        datasetId: YILAN_CCTV_DATASET,
        recordRef: String(ref),
        url: `https://data.gov.tw/dataset/${YILAN_CCTV_DATASET}`,
        fetchedAt,
        query: `query_rows ${YILAN_CCTV_DATASET}`,
      }),
    };
  });
}

function miaoliStatEvents({ rows, columns, datasetId, sourceName, idPrefix, fetchedAt, metricKind }) {
  const coord = coordOrCounty("苗栗縣");
  const header = rows[0] || [];
  const monthLabels = header.slice(1, 13).map(cleanCell);
  const year = cleanCell(sourceName).match(/(\d{2,3})/)?.[1] || "110";
  return rows
    .slice(1)
    .filter((row) => cleanCell(row[0]) && cleanCell(row[0]) !== "合計")
    .map((row) => {
      const label = cleanCell(row[0]);
      const total = cleanCell(row[13]) || String(row.slice(1).reduce((sum, value) => sum + numericCell(value), 0));
      const monthly = monthLabels
        .map((month, idx) => `${month || `${idx + 1}月`}:${cleanCell(row[idx + 1]) || "0"}`)
        .join("、");
      const recordRef = `${year}-${label}`;
      const isSerious = /重大刑案|一般刑案|交通/.test(label);
      return {
        id: `${idPrefix}-${recordRef}`,
        title: `苗栗警察局${metricKind}｜${label}`,
        region: "苗栗縣",
        lat: coord.lat,
        lng: coord.lng,
        timestamp: rocYmToIso(`${year}12`) || fetchedAt,
        category: /交通/.test(label) ? "交通" : "治安",
        scope: "domestic",
        riskLevel: isSerious && numericCell(total) > 0 ? "medium" : "low",
        summary: `苗栗縣警察局${metricKind}：${label}合計 ${total || "0"} 件；月別 ${monthly}。`,
        source: provenance({
          name: sourceName,
          datasetId,
          recordRef,
          url: `https://data.gov.tw/dataset/${datasetId}`,
          fetchedAt,
          query: `query_rows ${datasetId}`,
        }),
      };
    });
}

async function fetchMiaoliReportStats({ url, token, limit = 12 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: MIAOLI_REPORT_STATS_DATASET,
    limit,
  });
  return miaoliStatEvents({
    rows,
    columns,
    datasetId: MIAOLI_REPORT_STATS_DATASET,
    sourceName: "苗栗縣警察勤務指揮中心 受理民眾報案統計",
    idPrefix: "miaoli-report-stats",
    fetchedAt: new Date().toISOString(),
    metricKind: "報案統計",
  });
}

async function fetchMiaoliCaseStats({ url, token, limit = 12 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: MIAOLI_CASE_STATS_DATASET,
    limit,
  });
  return miaoliStatEvents({
    rows,
    columns,
    datasetId: MIAOLI_CASE_STATS_DATASET,
    sourceName: "苗栗縣警察勤務指揮中心 轄區治安交通案件統計",
    idPrefix: "miaoli-case-stats",
    fetchedAt: new Date().toISOString(),
    metricKind: "治安交通案件統計",
  });
}

async function fetchNantouTechEnforcement({ url, token, limit = 10 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: NANTOU_TECH_ENFORCEMENT_DATASET,
    limit,
  });
  const fetchedAt = new Date().toISOString();
  const county = "南投縣";
  return rows.map((row, idx) => {
    const loc = rowVal(row, columns, "設置地點");
    const direction = rowVal(row, columns, "拍攝方向");
    const item = rowVal(row, columns, "取締項目");
    const ref = `${loc || idx}-${direction || ""}`;
    const coord = coordOrCounty(county, { text: loc });
    return {
      id: `nantou-tech-enforcement-${ref}`,
      title: `南投科技執法禁駛路段｜${cleanCell(loc || "地點待查").slice(0, 34)}`,
      region: regionFromCountyPlace(county, loc),
      lat: coord.lat,
      lng: coord.lng,
      timestamp: fetchedAt,
      category: "交通",
      scope: "domestic",
      riskLevel: enforcementRisk(item, ""),
      summary: `南投縣政府警察局固定式科技執法禁駛路段設備：取締 ${item || "—"}，方向 ${direction || "—"}，地點：${loc || "—"}。`,
      source: provenance({
        name: "南投縣政府警察局 固定式科技執法禁駛路段",
        datasetId: NANTOU_TECH_ENFORCEMENT_DATASET,
        recordRef: String(ref),
        url: `https://data.gov.tw/dataset/${NANTOU_TECH_ENFORCEMENT_DATASET}`,
        fetchedAt,
        query: `query_rows ${NANTOU_TECH_ENFORCEMENT_DATASET}`,
      }),
    };
  });
}

async function fetchNantouImpoundLots({ url, token, limit = 10 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: NANTOU_IMPOUND_LOTS_DATASET,
    limit,
  });
  const fetchedAt = new Date().toISOString();
  const county = "南投縣";
  return rows.map((row, idx) => {
    const name = rowVal(row, columns, "名稱");
    const loc = rowVal(row, columns, "設置位置");
    const tel = rowVal(row, columns, "電話");
    const ref = `${name || idx}-${loc || ""}`;
    const coord = coordOrCounty(county, { text: loc });
    return {
      id: `nantou-impound-lot-${ref}`,
      title: `南投違規車輛保管場｜${cleanCell(name || "名稱待查").slice(0, 32)}`,
      region: regionFromCountyPlace(county, loc, name),
      lat: coord.lat,
      lng: coord.lng,
      timestamp: fetchedAt,
      category: "交通",
      scope: "domestic",
      riskLevel: "low",
      summary: `南投縣政府警察局違規車輛保管場：${name || "—"}，地址 ${loc || "—"}，電話 ${tel || "—"}。`,
      source: provenance({
        name: "南投縣政府警察局 違規車輛保管場",
        datasetId: NANTOU_IMPOUND_LOTS_DATASET,
        recordRef: String(ref),
        url: `https://data.gov.tw/dataset/${NANTOU_IMPOUND_LOTS_DATASET}`,
        fetchedAt,
        query: `query_rows ${NANTOU_IMPOUND_LOTS_DATASET}`,
      }),
    };
  });
}

async function fetchPingtungCctv({ url, token, limit = 300 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: PINGTUNG_CCTV_DATASET,
    limit,
  });
  const fetchedAt = new Date().toISOString();
  const county = "屏東縣";
  return rows.map((row) => {
    const ref = rowVal(row, columns, "number");
    const town = rowVal(row, columns, "towns");
    const loc = rowVal(row, columns, "location");
    const lenses = rowVal(row, columns, "Camera_lens_Quantity");
    const coord = coordOrCounty(county, { text: `${town || ""}${loc || ""}` });
    return {
      id: `pingtung-cctv-${ref}`,
      title: `屏東路口錄監系統｜${cleanCell(loc || "地點待查").slice(0, 34)}`,
      region: regionFromCountyPlace(county, town),
      lat: coord.lat,
      lng: coord.lng,
      timestamp: fetchedAt,
      category: "治安",
      scope: "domestic",
      riskLevel: numericCell(lenses) >= 8 ? "medium" : "low",
      summary: `屏東縣政府警察局路口錄監系統：${town || "鄉鎮待查"}，鏡頭 ${lenses || "—"} 支，地點：${loc || "—"}。`,
      source: provenance({
        name: "屏東縣政府警察局 路口錄監系統設置地點",
        datasetId: PINGTUNG_CCTV_DATASET,
        recordRef: String(ref),
        url: `https://data.gov.tw/dataset/${PINGTUNG_CCTV_DATASET}`,
        fetchedAt,
        query: `query_rows ${PINGTUNG_CCTV_DATASET}`,
      }),
    };
  });
}

async function fetchPingtungCrashHotspots({ url, token, limit = 30 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: PINGTUNG_CRASH_HOTSPOTS_DATASET,
    limit,
  });
  const fetchedAt = new Date().toISOString();
  const county = "屏東縣";
  return rows.map((row) => {
    const ref = rowVal(row, columns, "number(編號)");
    const loc = rowVal(row, columns, "location(地點)");
    const cases = rowVal(row, columns, "Item(件數)");
    const deaths = rowVal(row, columns, "Number of Fatality(死亡人數)");
    const injuries = rowVal(row, columns, "Number of Injury(受傷人數)");
    const coord = coordOrCounty(county, { text: loc });
    return {
      id: `pingtung-crash-hotspot-${ref}`,
      title: `屏東交通肇事熱點｜${cleanCell(loc || "地點待查").slice(0, 34)}`,
      region: regionFromCountyPlace(county, loc),
      lat: coord.lat,
      lng: coord.lng,
      timestamp: fetchedAt,
      category: "交通",
      scope: "domestic",
      riskLevel: trafficRisk(numericCell(deaths) > 0 ? "A1" : "A2", `死亡${deaths || 0};受傷${injuries || 0}`),
      summary: `屏東縣交通肇事案件熱點：${cases || "—"} 件、死亡 ${deaths || "0"} 人、受傷 ${injuries || "0"} 人，地點：${loc || "—"}。`,
      source: provenance({
        name: "屏東縣政府警察局 交通肇事案件資料",
        datasetId: PINGTUNG_CRASH_HOTSPOTS_DATASET,
        recordRef: String(ref),
        url: `https://data.gov.tw/dataset/${PINGTUNG_CRASH_HOTSPOTS_DATASET}`,
        fetchedAt,
        query: `query_rows ${PINGTUNG_CRASH_HOTSPOTS_DATASET}`,
      }),
    };
  });
}

async function fetchPingtungTechEnforcement({ url, token, limit = 30 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: PINGTUNG_TECH_ENFORCEMENT_DATASET,
    limit,
  });
  const fetchedAt = new Date().toISOString();
  const county = "屏東縣";
  return rows.map((row, idx) => {
    const city = rowVal(row, columns, "CityName(設置縣市)") || county;
    const town = rowVal(row, columns, "RegionName(設置市區鄉鎮)");
    const loc = rowVal(row, columns, "Address(設置地址)");
    const branch = rowVal(row, columns, "BranchNm(管轄分局)") || rowVal(row, columns, "DeptNm(管轄警局)");
    const lng = rowVal(row, columns, "Longitude(經度)");
    const lat = rowVal(row, columns, "Latitude(緯度)");
    const direction = rowVal(row, columns, "direct(拍攝方向)");
    const speed = rowVal(row, columns, "limit(速限)");
    const ref = `${town || ""}-${loc || idx}-${direction || ""}`;
    const coord = coordOrCounty(city, { lat, lng, text: loc });
    return {
      id: `pingtung-tech-enforcement-${ref}`,
      title: `屏東科技執法｜${cleanCell(loc || "地點待查").slice(0, 34)}`,
      region: `${String(city).replace(/^台/, "臺")}${town || ""}`,
      lat: coord.lat,
      lng: coord.lng,
      timestamp: fetchedAt,
      category: "交通",
      scope: "domestic",
      riskLevel: enforcementRisk(loc, speed),
      summary: `屏東縣科技執法路段及項目：${branch || "管轄分局待查"}，方向 ${direction || "—"}，速限 ${speed || "—"}，地址：${loc || "—"}。`,
      source: provenance({
        name: "屏東縣政府警察局 科技執法路段及項目",
        datasetId: PINGTUNG_TECH_ENFORCEMENT_DATASET,
        recordRef: String(ref),
        url: `https://data.gov.tw/dataset/${PINGTUNG_TECH_ENFORCEMENT_DATASET}`,
        fetchedAt,
        query: `query_rows ${PINGTUNG_TECH_ENFORCEMENT_DATASET}`,
      }),
    };
  });
}

async function fetchHualienAverageSpeed({ url, token, limit = 20 }) {
  const { rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: HUALIEN_AVG_SPEED_DATASET,
    limit,
  });
  const fetchedAt = new Date().toISOString();
  const county = "花蓮縣";
  return rows
    .filter((row) => /^\d+$/.test(cleanCell(row[0])))
    .map((row) => {
      const ref = cleanCell(row[0]);
      const loc = cleanCell(row[1]);
      const segment = cleanCell(row[2]);
      const distance = cleanCell(row[3]);
      const speed = cleanCell(row[4]);
      const tickets = cleanCell(row[5]);
      const coord = coordOrCounty(county, { text: loc });
      return {
        id: `hualien-avg-speed-${ref}`,
        title: `花蓮區間測速｜${loc.slice(0, 34) || "地點待查"}`,
        region: regionFromCountyPlace(county, loc),
        lat: coord.lat,
        lng: coord.lng,
        timestamp: fetchedAt,
        category: "交通",
        scope: "domestic",
        riskLevel: numericCell(tickets) >= 1000 ? "medium" : enforcementRisk(loc, speed),
        summary: `花蓮縣警察局區間平均速率科技執法：${loc || "—"}，起訖 ${segment || "—"}，距離 ${distance || "—"}，速限 ${speed || "—"}，112年舉發 ${tickets || "—"} 件。`,
        source: provenance({
          name: "花蓮縣警察局 區間測速執法地點",
          datasetId: HUALIEN_AVG_SPEED_DATASET,
          recordRef: `${ref}-${loc}`,
          url: `https://data.gov.tw/dataset/${HUALIEN_AVG_SPEED_DATASET}`,
          fetchedAt,
          query: `query_rows ${HUALIEN_AVG_SPEED_DATASET}`,
        }),
      };
    });
}

async function fetchTaitungAirRaidShelters({ url, token, limit = 300 }) {
  const { rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: TAITUNG_AIR_RAID_SHELTERS_DATASET,
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows
    .filter((row) => /^RMA\d+/.test(cleanCell(row[0])))
    .map((row) => {
      const ref = cleanCell(row[0]);
      const name = cleanCell(row[1]);
      const town = cleanCell(row[2]);
      const village = cleanCell(row[3]);
      const addr = cleanCell(row[4]);
      const lat = cleanCell(row[5]);
      const lng = cleanCell(row[6]);
      const floor = cleanCell(row[7]);
      const capacity = cleanCell(row[8]);
      const precinct = cleanCell(row[9]);
      const coord = coordOrCounty("臺東縣", { lat, lng, text: addr });
      return {
        id: `taitung-air-raid-shelter-${ref}`,
        title: `臺東防空避難設施｜${name.slice(0, 30) || "名稱待查"}`,
        region: `臺東縣${town || ""}${village || ""}`,
        lat: coord.lat,
        lng: coord.lng,
        timestamp: fetchedAt,
        category: "災防",
        scope: "domestic",
        riskLevel: numericCell(capacity) >= 500 ? "medium" : "low",
        summary: `臺東縣警察局防空疏散避難設施：${name || "—"}，容量 ${capacity || "—"} 人，樓層 ${floor || "—"}，轄管 ${precinct || "—"}，地址：${addr || "—"}。`,
        source: provenance({
          name: "臺東縣警察局 防空疏散避難設施位置",
          datasetId: TAITUNG_AIR_RAID_SHELTERS_DATASET,
          recordRef: ref,
          url: `https://data.gov.tw/dataset/${TAITUNG_AIR_RAID_SHELTERS_DATASET}`,
          fetchedAt,
          query: `query_rows ${TAITUNG_AIR_RAID_SHELTERS_DATASET}`,
        }),
      };
    });
}

async function fetchPenghuScienceEnforcement({ url, token, limit = 50 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: PENGHU_SCIENCE_ENFORCEMENT_DATASET,
    limit,
  });
  const fetchedAt = new Date().toISOString();
  const county = "澎湖縣";
  return rows.map((row, idx) => {
    const town = rowVal(row, columns, "所在市鄉鎮");
    const loc = rowVal(row, columns, "設置地址");
    const branch = rowVal(row, columns, "管轄分局");
    const lng = rowVal(row, columns, "經度");
    const lat = rowVal(row, columns, "緯度");
    const direction = rowVal(row, columns, "拍攝方向");
    const speed = rowVal(row, columns, "速限");
    const ref = `${town || ""}-${loc || idx}-${direction || ""}`;
    const coord = coordOrCounty(county, { lat, lng, text: loc });
    return {
      id: `penghu-science-enforcement-${ref}`,
      title: `澎湖科學儀器執法｜${cleanCell(loc || "地點待查").slice(0, 34)}`,
      region: `${county}${town || ""}`,
      lat: coord.lat,
      lng: coord.lng,
      timestamp: fetchedAt,
      category: "交通",
      scope: "domestic",
      riskLevel: enforcementRisk(loc, speed),
      summary: `澎湖縣科學儀器執法設備、固定式測速及闖紅燈照相：${branch || "管轄分局待查"}，方向 ${direction || "—"}，速限 ${speed || "—"}，地址：${loc || "—"}。`,
      source: provenance({
        name: "澎湖縣 科學儀器執法與固定式測速照相",
        datasetId: PENGHU_SCIENCE_ENFORCEMENT_DATASET,
        recordRef: String(ref),
        url: `https://data.gov.tw/dataset/${PENGHU_SCIENCE_ENFORCEMENT_DATASET}`,
        fetchedAt,
        query: `query_rows ${PENGHU_SCIENCE_ENFORCEMENT_DATASET}`,
      }),
    };
  });
}

async function fetchPenghuTrafficOrderStats({ url, token, limit = 36 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: PENGHU_TRAFFIC_ORDER_STATS_DATASET,
    order_by: "年度 DESC, 月份 DESC",
    limit,
  });
  const fetchedAt = new Date().toISOString();
  const coord = coordOrCounty("澎湖縣");
  return rows.map((row) => {
    const year = rowVal(row, columns, "年度");
    const month = rowVal(row, columns, "月份");
    const speeding = rowVal(row, columns, "超速-件數-");
    const dui = rowVal(row, columns, "酒後開車-件數-");
    const redLight = rowVal(row, columns, "闖紅燈-件數-");
    const total = rowVal(row, columns, "合計-件數-");
    const ref = `${year}-${month}`;
    return {
      id: `penghu-traffic-order-stats-${ref}`,
      title: `澎湖交通秩序成果｜${year}年${month}月`,
      region: "澎湖縣",
      lat: coord.lat,
      lng: coord.lng,
      timestamp: rocYmToIso(`${year}${String(month || "").padStart(2, "0")}`) || fetchedAt,
      category: "交通",
      scope: "domestic",
      riskLevel: numericCell(dui) > 0 || numericCell(redLight) >= 50 ? "medium" : "low",
      summary: `澎湖縣政府警察局整理交通秩序成果：超速 ${speeding || "0"} 件、酒駕 ${dui || "0"} 件、闖紅燈 ${redLight || "0"} 件、合計 ${total || "0"} 件。`,
      source: provenance({
        name: "澎湖縣政府警察局 整理交通秩序成果統計",
        datasetId: PENGHU_TRAFFIC_ORDER_STATS_DATASET,
        recordRef: ref,
        url: `https://data.gov.tw/dataset/${PENGHU_TRAFFIC_ORDER_STATS_DATASET}`,
        fetchedAt,
        query: `query_rows ${PENGHU_TRAFFIC_ORDER_STATS_DATASET} ORDER BY 年度 DESC, 月份 DESC`,
      }),
    };
  });
}

async function fetchKinmenAirRaidShelters({ url, token, limit = 160 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: KINMEN_AIR_RAID_SHELTERS_DATASET,
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row) => {
    const category = rowVal(row, columns, "類別");
    const ref = rowVal(row, columns, "電腦編號");
    const village = rowVal(row, columns, "村里別");
    const addr = rowVal(row, columns, "地址");
    const coordText = String(rowVal(row, columns, "緯經度") || "").replace("，", ",");
    const floor = rowVal(row, columns, "地下樓層數");
    const capacity = rowVal(row, columns, "可容納人數");
    const precinct = rowVal(row, columns, "轄管分局");
    const parsed = parseCoordPair(coordText);
    const coord = coordOrCounty("金門縣", { lat: parsed?.lat, lng: parsed?.lng, text: addr });
    return {
      id: `kinmen-air-raid-shelter-${ref}`,
      title: `金門防空避難設施｜${cleanCell(category || village || "名稱待查").slice(0, 30)}`,
      region: `金門縣${village || ""}`,
      lat: coord.lat,
      lng: coord.lng,
      timestamp: fetchedAt,
      category: "災防",
      scope: "domestic",
      riskLevel: numericCell(capacity) >= 500 ? "medium" : "low",
      summary: `金門縣警察局防空疏散避難設施：${category || "—"}，容量 ${capacity || "—"} 人，地下樓層 ${floor || "—"}，轄管 ${precinct || "—"}，地址：${addr || "—"}。`,
      source: provenance({
        name: "金門縣警察局 防空疏散避難設施位置",
        datasetId: KINMEN_AIR_RAID_SHELTERS_DATASET,
        recordRef: String(ref),
        url: `https://data.gov.tw/dataset/${KINMEN_AIR_RAID_SHELTERS_DATASET}`,
        fetchedAt,
        query: `query_rows ${KINMEN_AIR_RAID_SHELTERS_DATASET}`,
      }),
    };
  });
}

async function fetchLienchiangServiceStats({ url, token, limit = 10 }) {
  const { rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: LIENCHIANG_SERVICE_STATS_DATASET,
    limit,
  });
  const fetchedAt = new Date().toISOString();
  const totalRow = rows.find((row) => cleanCell(row[0]) === "總計");
  if (!totalRow) return [];
  const monthText = rows.map((row) => cleanCell(row[0])).find((value) => /中華民國\d{2,3}年\d{1,2}月/.test(value));
  const timestamp = rocChineseYmToIso(monthText) || fetchedAt;
  const coord = coordOrCounty("連江縣");
  const metrics = [
    { idx: 5, label: "住宅巡邏服務執行班次", unit: "次" },
    { idx: 8, label: "一般服務案件", unit: "件" },
    { idx: 13, label: "各類路況報導", unit: "次" },
    { idx: 16, label: "清查通報關懷濟助", unit: "件" },
    { idx: 22, label: "一一Ｏ受理報案服務", unit: "件" },
    { idx: 25, label: "其他為民服務", unit: "件" },
  ];
  return metrics.map((metric) => {
    const value = cleanCell(totalRow[metric.idx]) || "0";
    const recordRef = `${monthText || "unknown"}-${metric.label}`;
    return {
      id: `lienchiang-service-stats-${recordRef}`,
      title: `連江警察局為民服務｜${metric.label}`,
      region: "連江縣",
      lat: coord.lat,
      lng: coord.lng,
      timestamp,
      category: /路況|巡邏/.test(metric.label) ? "交通" : "治安",
      scope: "domestic",
      riskLevel: numericCell(value) >= 50 ? "medium" : "low",
      summary: `連江縣警察局為民服務成果統計：${metric.label} ${value} ${metric.unit}（${monthText || "月份待查"}）。`,
      source: provenance({
        name: "連江縣警察局 為民服務成果統計表",
        datasetId: LIENCHIANG_SERVICE_STATS_DATASET,
        recordRef,
        url: `https://data.gov.tw/dataset/${LIENCHIANG_SERVICE_STATS_DATASET}`,
        fetchedAt,
        query: `query_rows ${LIENCHIANG_SERVICE_STATS_DATASET}`,
      }),
    };
  });
}

async function fetchTainanCrimeAlerts({ url, token, limit = 4 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: TAINAN_ALERT_DATASET,
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row) => {
    const ref = rowVal(row, columns, "Seq");
    const loc = rowVal(row, columns, "地點位置");
    const precinct = rowVal(row, columns, "管轄分局");
    const mid = rowVal(row, columns, "中間點座標位置") || rowVal(row, columns, "起點座標");
    const coord = parseCoordPair(mid) || countyCoordFromAddr(loc) || { region: "臺南市" };
    return {
      id: `tainan-alert-${ref}`,
      title: `臺南婦幼犯罪警示｜${precinct || "—"}`,
      region: coord.region || "臺南市",
      lat: coord.lat,
      lng: coord.lng,
      timestamp: fetchedAt,
      category: "治安",
      scope: "domestic",
      riskLevel: "medium",
      summary: `臺南市政府警察局公告易發生婦幼被害犯罪警示路段：${loc || "—"}（${precinct || "管轄分局待查"}）。`,
      source: provenance({
        name: "臺南市政府警察局 易發生婦幼被害犯罪警示地點",
        datasetId: TAINAN_ALERT_DATASET,
        recordRef: String(ref),
        url: `https://data.gov.tw/dataset/${TAINAN_ALERT_DATASET}`,
        fetchedAt,
        query: `query_rows ${TAINAN_ALERT_DATASET}`,
      }),
    };
  });
}

async function fetchNtpcCrimeAlerts({ url, token, limit = 4 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: NTPC_ALERT_DATASET,
    where: "year >= '113'",
    order_by: "year DESC",
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row, n) => {
    const year = rowVal(row, columns, "year");
    const half = rowVal(row, columns, "six_months");
    const loc = rowVal(row, columns, "location");
    const precinct = rowVal(row, columns, "precinct");
    const ref = `${year}-${half}-${n}`;
    const coord = countyCoordFromAddr(loc) || { region: "新北市" };
    return {
      id: `ntpc-alert-${ref}`,
      title: `新北婦幼犯罪警示｜${precinct || "—"}`,
      region: coord.region || "新北市",
      lat: coord.lat,
      lng: coord.lng,
      timestamp: `${Number(year) + 1911}-06-01T12:00:00+08:00`,
      category: "治安",
      scope: "domestic",
      riskLevel: "medium",
      summary: `新北市政府警察局公告易發生婦幼被害犯罪地點（${year}年${half || ""}）：${loc || "—"}。`,
      source: provenance({
        name: "新北市政府警察局 易發生婦幼被害犯罪地點",
        datasetId: NTPC_ALERT_DATASET,
        recordRef: ref,
        url: `https://data.gov.tw/dataset/${NTPC_ALERT_DATASET}`,
        fetchedAt,
        query: `query_rows ${NTPC_ALERT_DATASET} WHERE year >= '113'`,
      }),
    };
  });
}

async function fetchFakeInvestmentSites({ url, token, limit = 5 }) {
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: FRAUD_INVEST_DATASET,
    order_by: "STA_EDATE DESC",
    limit: limit + 1,
  });
  const fetchedAt = new Date().toISOString();
  return rows
    .filter((row) => rowVal(row, columns, "WEBSITE_NM") !== "網站名稱")
    .slice(0, limit)
    .map((row) => {
      const name = rowVal(row, columns, "WEBSITE_NM");
      const weburl = rowVal(row, columns, "WEBURL");
      const cnt = rowVal(row, columns, "CNT");
      const end = rowVal(row, columns, "STA_EDATE");
      const ref = `${name}-${end}`;
      return {
        id: `fraud-invest-${ref}`,
        title: `假投資(博弈)網站：${name}`,
        region: "全國",
        timestamp: slashDateToIso(end) || fetchedAt,
        category: "反詐",
        scope: "domestic",
        riskLevel: Number(cnt) >= 3 ? "high" : "medium",
        summary: `165通報假投資／博弈網站 ${weburl || "—"}，統計件數 ${cnt || "—"}（至 ${end || "—"}）。`,
        source: provenance({
          name: "165反詐騙諮詢專線 假投資(博弈)網站",
          datasetId: FRAUD_INVEST_DATASET,
          recordRef: ref,
          url: `https://data.gov.tw/dataset/${FRAUD_INVEST_DATASET}`,
          fetchedAt,
          query: "query_rows 160055 ORDER BY STA_EDATE DESC",
        }),
      };
    });
}

async function fetchCrimeWeekly() {
  const fetchedAt = new Date().toISOString();
  const result = spawnSync("python3", [CRIME_WEEKLY_SCRIPT], {
    encoding: "utf8",
    env: crimeWeeklySpawnEnv(),
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "crime weekly parse failed");
  }
  const payload = JSON.parse(result.stdout.trim());
  if (payload.error) throw new Error(payload.error);

  const periodKey = String(payload.period || payload.fileName || "weekly").replace(/\s/g, "");
  const timestamp = payload.periodEnd || fetchedAt;
  const counts = payload.currentCounts || {};
  const events = [
    {
      id: `crime-week-summary-${periodKey}`,
      title: `犯罪週統計｜${payload.period || "最新一週"}`,
      region: "全國",
      timestamp,
      category: "治安",
      scope: "domestic",
      riskLevel: weeklyCrimeRisk("毒品", counts["毒品"] || payload.totalCurrent),
      summary: `警政署週報當期發生數合計 ${payload.totalCurrent ?? "—"} 件（${Object.entries(counts)
        .map(([k, v]) => `${k}${v}`)
        .join("、")}）。${payload.compiledAt || ""} 此為全國統計摘要，非單點事件。`,
      source: provenance({
        name: "警政署 犯罪資料統計週報",
        datasetId: "13166",
        recordRef: payload.fileName,
        url: payload.sourceUrl || "https://data.gov.tw/dataset/13166",
        fetchedAt,
        query: "download ZIP 13166 → parse latest ODS 當期發生數",
      }),
    },
  ];

  for (const [caseType, count] of Object.entries(counts)) {
    if (!count || Number(count) <= 0) continue;
    events.push({
      id: `crime-week-${periodKey}-${caseType}`,
      title: `週統計｜${caseType} ${count} 件`,
      region: "全國",
      timestamp,
      category: "治安",
      scope: "domestic",
      riskLevel: weeklyCrimeRisk(caseType, count),
      summary: `${payload.period || "最新一週"}當期發生 ${caseType} ${count} 件（全國週統計摘要）。`,
      source: provenance({
        name: "警政署 犯罪資料統計週報",
        datasetId: "13166",
        recordRef: `${payload.fileName}:${caseType}`,
        url: payload.sourceUrl || "https://data.gov.tw/dataset/13166",
        fetchedAt,
        query: "download ZIP 13166 → parse latest ODS 當期發生數",
      }),
    });
  }

  return events;
}

async function fetchPoliceTenders({ url, token, today, limit = 8 }) {
  const where = PCC_POLICE_QUERY.replace("{TODAY}", today);
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: "pcc-tender",
    where,
    limit,
  });
  const fetchedAt = new Date().toISOString();
  return rows.map((row, n) => {
    const job = rowVal(row, columns, "job_number") || `row${n}`;
    const addr = rowVal(row, columns, "agency_addr");
    const coord = countyCoordFromAddr(addr) || { region: "全國" };
    const price = rowVal(row, columns, "award_price");
    return {
      id: `pcc-police-${job}`,
      title: rowVal(row, columns, "title") || "（無標題）",
      region: coord.region,
      lat: coord.lat,
      lng: coord.lng,
      timestamp: `${rowVal(row, columns, "date")}T00:00:00+08:00`,
      category: "採購",
      scope: "domestic",
      riskLevel: riskByPrice(price),
      summary: `${rowVal(row, columns, "agency") || "警政機關"}以${rowVal(row, columns, "award_way") || "—"}決標予${rowVal(row, columns, "companies") || "—"}，金額 ${formatNtd(price)}。`,
      source: provenance({
        name: "政府電子採購網 警政決標公告",
        datasetId: "pcc-tender",
        recordRef: job,
        url: rowVal(row, columns, "detail_url") || "https://web.pcc.gov.tw/pis/",
        fetchedAt,
        query: `query_rows pcc-tender (警政): ${where}`,
      }),
    };
  });
}

export const POLICE_TAIPEI_IDS = new Set(TAIPEI_CRIME_DATASETS.map((d) => d.datasetId));

export const POLICE_DATASET_IDS = new Set([
  "177136",
  "176455",
  "38262",
  "13908",
  "13166",
  "172159",
  TAICHUNG_TRAFFIC_DATASET,
  TAICHUNG_HOTSPOT_DATASET,
  TAOYUAN_THEFT_DATASET,
  TAINAN_ALERT_DATASET,
  NTPC_ALERT_DATASET,
  FRAUD_INVEST_DATASET,
  POLICE_NEWS_DATASET,
  HISTORICAL_TRAFFIC_DATASET,
  DRUG_CRIME_DATASET,
  ASSEMBLY_DATASET,
  TAIPEI_TRAFFIC_SPOTS_DATASET,
  TAIPEI_TRAFFIC_VIOLATION_DATASET,
  KHH_A3_TRAFFIC_DATASET,
  KHH_FIXED_CAMERA_DATASET,
  KHH_AVG_SPEED_CAMERA_DATASET,
  HSINCHU_CITY_TRAFFIC_STATS_DATASET,
  HSINCHU_COUNTY_AVG_SPEED_DATASET,
  YILAN_CCTV_DATASET,
  MIAOLI_REPORT_STATS_DATASET,
  MIAOLI_CASE_STATS_DATASET,
  NANTOU_TECH_ENFORCEMENT_DATASET,
  NANTOU_IMPOUND_LOTS_DATASET,
  PINGTUNG_CCTV_DATASET,
  PINGTUNG_CRASH_HOTSPOTS_DATASET,
  PINGTUNG_TECH_ENFORCEMENT_DATASET,
  HUALIEN_AVG_SPEED_DATASET,
  TAITUNG_AIR_RAID_SHELTERS_DATASET,
  PENGHU_SCIENCE_ENFORCEMENT_DATASET,
  PENGHU_TRAFFIC_ORDER_STATS_DATASET,
  KINMEN_AIR_RAID_SHELTERS_DATASET,
  LIENCHIANG_SERVICE_STATS_DATASET,
  ...CHIAYI_THEFT_DATASETS.map((d) => d.datasetId),
  ...POLICE_TAIPEI_IDS,
]);

export function isPoliceDomesticEvent(event) {
  const ds = event?.source?.datasetId;
  if (ds && POLICE_DATASET_IDS.has(ds)) return true;
  if (event?.category === "反詐") return true;
  if (event?.source?.query?.includes("警政")) return true;
  if (event?.id?.startsWith("pcc-police-")) return true;
  if (event?.id?.startsWith("speed-")) return true;
  if (event?.id?.startsWith("fraud-dash-")) return true;
  if (event?.id?.startsWith("crime-week-")) return true;
  if (event?.id?.startsWith("taichung-traffic-")) return true;
  if (event?.id?.startsWith("taichung-hotspot-")) return true;
  if (event?.id?.startsWith("taoyuan-theft-")) return true;
  if (event?.id?.startsWith("tainan-alert-")) return true;
  if (event?.id?.startsWith("ntpc-alert-")) return true;
  if (event?.id?.startsWith("fraud-invest-")) return true;
  if (event?.id?.startsWith("police-news-")) return true;
  if (event?.id?.startsWith("traffic-history-")) return true;
  if (event?.id?.startsWith("drug-crime-")) return true;
  if (event?.id?.startsWith("assembly-")) return true;
  if (event?.id?.startsWith("taipei-traffic-spot-")) return true;
  if (event?.id?.startsWith("taipei-violation-")) return true;
  if (event?.id?.startsWith("khh-a3-traffic-")) return true;
  if (event?.id?.startsWith("khh-fixed-camera-")) return true;
  if (event?.id?.startsWith("khh-avg-speed-camera-")) return true;
  if (event?.id?.startsWith("hcc-traffic-stats-")) return true;
  if (event?.id?.startsWith("hsinchu-county-avg-speed-")) return true;
  if (event?.id?.startsWith("chiayi-theft-")) return true;
  if (event?.id?.startsWith("yilan-cctv-")) return true;
  if (event?.id?.startsWith("miaoli-report-stats-")) return true;
  if (event?.id?.startsWith("miaoli-case-stats-")) return true;
  if (event?.id?.startsWith("nantou-tech-enforcement-")) return true;
  if (event?.id?.startsWith("nantou-impound-lot-")) return true;
  if (event?.id?.startsWith("pingtung-cctv-")) return true;
  if (event?.id?.startsWith("pingtung-crash-hotspot-")) return true;
  if (event?.id?.startsWith("pingtung-tech-enforcement-")) return true;
  if (event?.id?.startsWith("hualien-avg-speed-")) return true;
  if (event?.id?.startsWith("taitung-air-raid-shelter-")) return true;
  if (event?.id?.startsWith("penghu-science-enforcement-")) return true;
  if (event?.id?.startsWith("penghu-traffic-order-stats-")) return true;
  if (event?.id?.startsWith("kinmen-air-raid-shelter-")) return true;
  if (event?.id?.startsWith("lienchiang-service-stats-")) return true;
  if (event?.id?.startsWith("judicial-")) return true;
  if (event?.id?.startsWith("missing-")) return true;
  return false;
}

// ----------------------------------------------------------------------------
// Tier-2 統計型來源：全國刑案率、臺中取締酒駕、臺北家暴通報
// 皆比照 fetchFraudDashboard，將「最新一期統計」轉成單筆 IntelEvent（誠實標註為統計摘要）。
// 純 mapper 與期別解析抽離出來，供測試直接驗證（不需網路）。
// ----------------------------------------------------------------------------

// 解析 ROC 期別字串（"114年12月" 或 "115年 4月/ 機關別總計"）→ { year, month, key }
// 年彙總（"115年/..."）與累計（"115年 (1~4月)/..."）一律回 null（只取單月）。
export function parseRocPeriodLabel(label) {
  const m = cleanCell(label).match(/(\d{2,3})\s*年\s*(\d{1,2})\s*月/);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    key: `${m[1]}${String(m[2]).padStart(2, "0")}`,
  };
}

// 從一組期別字串挑出最新單月（年大優先、同年取月大）。
export function latestRocPeriod(labels) {
  let best = null;
  for (const label of labels) {
    const p = parseRocPeriodLabel(label);
    if (!p) continue;
    if (!best || p.year > best.year || (p.year === best.year && p.month > best.month)) {
      best = { ...p, label: cleanCell(label) };
    }
  }
  return best;
}

// 103351 發生率 + 103352 破獲率（皆「機關別總計」月列）→ 最新月一筆全國統計事件。
export function mapCrimeRateEvents({ occRows, occColumns, clrRows, clrColumns, fetchedAt }) {
  const LABEL = "刑案發生及破獲率";
  const monthlyLabels = occRows
    .map((r) => cleanCell(rowVal(r, occColumns, LABEL)))
    .filter((l) => l.includes("機關別總計"));
  const latest = latestRocPeriod(monthlyLabels);
  if (!latest) return [];
  const occRow = occRows.find((r) => cleanCell(rowVal(r, occColumns, LABEL)) === latest.label);
  const occRate = occRow ? cleanCell(rowVal(occRow, occColumns, "刑案發生率_件_10萬人口")) : "";
  const clrRow = clrRows.find((r) => {
    const lbl = cleanCell(rowVal(r, clrColumns, LABEL));
    const p = parseRocPeriodLabel(lbl);
    return p && p.key === latest.key && lbl.includes("機關別總計");
  });
  const clrRate = clrRow ? cleanCell(rowVal(clrRow, clrColumns, "刑案破獲率_%")) : "";
  return [
    {
      id: `crime-rate-${latest.key}`,
      title: `全國刑案統計｜${latest.year}年${latest.month}月`,
      region: "全國",
      timestamp: rocYmToIso(latest.key) || fetchedAt,
      category: "治安",
      scope: "domestic",
      riskLevel: "low",
      summary: `全國刑案統計（${latest.year}年${latest.month}月，按機關別總計）：發生率 ${occRate || "—"} 件/10萬人口、破獲率 ${clrRate || "—"}%。此為全國統計指標，非單點事件。`,
      source: provenance({
        name: "內政部警政署統計處 刑案發生率／破獲率（按機關別）",
        datasetId: CRIME_RATE_DATASET,
        recordRef: latest.key,
        url: "https://data.gov.tw/dataset/103351",
        fetchedAt,
        query: "query_rows 103351 + 103352（機關別總計，最新單月）",
      }),
    },
  ];
}

// 88170 臺中取締酒駕：分局×處置別×車種 → 最新月加總一筆事件。
export function mapDuiTaichungEvents({ rows, columns, fetchedAt }) {
  if (!rows.length) return [];
  const dates = rows
    .map((r) => cleanCell(rowVal(r, columns, "資料時間日期")))
    .filter(Boolean)
    .sort();
  const latestDate = dates[dates.length - 1];
  if (!latestDate) return [];
  const monthRows = rows.filter((r) => cleanCell(rowVal(r, columns, "資料時間日期")) === latestDate);
  const region = cleanCell(rowVal(monthRows[0], columns, "地區")) || "臺中市";
  const sumWhere = (pred) =>
    monthRows.filter(pred).reduce((s, r) => s + numericCell(rowVal(r, columns, "數值")), 0);
  const field = (r) => cleanCell(rowVal(r, columns, "欄位名稱"));
  const total = sumWhere(() => true);
  const prosecuted = sumWhere((r) => field(r).includes("移送法辦"));
  const refused = sumWhere((r) => field(r).includes("拒絕酒測"));
  const accident = sumWhere((r) => field(r).includes("肇事") && !field(r).includes("無肇事"));
  const ym = latestDate.slice(0, 7); // "2026-04"
  const coord = coordOrCounty(region);
  return [
    {
      id: `dui-taichung-${ym.replace("-", "")}`,
      title: `臺中市取締酒駕｜${ym}`,
      region: coord.region || region,
      lat: coord.lat,
      lng: coord.lng,
      timestamp: latestDate.includes("T") ? latestDate : `${latestDate}T00:00:00+08:00`,
      category: "交通",
      scope: "domestic",
      riskLevel: "low",
      summary: `臺中市 ${ym} 取締酒駕 ${total} 件（移送法辦 ${prosecuted}、拒絕酒測 ${refused}、肇事 ${accident}）。此為當月取締統計。`,
      source: provenance({
        name: "臺中市政府警察局 取締酒駕情形",
        datasetId: DUI_TAICHUNG_DATASET,
        recordRef: ym,
        url: "https://data.gov.tw/dataset/88170",
        fetchedAt,
        query: "query_rows 88170（最新資料時間日期，分局×處置別加總）",
      }),
    },
  ];
}

// 145744 臺北家暴通報：給定最新期別的資料列 → 按案件類型加總一筆事件。
export function mapDvTaipeiEvents({ rows, columns, period, fetchedAt }) {
  if (!rows.length || !period) return [];
  const byType = {};
  let total = 0;
  for (const r of rows) {
    const type = cleanCell(rowVal(r, columns, "案件類型")) || "其他";
    const n = numericCell(rowVal(r, columns, "總計"));
    byType[type] = (byType[type] || 0) + n;
    total += n;
  }
  const p = parseRocPeriodLabel(period);
  const key = p ? p.key : cleanCell(period);
  const breakdown = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}${v}`)
    .join("、");
  const coord = coordOrCounty("臺北市");
  return [
    {
      id: `dv-taipei-${key}`,
      title: `臺北市家暴通報｜${cleanCell(period)}`,
      region: coord.region || "臺北市",
      lat: coord.lat,
      lng: coord.lng,
      timestamp: (p && rocYmToIso(p.key)) || fetchedAt,
      category: "治安",
      scope: "domestic",
      riskLevel: "low",
      summary: `臺北市 ${cleanCell(period)} 家暴通報合計 ${total} 件（${breakdown}）。資料來源：臺北市家庭暴力暨性侵害防治中心。`,
      source: provenance({
        name: "臺北市 家暴通報案件數統計",
        datasetId: DV_TAIPEI_DATASET,
        recordRef: key,
        url: "https://data.gov.tw/dataset/145744",
        fetchedAt,
        query: `query_rows 145744（最新期別 ${cleanCell(period)}，按案件類型加總）`,
      }),
    },
  ];
}

async function fetchCrimeRate({ url, token, limit = 400 }) {
  const fetchedAt = new Date().toISOString();
  const occ = await queryTwinkleRows({ url, token, dataset_id: CRIME_RATE_DATASET, limit });
  const clr = await queryTwinkleRows({ url, token, dataset_id: CRIME_CLEARANCE_DATASET, limit });
  return mapCrimeRateEvents({
    occRows: occ.rows,
    occColumns: occ.columns,
    clrRows: clr.rows,
    clrColumns: clr.columns,
    fetchedAt,
  });
}

async function fetchDuiTaichung({ url, token, limit = 300 }) {
  const fetchedAt = new Date().toISOString();
  const { columns, rows } = await queryTwinkleRows({ url, token, dataset_id: DUI_TAICHUNG_DATASET, limit });
  return mapDuiTaichungEvents({ rows, columns, fetchedAt });
}

async function fetchDvTaipei({ url, token, limit = 1000 }) {
  const fetchedAt = new Date().toISOString();
  // 先用 group_by 取得所有期別（避免拉全表），於本地解析最新單月。
  const periods = await queryTwinkleRows({
    url,
    token,
    dataset_id: DV_TAIPEI_DATASET,
    columns: ["時間"],
    group_by: ["時間"],
    limit: 400,
  });
  const latest = latestRocPeriod(periods.rows.map((r) => rowVal(r, periods.columns, "時間")));
  if (!latest) return [];
  const { columns, rows } = await queryTwinkleRows({
    url,
    token,
    dataset_id: DV_TAIPEI_DATASET,
    where: `時間 = '${latest.label}'`,
    limit,
  });
  return mapDvTaipeiEvents({ rows, columns, period: latest.label, fetchedAt });
}

export async function fetchPolice({
  url,
  token,
  today,
  limits = {},
}) {
  const cfg = {
    ...POLICE_DEFAULT_LIMITS,
    ...limits,
  };

  const parts = await Promise.allSettled([
    fetchTraffic({ url, token, limit: cfg.traffic }),
    fetchFraudDomains({ url, token, limit: cfg.fraudDomains }),
    fetchFraudDebunk({ url, token, limit: cfg.fraudDebunk }),
    fetchTaipeiCrime({ url, token, perDataset: cfg.crimePerDataset }),
    fetchPoliceTenders({ url, token, today, limit: cfg.pcc }),
    fetchSpeedHotspots({ url, token, limit: cfg.speedHotspots }),
    fetchFraudDashboard({ url, token, limit: cfg.fraudDashboard }),
    fetchCrimeWeekly(),
    fetchTaichungTraffic({ url, token, limit: cfg.taichungTraffic }),
    fetchTainanCrimeAlerts({ url, token, limit: cfg.tainanAlerts }),
    fetchNtpcCrimeAlerts({ url, token, limit: cfg.ntpcAlerts }),
    fetchFakeInvestmentSites({ url, token, limit: cfg.fraudInvest }),
    fetchTaichungHotspots({ url, token, limit: cfg.taichungHotspots }),
    fetchTaoyuanTheftPoints({ url, token, limit: cfg.taoyuanTheft }),
    fetchPoliceNews({ url, token, limit: cfg.policeNews }),
    fetchHistoricalTraffic({ url, token, limit: cfg.historicalTraffic }),
    fetchDrugCrime({ url, token, limit: cfg.drugCrime }),
    fetchAssemblyEvents({ url, token, limit: cfg.assemblies }),
    fetchTaipeiTrafficSpots({ url, token, limit: cfg.taipeiTrafficSpots }),
    fetchTaipeiTrafficViolations({ url, token, limit: cfg.taipeiTrafficViolations }),
    fetchKaohsiungA3Traffic({ url, token, limit: cfg.kaohsiungA3Traffic }),
    fetchKaohsiungFixedCameras({ url, token, limit: cfg.kaohsiungFixedCameras }),
    fetchKaohsiungAverageSpeedCameras({ url, token, limit: cfg.kaohsiungAvgSpeedCameras }),
    fetchHsinchuCityTrafficStats({ url, token, limit: cfg.hsinchuCityTrafficStats }),
    fetchHsinchuCountyAverageSpeed({ url, token, limit: cfg.hsinchuCountyAvgSpeed }),
    fetchChiayiTheftPoints({ url, token, perDataset: cfg.chiayiTheftPerDataset }),
    fetchYilanCctv({ url, token, limit: cfg.yilanCctv }),
    fetchMiaoliReportStats({ url, token, limit: cfg.miaoliReportStats }),
    fetchMiaoliCaseStats({ url, token, limit: cfg.miaoliCaseStats }),
    fetchNantouTechEnforcement({ url, token, limit: cfg.nantouTechEnforcement }),
    fetchNantouImpoundLots({ url, token, limit: cfg.nantouImpoundLots }),
    fetchPingtungCctv({ url, token, limit: cfg.pingtungCctv }),
    fetchPingtungCrashHotspots({ url, token, limit: cfg.pingtungCrashHotspots }),
    fetchPingtungTechEnforcement({ url, token, limit: cfg.pingtungTechEnforcement }),
    fetchHualienAverageSpeed({ url, token, limit: cfg.hualienAvgSpeed }),
    fetchTaitungAirRaidShelters({ url, token, limit: cfg.taitungAirRaidShelters }),
    fetchPenghuScienceEnforcement({ url, token, limit: cfg.penghuScienceEnforcement }),
    fetchPenghuTrafficOrderStats({ url, token, limit: cfg.penghuTrafficOrderStats }),
    fetchKinmenAirRaidShelters({ url, token, limit: cfg.kinmenAirRaidShelters }),
    fetchLienchiangServiceStats({ url, token, limit: cfg.lienchiangServiceStats }),
    fetchCrimeRate({ url, token, limit: cfg.crimeRate }),
    fetchDuiTaichung({ url, token, limit: cfg.duiTaichung }),
    fetchDvTaipei({ url, token, limit: cfg.dvTaipei }),
  ]);

  const labels = [
    "traffic",
    "fraudDomains",
    "fraudDebunk",
    "taipeiCrime",
    "policePcc",
    "speedHotspots",
    "fraudDashboard",
    "crimeWeekly",
    "taichungTraffic",
    "tainanAlerts",
    "ntpcAlerts",
    "fraudInvest",
    "taichungHotspots",
    "taoyuanTheft",
    "policeNews",
    "historicalTraffic",
    "drugCrime",
    "assemblies",
    "taipeiTrafficSpots",
    "taipeiTrafficViolations",
    "kaohsiungA3Traffic",
    "kaohsiungFixedCameras",
    "kaohsiungAvgSpeedCameras",
    "hsinchuCityTrafficStats",
    "hsinchuCountyAvgSpeed",
    "chiayiTheft",
    "yilanCctv",
    "miaoliReportStats",
    "miaoliCaseStats",
    "nantouTechEnforcement",
    "nantouImpoundLots",
    "pingtungCctv",
    "pingtungCrashHotspots",
    "pingtungTechEnforcement",
    "hualienAvgSpeed",
    "taitungAirRaidShelters",
    "penghuScienceEnforcement",
    "penghuTrafficOrderStats",
    "kinmenAirRaidShelters",
    "lienchiangServiceStats",
    "crimeRate",
    "duiTaichung",
    "dvTaipei",
  ];
  const substatus = {};
  const events = [];

  parts.forEach((p, i) => {
    const label = labels[i];
    if (p.status === "fulfilled") {
      substatus[label] = { ok: true, count: p.value.length };
      events.push(...p.value);
    } else {
      substatus[label] = { ok: false, error: p.reason?.message || String(p.reason), stack: p.reason?.stack || String(p.reason) };
    }
  });

  if (!labels.some((label) => label !== "crimeWeekly" && substatus[label].ok)) {
    throw new Error("all MCP police sources failed");
  }

  return { events, substatus };
}
