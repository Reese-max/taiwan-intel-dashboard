import type { IntelEvent, Scope } from "../types/event";
import { esc } from "../utils/escape";

const DAY_MS = 86400000;

interface ProvStat {
  total: number;
  active: number;
  officialPct: number;
}

interface ProvSource {
  type?: string;
  scope?: Scope;
  fetchedAt?: string;
  lastSuccessAt?: string;
  stale?: boolean;
}

interface ProvManifest {
  generatedAt: string;
  sources: ProvSource[];
}

// undefined＝尚未抓取；null＝抓取失敗；物件＝已抓取（原始 manifest，module 內快取僅 fetch 一次；
// 各 scope 的統計由 computeProvStat 即時依 scope 過濾後算出，避免全域數字誤套到單一 scope）
let provCache: ProvManifest | null | undefined;

// 單趟走訪統計 5 天次數與近 24h 滾動指標，避免多趟 filter 反覆建立與解析數萬個 Date 物件
function computeKpiMetrics(events: IntelEvent[]): {
  eventsSpark: number[];
  riskSpark: number[];
  last24h: number;
  prev24h: number;
  riskCount: number;
} {
  const now = Date.now();
  const dayBuckets: { y: number; m: number; d: number }[] = [];
  for (let i = 4; i >= 0; i--) {
    const d = new Date(now - i * DAY_MS);
    dayBuckets.push({ y: d.getFullYear(), m: d.getMonth(), d: d.getDate() });
  }
  const eventsSpark = [0, 0, 0, 0, 0];
  const riskSpark = [0, 0, 0, 0, 0];
  let last24h = 0;
  let prev24h = 0;
  let riskCount = 0;

  for (let idx = 0; idx < events.length; idx++) {
    const e = events[idx];
    const elevated = isElevated(e);
    if (elevated) riskCount++;

    const t = Date.parse(e.timestamp);
    if (Number.isFinite(t)) {
      const age = now - t;
      if (age >= 0 && age < DAY_MS) last24h++;
      else if (age >= DAY_MS && age < 2 * DAY_MS) prev24h++;

      const dt = new Date(t);
      const y = dt.getFullYear();
      const m = dt.getMonth();
      const d = dt.getDate();
      for (let b = 0; b < 5; b++) {
        const bucket = dayBuckets[b];
        if (bucket.y === y && bucket.m === m && bucket.d === d) {
          eventsSpark[b]++;
          if (elevated) riskSpark[b]++;
          break;
        }
      }
    }
  }

  return { eventsSpark, riskSpark, last24h, prev24h, riskCount };
}

function isElevated(e: IntelEvent): boolean {
  return e.riskLevel === "critical" || e.riskLevel === "high";
}

// 迷你折線：normalize 到固定 viewBox，stroke 用 currentColor（由卡片色 modifier 決定）
function sparkline(values: number[]): string {
  const W = 84;
  const H = 28;
  const pad = 3;
  const max = Math.max(1, ...values);
  const n = values.length;
  const pts = values
    .map((v, i) => {
      const x = n <= 1 ? W / 2 : pad + (i / (n - 1)) * (W - pad * 2);
      const y = H - pad - (v / max) * (H - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<svg class="kpi-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function card(mod: string, label: string, num: string, spark: number[], suffix?: string, action?: string): string {
  const suffixHtml = suffix ? `<span class="kpi-suffix">${esc(suffix)}</span>` : "";
  const cls = `kpi-card ${mod}${action ? " is-clickable" : ""}`;
  const attrs = action ? ` data-kpi-action="${esc(action)}" role="button" tabindex="0" aria-label="${esc(label)}，點擊篩選"` : "";
  return `<article class="${cls}"${attrs}>
    <div class="kpi-head">
      <span class="kpi-label">${esc(label)}</span>
      ${sparkline(spark)}
    </div>
    <div class="kpi-body"><span class="kpi-num">${esc(num)}</span>${suffixHtml}</div>
  </article>`;
}

function sourceCards(stat: ProvStat | null, spark: number[]): string {
  const active = stat ? `${stat.active} / ${stat.total}` : "—";
  const officialPct = stat ? `${stat.officialPct}%` : "—";
  return (
    card("is-plain", "活躍資料源", active, spark) +
    card("is-ok", "官方來源占比", officialPct, spark, "可溯源佐證")
  );
}

async function fetchProvManifest(): Promise<ProvManifest | null> {
  try {
    const res = await fetch("./data/provenance.json");
    if (!res.ok) return null;
    return (await res.json()) as ProvManifest;
  } catch {
    return null;
  }
}

// 依 scope 過濾來源後計算統計：來源 manifest 每筆帶 scope（domestic/international），
// 各 scope 的「活躍資料源／官方來源占比」須只算該 scope 的來源，否則國際頁會誤顯國內主導的全域數字。
export function computeProvStat(manifest: ProvManifest | null, scope: Scope): ProvStat | null {
  if (!manifest) return null;
  const sources = manifest.sources.filter((s) => s.scope === scope);
  const total = sources.length;
  const reference = Date.parse(manifest.generatedAt);
  const active = sources.filter((s) => {
    if (s.stale === true) return false;
    const last = Date.parse(s.lastSuccessAt ?? s.fetchedAt ?? "");
    return Number.isFinite(reference) && Number.isFinite(last) && reference - last <= DAY_MS;
  }).length;
  const official = sources.filter((s) => s.type === "gov-open-data" || s.type === "cwa").length;
  const officialPct = total ? Math.round((official / total) * 100) : 0;
  return { total, active, officialPct };
}

export function renderKpiStrip(
  container: HTMLElement,
  events: IntelEvent[],
  scope: Scope,
  onRiskClick?: () => void,
): void {
  const { eventsSpark, riskSpark, last24h, prev24h, riskCount } = computeKpiMetrics(events);
  const delta = last24h - prev24h;
  const riskPct = events.length ? Math.round((riskCount / events.length) * 100) : 0;

  const todayCard = card(
    "is-accent",
    "近 24 小時",
    String(last24h),
    eventsSpark,
    delta >= 0 ? `+${delta} 較前日` : `${delta} 較前日`,
  );
  const riskCard = card(
    "is-risk",
    "危急 / 高風險",
    String(riskCount),
    riskSpark,
    `${riskPct}% 占比`,
    onRiskClick ? "filter-elevated" : undefined,
  );

  const paint = (manifest: ProvManifest | null): void => {
    container.innerHTML = todayCard + riskCard + sourceCards(computeProvStat(manifest, scope), eventsSpark);
    // 「危急/高風險」卡可點：一鍵把清單過濾到高風險以上（paint 重繪後需重綁）。
    if (onRiskClick) {
      const el = container.querySelector<HTMLElement>('[data-kpi-action="filter-elevated"]');
      if (el) {
        el.onclick = onRiskClick;
        el.onkeydown = (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            onRiskClick();
          }
        };
      }
    }
  };

  paint(provCache ?? null);

  if (provCache === undefined) {
    void fetchProvManifest().then((manifest) => {
      provCache = manifest;
      paint(manifest);
    });
  }
}
