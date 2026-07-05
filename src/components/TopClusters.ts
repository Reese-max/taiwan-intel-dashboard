import type { NetCluster } from "../data/network";
import { esc } from "../utils/escape";

function fmtDate(ts?: string): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts.slice(0, 16).replace("T", " ");
  return d.toLocaleString("zh-TW", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function clusterScore(c: NetCluster): number {
  const share = typeof c.dominantCategoryShare === "number" ? c.dominantCategoryShare : 1;
  return c.size * share;
}

function clusterLatestMs(c: NetCluster): number {
  const t = Date.parse(c.latestTs ?? "");
  return Number.isFinite(t) ? t : 0;
}

function compareTopCluster(a: NetCluster, b: NetCluster): number {
  const incoherentDelta = Number(Boolean(a.incoherent)) - Number(Boolean(b.incoherent));
  if (incoherentDelta !== 0) return incoherentDelta;
  return clusterScore(b) - clusterScore(a) || b.size - a.size || clusterLatestMs(b) - clusterLatestMs(a);
}

export function renderTopClusters(
  container: HTMLElement,
  clusters: NetCluster[],
  summaries: Record<string, string> = {},
  limit = 8,
): void {
  const top = clusters
    .slice()
    .sort(compareTopCluster)
    .slice(0, limit);
  container.innerHTML = `
    <section class="top-clusters-card">
      <h4>今日最大情報群</h4>
      <p class="cluster-hint">點一群展開全部成員。</p>
      ${
        top.length
          ? `<ol class="cluster-list">${top
              .map((c) => {
                const ai = summaries[c.id];
                return `<li>
                  <button type="button" class="cluster-link" data-cluster="${esc(c.id)}">
                    <span class="cluster-title">${esc(c.representativeTitle || c.id)}</span>
                    ${ai ? `<span class="cluster-summary">🤖 ${esc(ai)}</span>` : ""}
                    <span class="cluster-meta">${esc(c.topCategory || "情報")}｜${esc((c.regions ?? []).join("、") || "未標地區")}｜${c.sourceCount ?? 0} 源 · ${c.size} 則</span>
                    <span class="cluster-time">${esc(fmtDate(c.latestTs))}</span>
                  </button>
                </li>`;
              })
              .join("")}</ol>`
          : `<p class="empty compact">尚無可展開的情報群</p>`
      }
    </section>`;
}
