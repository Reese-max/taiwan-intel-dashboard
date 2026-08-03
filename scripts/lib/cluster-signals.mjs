// 情報群時序演變與地理聚集訊號（純函式、零依賴）。
// 輸入：單一 cluster 的事件物件陣列（帶 timestamp / lat / lng / source）。
// 輸出：
//   · temporalSeriesOf：按時間排序的「來源數／報導數」逐日序列 + 首次/最後觀測時間
//   · geoClustersOf   ：地理座標群集（以座標距離分群）與每個成員的座標佐證
//   · clusterSignals  ：兩者合併的單一入口（供 correlate.mjs describeCluster 使用）
// 降級原則（可追溯、不做錯誤合併）：
//   · 時間缺失/無效的事件 不進時序序列與首末觀測，計入 degraded.missingTimestamp.ids
//   · 座標缺失/無效的事件 不進地理群集，計入 degraded.missingCoordinates.ids
//   · 全員時間缺失時 省略 firstSeenTs/lastSeenTs 欄位（不輸出空字串），以 degraded
//     missingTimestamp 標記降級——絕不編造時間、絕不把無座標事件併入任何地理群集。

const HAVERSINE_KM = 6371.0088;
const GEO_DISTANCE_KM = (() => {
  const n = Number(process.env.CLUSTER_GEO_DISTANCE_KM);
  return Number.isFinite(n) && n > 0 ? n : 15;
})();

export function isValidTimestamp(iso) {
  return typeof iso === "string" && Number.isFinite(Date.parse(iso));
}

export function isValidCoordinate(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false; // (0,0) 常為未填的佔位座標
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function dayKey(ms) {
  const d = new Date(ms);
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

// 逐日（UTC）分桶的「來源數／報導數」序列。回傳的 degraded 含缺失時間的成員 id 清單。
// 無任何有效時間時，firstSeenTs/lastSeenTs 為 undefined（呼叫端省略欄位），不輸出空字串。
export function temporalSeriesOf(members, { directEvidenceIds } = {}) {
  const directIds = directEvidenceIds ? new Set(directEvidenceIds) : null;
  const valid = [];
  const missingTimestamp = [];
  for (const event of members || []) {
    if (isValidTimestamp(event?.timestamp)) valid.push(event);
    else missingTimestamp.push(event?.id);
  }
  valid.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  const buckets = new Map();
  for (const event of valid) {
    const key = dayKey(Date.parse(event.timestamp));
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { ts: `${key}T00:00:00.000Z`, reports: 0, sources: new Set() };
      buckets.set(key, bucket);
    }
    bucket.reports += 1;
    if (event.source?.name && (!directIds || directIds.has(event.id))) bucket.sources.add(event.source.name);
  }

  return {
    series: [...buckets.values()]
      .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
      .map((b) => ({ ts: b.ts, reports: b.reports, sources: b.sources.size })),
    firstSeenTs: valid.length ? valid[0].timestamp : undefined,
    lastSeenTs: valid.length ? valid[valid.length - 1].timestamp : undefined,
    degraded: {
      missingTimestamp: { count: missingTimestamp.length, ids: missingTimestamp },
    },
  };
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * HAVERSINE_KM * Math.asin(Math.sqrt(a));
}

// 地理座標群集：以座標距離閾值做星狀（seed-based）聚集，
// 避免單連鎖把一條長鏈（例如沿路/沿線的事件）誤併成一群。
// 單點也回傳（size 1），作為「地理上孤立」的可追溯佐證。
export function geoClustersOf(members) {
  const points = [];
  const missingCoordinates = [];
  for (const event of members || []) {
    if (isValidCoordinate(event?.lat, event?.lng)) {
      points.push({ id: event.id, lat: event.lat, lng: event.lng });
    } else {
      missingCoordinates.push(event?.id);
    }
  }
  // 先依座標排序讓輸出與輸入順序無關（可重現）。
  points.sort((a, b) => a.lat - b.lat || a.lng - b.lng);

  const groups = [];
  const assigned = new Set();
  for (const seed of points) {
    if (assigned.has(seed.id)) continue;
    const membersInGroup = [seed];
    assigned.add(seed.id);
    for (const p of points) {
      if (assigned.has(p.id)) continue;
      if (haversineKm(seed.lat, seed.lng, p.lat, p.lng) <= GEO_DISTANCE_KM) {
        membersInGroup.push(p);
        assigned.add(p.id);
      }
    }
    const size = membersInGroup.length;
    const centroidLat = membersInGroup.reduce((sum, m) => sum + m.lat, 0) / size;
    const centroidLng = membersInGroup.reduce((sum, m) => sum + m.lng, 0) / size;
    groups.push({
      id: `geo${groups.length}`,
      size,
      centroidLat: Math.round(centroidLat * 1e5) / 1e5,
      centroidLng: Math.round(centroidLng * 1e5) / 1e5,
      members: membersInGroup.map((m) => ({ id: m.id, lat: m.lat, lng: m.lng })),
    });
  }
  groups.sort((a, b) => b.size - a.size);

  return {
    clusters: groups,
    degraded: {
      missingCoordinates: { count: missingCoordinates.length, ids: missingCoordinates },
    },
  };
}

// 單一入口：一次算出群集的時序與地理訊號（含降級紀錄）。
// 全員時間缺失時省略 firstSeenTs/lastSeenTs（undefined），絕不輸出空字串。
export function clusterSignals(members, options = {}) {
  const temporal = temporalSeriesOf(members, options);
  const geo = geoClustersOf(members);
  return {
    temporalSeries: temporal.series,
    ...(temporal.firstSeenTs ? { firstSeenTs: temporal.firstSeenTs } : {}),
    ...(temporal.lastSeenTs ? { lastSeenTs: temporal.lastSeenTs } : {}),
    geoClusters: geo.clusters,
    degraded: {
      missingTimestamp: temporal.degraded.missingTimestamp,
      missingCoordinates: geo.degraded.missingCoordinates,
    },
  };
}
