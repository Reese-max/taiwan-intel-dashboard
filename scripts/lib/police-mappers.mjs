// 警政資料 → IntelEvent 的純函式（可單測）

const TAIPEI_CENTER = { lat: 25.0375, lng: 121.5637, region: "臺北市" };

export function rocYmd7ToIso(ymd) {
  const s = String(ymd || "").replace(/\D/g, "");
  if (s.length < 7) return null;
  const y = Number.parseInt(s.slice(0, 3), 10) + 1911;
  const m = Number.parseInt(s.slice(3, 5), 10);
  const d = Number.parseInt(s.slice(5, 7), 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}T12:00:00+08:00`;
}

export function rocYmdHmToIso(text) {
  const s = String(text || "").replace(/\D/g, "");
  if (s.length < 11) return rocYmd7ToIso(s);
  const y = Number.parseInt(s.slice(0, 3), 10) + 1911;
  const m = Number.parseInt(s.slice(3, 5), 10);
  const d = Number.parseInt(s.slice(5, 7), 10);
  const hh = Number.parseInt(s.slice(7, 9), 10);
  const mi = Number.parseInt(s.slice(9, 11), 10);
  if (![y, m, d, hh, mi].every(Number.isFinite)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00+08:00`;
}

export function formatNtd(amount) {
  const n = Number(amount);
  return Number.isFinite(n) ? `NT$${n.toLocaleString("en-US")}` : `NT$${amount}`;
}

export function speedRisk(dailyCount, yearlyCount) {
  const daily = Number(dailyCount);
  const yearly = Number(yearlyCount);
  if (yearly >= 5000 || daily >= 80) return "high";
  if (yearly >= 2000 || daily >= 40) return "medium";
  return "low";
}

export function fraudDashRisk(blockAmount) {
  const n = Number(blockAmount);
  if (!Number.isFinite(n)) return "medium";
  if (n >= 1_500_000_000) return "critical";
  if (n >= 800_000_000) return "high";
  if (n >= 300_000_000) return "medium";
  return "low";
}

export function parseCoordPair(text) {
  const m = String(text || "").match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  // Taiwan bounds: lat ~21-26, lng ~118-122
  if (a >= 118 && a <= 122 && b >= 21 && b <= 26) return { lat: b, lng: a };
  if (b >= 118 && b <= 122 && a >= 21 && a <= 26) return { lat: a, lng: b };
  return { lat: a, lng: b };
}

export function calendarTimestamp(y, mo, d, h = 0, mi = 0) {
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`;
}

export function gregorianYmd8ToIso(ymd) {
  const s = String(ymd || "").replace(/\D/g, "");
  if (s.length !== 8 || !s.startsWith("20")) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T12:00:00+08:00`;
}

export function localDateTimeToIso(text) {
  const s = String(text || "").trim().replace(/^"+|"+$/g, "");
  const ampm = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s*(上午|下午)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (ampm) {
    let hour = Number.parseInt(ampm[5], 10);
    if (ampm[4] === "下午" && hour < 12) hour += 12;
    if (ampm[4] === "上午" && hour === 12) hour = 0;
    return `${ampm[1]}-${ampm[2].padStart(2, "0")}-${ampm[3].padStart(2, "0")}T${String(hour).padStart(2, "0")}:${ampm[6]}:${(ampm[7] || "00").padStart(2, "0")}+08:00`;
  }
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s-])(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T${m[4].padStart(2, "0")}:${m[5]}:${(m[6] || "00").padStart(2, "0")}+08:00`;
}

export function rocChineseDateTimeToIso(text) {
  const m = String(text || "").match(/(\d{2,3})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2})時(\d{1,2})分(?:(\d{1,2})秒)?/);
  if (!m) return null;
  const y = Number.parseInt(m[1], 10) + 1911;
  return `${y}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T${m[4].padStart(2, "0")}:${m[5].padStart(2, "0")}:${(m[6] || "00").padStart(2, "0")}+08:00`;
}

export function slashDateToIso(text) {
  const m = String(text || "").match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T12:00:00+08:00`;
}

export function weeklyCrimeRisk(caseType, count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return "low";
  if (caseType === "強盜" || caseType === "強制性交") return n >= 3 ? "high" : "medium";
  if (caseType === "毒品") return n >= 150 ? "high" : n >= 50 ? "medium" : "low";
  if (n >= 100) return "high";
  if (n >= 30) return "medium";
  return "low";
}

export function rocYmToIso(ym) {
  const s = String(ym || "").replace(/\D/g, "");
  if (s.length < 5) return null;
  const y = Number.parseInt(s.slice(0, 3), 10) + 1911;
  const m = Number.parseInt(s.slice(3, 5), 10);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  return `${y}-${String(m).padStart(2, "0")}-01T00:00:00+08:00`;
}

export function trafficTimestamp(dateStr, timeStr) {
  const d = String(dateStr || "");
  const t = String(timeStr || "000000").padStart(6, "0");
  if (d.length !== 8) return new Date().toISOString();
  const y = d.slice(0, 4);
  const mo = d.slice(4, 6);
  const da = d.slice(6, 8);
  const hh = t.slice(0, 2);
  const mi = t.slice(2, 4);
  const ss = t.slice(4, 6);
  return `${y}-${mo}-${da}T${hh}:${mi}:${ss}+08:00`;
}

export function parseCasualties(text) {
  const deaths = Number.parseInt(String(text || "").match(/死亡\s*(\d+)/)?.[1] ?? "0", 10);
  const injuries = Number.parseInt(String(text || "").match(/受傷\s*(\d+)/)?.[1] ?? "0", 10);
  return { deaths: Number.isFinite(deaths) ? deaths : 0, injuries: Number.isFinite(injuries) ? injuries : 0 };
}

export function trafficRisk(className, casualtiesText) {
  const { deaths, injuries } = parseCasualties(casualtiesText);
  if (className === "A1" || deaths > 0) return deaths > 0 ? "critical" : "high";
  if (injuries >= 3) return "high";
  if (injuries >= 1) return "medium";
  return "low";
}

export function dedupeTrafficRows(rows, columns) {
  const iDate = columns.indexOf("發生日期");
  const iTime = columns.indexOf("發生時間");
  const iLoc = columns.indexOf("發生地點");
  const iParty = columns.indexOf("當事者順位");
  const seen = new Map();
  for (const row of rows) {
    const key = `${row[iDate]}|${row[iTime]}|${row[iLoc]}`;
    const party = Number(row[iParty]);
    const prev = seen.get(key);
    if (!prev || (party === 1 && Number(prev[iParty]) !== 1)) seen.set(key, row);
  }
  return [...seen.values()];
}

export function regionFromTaipeiAddr(addr) {
  const m = String(addr || "").match(/臺?北市([^，,]+?[區鄉鎮市])/);
  return m ? `臺北市${m[1]}` : TAIPEI_CENTER.region;
}

export function crimeRisk(caseType) {
  if (caseType === "強盜") return "high";
  if (caseType === "住宅竊盜" || caseType === "汽車竊盜") return "medium";
  return "medium";
}

export function parseSlashDateTime(text) {
  const m = String(text || "").match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return new Date().toISOString();
  const y = m[1];
  const mo = m[2].padStart(2, "0");
  const d = m[3].padStart(2, "0");
  const hh = m[4].padStart(2, "0");
  const mi = m[5];
  return `${y}-${mo}-${d}T${hh}:${mi}:00+08:00`;
}

export { TAIPEI_CENTER };
