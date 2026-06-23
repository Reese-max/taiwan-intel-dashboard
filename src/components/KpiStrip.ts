import type { IntelEvent } from "../types/event";
import { esc } from "../utils/escape";

const DAY_MS = 86400000;

interface ProvStat {
  total: number;
  active: number;
  officialPct: number;
}

// undefined＝尚未抓取；null＝抓取失敗；物件＝已抓取（module 內快取，僅 fetch 一次）
let provCache: ProvStat | null | undefined;

// 最近 5 天每日計數（對齊 5 天保留窗，避免顯示被剪掉的空日），沿用 TimelineView 的分桶邏輯
function dailyCounts(events: IntelEvent[], predicate?: (e: IntelEvent) => boolean): number[] {
  const out: number[] = [];
  for (let i = 4; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY_MS);
    const count = events.filter((e) => {
      if (predicate && !predicate(e)) return false;
      const t = new Date(e.timestamp);
      return (
        t.getFullYear() === d.getFullYear() &&
        t.getMonth() === d.getMonth() &&
        t.getDate() === d.getDate()
      );
    }).length;
    out.push(count);
  }
  return out;
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

function card(mod: string, label: string, num: string, spark: number[], suffix?: string): string {
  const suffixHtml = suffix ? `<span class="kpi-suffix">${esc(suffix)}</span>` : "";
  return `<article class="kpi-card ${mod}">
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

async function fetchProvStat(): Promise<ProvStat | null> {
  try {
    const res = await fetch("./data/provenance.json");
    if (!res.ok) return null;
    const m = (await res.json()) as {
      generatedAt: string;
      sources: { type?: string; fetchedAt: string; lastSuccessAt?: string }[];
    };
    const total = m.sources.length;
    const reference = Date.parse(m.generatedAt);
    const active = m.sources.filter((s) => {
      const last = Date.parse(s.lastSuccessAt ?? s.fetchedAt);
      return Number.isFinite(reference) && Number.isFinite(last) && reference - last <= DAY_MS;
    }).length;
    const official = m.sources.filter((s) => s.type === "gov-open-data" || s.type === "cwa").length;
    const officialPct = total ? Math.round((official / total) * 100) : 0;
    return { total, active, officialPct };
  } catch {
    return null;
  }
}

export function renderKpiStrip(container: HTMLElement, events: IntelEvent[]): void {
  const eventsSpark = dailyCounts(events);
  const riskSpark = dailyCounts(events, isElevated);
  // 近 24 小時滾動視窗取代「日曆當日」：不會清晨偏低、跨午夜歸零、無嚇人負值。
  const now = Date.now();
  const inWindow = (e: IntelEvent, fromAgo: number, toAgo: number): boolean => {
    const t = Date.parse(e.timestamp);
    return Number.isFinite(t) && now - t >= fromAgo && now - t < toAgo;
  };
  const last24h = events.filter((e) => inWindow(e, 0, DAY_MS)).length;
  const prev24h = events.filter((e) => inWindow(e, DAY_MS, 2 * DAY_MS)).length;
  const delta = last24h - prev24h;
  const riskCount = events.filter(isElevated).length;
  const riskPct = events.length ? Math.round((riskCount / events.length) * 100) : 0;

  const todayCard = card(
    "is-accent",
    "近 24 小時",
    String(last24h),
    eventsSpark,
    delta >= 0 ? `+${delta} 較前日` : `${delta} 較前日`,
  );
  const riskCard = card("is-risk", "危急 / 高風險", String(riskCount), riskSpark, `${riskPct}% 占比`);

  const paint = (stat: ProvStat | null): void => {
    container.innerHTML = todayCard + riskCard + sourceCards(stat, eventsSpark);
  };

  paint(provCache ?? null);

  if (provCache === undefined) {
    void fetchProvStat().then((stat) => {
      provCache = stat;
      paint(stat);
    });
  }
}
