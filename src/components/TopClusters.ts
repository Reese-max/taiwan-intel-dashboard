import type { NetCluster } from "../data/network";
import { esc } from "../utils/escape";

function fmtDate(ts?: string): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts.slice(0, 16).replace("T", " ");
  return d.toLocaleString("zh-TW", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function renderTopClusters(container: HTMLElement, clusters: NetCluster[], limit = 8): void {
  const top = clusters
    .slice()
    .sort((a, b) => b.size - a.size || Date.parse(b.latestTs ?? "") - Date.parse(a.latestTs ?? ""))
    .slice(0, limit);
  container.innerHTML = `
    <section class="top-clusters-card">
      <h4>今日最大情報群</h4>
      <p class="cluster-hint">點一群展開全部成員。</p>
      ${
        top.length
          ? `<ol class="cluster-list">${top
              .map(
                (c) => `<li>
                  <button type="button" class="cluster-link" data-cluster="${esc(c.id)}">
                    <span class="cluster-title">${esc(c.representativeTitle || c.id)}</span>
                    <span class="cluster-meta">${esc(c.topCategory || "情報")}｜${esc((c.regions ?? []).join("、") || "未標地區")}｜${c.sourceCount ?? 0} 源 · ${c.size} 則</span>
                    <span class="cluster-time">${esc(fmtDate(c.latestTs))}</span>
                  </button>
                </li>`,
              )
              .join("")}</ol>`
          : `<p class="empty compact">尚無可展開的情報群</p>`
      }
    </section>`;
}
