// 國際事件「累積式滾動視窗 + 分主題配額」挑選。
// 動機：國際原本每輪只留當輪 ≤maxEvents 並直接取代舊快照 → 數量隨單輪抓取量浮動、且全被
// 風險排序壓成高風險。改成比照國內「累積近幾天」並用分主題輪詢挑選，讓數量穩定更多、
// 主題分布更廣，也讓 medium/low 不會被高風險洗掉。

const RISK_RANK = { low: 0, medium: 1, high: 2, critical: 3 };

function ts(e) {
  const t = new Date(e?.timestamp).getTime();
  return Number.isFinite(t) ? t : 0;
}

// 顯示排序：風險高者在前，同風險時新者在前。
export function byRiskThenTime(a, b) {
  const r = (RISK_RANK[b.riskLevel] ?? 1) - (RISK_RANK[a.riskLevel] ?? 1);
  return r || ts(b) - ts(a);
}

// 分主題（category）輪詢挑選至 cap：每個主題輪流貢獻一則（同主題內依風險+新近排序），
// 避免單一主題（如地緣政治）洗版，且讓較低風險的其他主題事件也能進榜。最後再依風險排序輸出。
export function selectDiverseByCategory(events, cap) {
  const list = Array.isArray(events) ? events.filter(Boolean) : [];
  if (list.length <= cap) return list.sort(byRiskThenTime);
  const groups = new Map();
  for (const e of list) {
    const k = e.category || "其他";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  for (const arr of groups.values()) arr.sort(byRiskThenTime);
  const lists = [...groups.values()];
  const out = [];
  let i = 0;
  while (out.length < cap && lists.some((l) => l.length)) {
    const l = lists[i % lists.length];
    if (l.length) out.push(l.shift());
    i++;
  }
  return out.sort(byRiskThenTime);
}

// 累積式滾動視窗：合併本輪 fresh + 舊快照 old → 依 id 去重（fresh 優先，保留最新正規化結果）
// → 丟棄超過 retentionDays 天的事件 → 分主題挑選至 cap。
export function accumulateInternational(fresh, old, { retentionDays = 5, cap = 250, now = Date.now() } = {}) {
  const cutoff = now - retentionDays * 86400000;
  const byId = new Map();
  for (const e of [...(Array.isArray(fresh) ? fresh : []), ...(Array.isArray(old) ? old : [])]) {
    if (!e || !e.id || byId.has(e.id)) continue;
    const t = new Date(e.timestamp).getTime();
    if (Number.isFinite(t) && t < cutoff) continue; // 超過保留窗的舊事件丟棄
    byId.set(e.id, e);
  }
  return selectDiverseByCategory([...byId.values()], cap);
}
