// 失蹤人口查尋（警政署 14420，直連 npa live API）→ IntelEvent[]。
// 男/女兩端點為現役公開協尋名單（已排除保護案件）。
// 每筆以照片 URL 內的唯一 token 當 recordRef，新協尋案 → 進每小時 ledger 的真實新進。
// 無地理座標欄位（E8_OC_PLACE 為地點類別碼非縣市），故不上地球儀、只進協尋列表。

const MALE_URL = "https://eze8.npa.gov.tw/E82OpendataWebE/api/MissPerson/json/Male";
const FEMALE_URL = "https://eze8.npa.gov.tw/E82OpendataWebE/api/MissPerson/json/Female";

const clean = (s) => String(s ?? "").trim();

// 照片 URL 末段 token（.../ShowPhoto/Z115069AB6O1K7F）→ 穩定唯一鍵。
export function photoToken(url) {
  const m = clean(url).match(/ShowPhoto\/([A-Za-z0-9]+)/);
  return m ? m[1] : "";
}

// "19970711" → 概略年齡（以 4 碼西元年計）。無法解析回 null。
function ageFromBirth(birth, nowYear) {
  const y = parseInt(clean(birth).slice(0, 4), 10);
  if (!Number.isFinite(y) || y < 1900 || y > nowYear) return null;
  return nowYear - y;
}

// "20260619" → ISO+08:00。
function ocDateToIso(d) {
  const s = clean(d);
  if (s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00+08:00`;
}

// 未成年或高齡者風險較高（走失/失智/安全顧慮）。
function riskByPerson(age) {
  if (age != null && (age < 18 || age >= 65)) return "high";
  return "medium";
}

function describe(r) {
  const parts = [];
  const h = clean(r.E8_SJ_HEIGHT);
  const shape = clean(r.E8_SJ_SHAPE);
  if (h || shape) parts.push(`身高${h || "?"}${shape ? "／" + shape : ""}`);
  const wear = [clean(r.E8_SJ_SHIRT), clean(r.E8_SJ_PANT), clean(r.E8_SJ_SHOE)].filter(Boolean).join("、");
  if (wear) parts.push(`衣著：${wear}`);
  const feat = [clean(r.E8_SJ_FEATURE), clean(r.E8_SJ_SCAR), clean(r.E8_SJ_WEARING)].filter(Boolean).join("、");
  if (feat) parts.push(`特徵：${feat}`);
  return parts.join("；");
}

// npa 男/女記錄陣列 → IntelEvent[]（依 photo token 去重）。
export function mapMissingEvents({ records, fetchedAt, nowYear }) {
  const year = nowYear || new Date(fetchedAt || Date.now()).getFullYear();
  const seen = new Set();
  const events = [];
  for (const r of records || []) {
    const token = photoToken(r.E8_PIC_URL);
    const ref = token || `${clean(r.E8_SJ_NM)}-${clean(r.E8_OC_DATE)}`;
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    const name = clean(r.E8_SJ_NM) || "（不詳）";
    const gender = clean(r.E8_SJ_GENDER);
    const age = ageFromBirth(r.E8_SJ_BIRTH_YEAR, year);
    const ocIso = ocDateToIso(r.E8_OC_DATE);
    const desc = describe(r);
    const who = [gender, age != null ? `${age}歲` : ""].filter(Boolean).join(" ");
    events.push({
      id: `missing-${ref}`,
      title: `協尋：${name}${who ? `（${who}）` : ""}`,
      region: "失蹤協尋",
      lat: null,
      lng: null,
      timestamp: ocIso || fetchedAt,
      category: "協尋",
      scope: "domestic",
      riskLevel: riskByPerson(age),
      summary: [ocIso ? `${clean(r.E8_OC_DATE).slice(0, 4)}-${clean(r.E8_OC_DATE).slice(4, 6)}-${clean(r.E8_OC_DATE).slice(6, 8)} 失蹤` : "", desc]
        .filter(Boolean)
        .join("；")
        .slice(0, 300),
      source: {
        name: "警政署 失蹤人口查尋",
        type: "gov-open-data",
        datasetId: "14420",
        recordRef: ref,
        url: clean(r.E8_PIC_URL),
        fetchedAt,
        query: "npa.gov.tw E82 MissPerson live API（男/女）",
      },
    });
  }
  return events;
}

async function fetchJson(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (taiwan-intel-dashboard pipeline)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchMissing({ timeoutMs = 20000 } = {}) {
  const fetchedAt = new Date().toISOString();
  const [male, female] = await Promise.all([
    fetchJson(MALE_URL, timeoutMs).catch(() => []),
    fetchJson(FEMALE_URL, timeoutMs).catch(() => []),
  ]);
  const records = [...(Array.isArray(male) ? male : []), ...(Array.isArray(female) ? female : [])];
  return mapMissingEvents({ records, fetchedAt });
}
