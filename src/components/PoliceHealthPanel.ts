import { esc } from "../utils/escape";

interface PoliceSubstatus {
  ok?: boolean;
  count?: number;
  error?: string;
  stack?: string;
}

interface PipelineStatus {
  police?: Record<string, PoliceSubstatus | boolean | number | string | undefined> & {
    ok?: boolean;
    count?: number;
    hourLocal?: string;
    newPoliceRelatedCount?: number;
    newMinimumPerHour?: number;
    deferredNewCandidateCount?: number;
    meetsNewHourlyMinimum?: boolean;
  };
}

interface ProvSource {
  key?: string;
  name: string;
  datasetId?: string;
  category?: string;
  count: number;
  fetchedAt: string;
  lastSuccessAt?: string;
  query?: string;
  stale?: boolean;
}

interface ProvenanceManifest {
  generatedAt: string;
  pipeline?: PipelineStatus;
  sources: ProvSource[];
}

interface HourlyRun {
  hourLocal: string;
  newPoliceRelatedCount: number;
  minimumNewPerHour: number;
  deferredNewCandidateCount?: number;
  duplicateFromPriorCount?: number;
  runAttempts?: number;
  meetsNewHourlyMinimum?: boolean;
}

interface HourlyHistory {
  runs: HourlyRun[];
}

function sourceStatus(source: ProvSource, police?: PipelineStatus["police"]): { label: string; cls: string; detail: string } {
  const sub = source.key ? police?.[source.key] : undefined;
  if (typeof sub === "object" && sub && sub.ok === false) {
    return { label: "失敗", cls: "bad", detail: compactFailure(sub.error || "來源抓取失敗") };
  }
  if (source.stale) return { label: "沿用", cls: "warn", detail: "本次未更新，沿用上一版快照" };
  if (source.count <= 0) return { label: "空值", cls: "warn", detail: "本次回傳 0 筆" };
  return { label: "正常", cls: "ok", detail: `本次回傳 ${source.count} 筆` };
}

function compactFailure(value: string): string {
  const normalized = value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/\b401\b/.test(normalized)) return "HTTP 401，需要重新授權";
  if (/\b403\b/.test(normalized)) return "HTTP 403，被來源拒絕";
  if (/\b404\b/.test(normalized)) return "HTTP 404，來源路徑失效";
  if (/\b5\d\d\b/.test(normalized)) return "HTTP 5xx，來源暫時異常";
  return normalized.slice(0, 72);
}

function sourceSubstatus(source: ProvSource, police?: PipelineStatus["police"]): PoliceSubstatus | undefined {
  const sub = source.key ? police?.[source.key] : undefined;
  return typeof sub === "object" && sub ? sub : undefined;
}

function formatDateTime(value?: string): string {
  if (!value) return "無紀錄";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", { hour12: false });
}

function sourceLastSuccess(source: ProvSource, sub?: PoliceSubstatus): string {
  if (source.lastSuccessAt) return source.lastSuccessAt;
  if (sub?.ok !== false && source.count > 0 && !source.stale) return source.fetchedAt;
  return "";
}

function isPoliceSource(source: ProvSource): boolean {
  if (source.key) return true;
  const text = `${source.name}${source.datasetId || ""}`;
  return /警|165|交通事故|測速|毒品|集會遊行/.test(text);
}

function renderHourlyTrend(runs: HourlyRun[]): string {
  const ordered = [...runs].sort((a, b) => a.hourLocal.localeCompare(b.hourLocal)).slice(-24);
  if (!ordered.length) return `<p class="empty compact">尚無每小時入帳紀錄</p>`;
  const max = Math.max(...ordered.map((r) => Math.max(r.newPoliceRelatedCount, r.minimumNewPerHour, 1)));
  return `
    <div class="police-trend" aria-label="24 小時警政全新資料入帳趨勢">
      ${ordered
        .map((run) => {
          const height = Math.max(6, Math.round((run.newPoliceRelatedCount / max) * 86));
          const ok = run.meetsNewHourlyMinimum !== false && run.newPoliceRelatedCount >= run.minimumNewPerHour;
          return `<div class="police-trend-bar" title="${esc(run.hourLocal)}：${run.newPoliceRelatedCount}/${run.minimumNewPerHour}，延後 ${run.deferredNewCandidateCount || 0}">
            <div class="fill ${ok ? "ok" : "warn"}" style="height:${height}%"></div>
            <span>${esc(run.hourLocal.slice(11, 13))}</span>
          </div>`;
        })
        .join("")}
    </div>`;
}

function renderDailyTrend(runs: HourlyRun[]): string {
  const sorted = [...runs].sort((a, b) => a.hourLocal.localeCompare(b.hourLocal));
  const dates = [...new Set(sorted.map((run) => run.hourLocal.slice(0, 10)))].slice(-7);
  if (!dates.length) return `<p class="empty compact">尚無 7 日入帳紀錄</p>`;
  const bySlot = new Map<string, HourlyRun>();
  for (const run of sorted) bySlot.set(`${run.hourLocal.slice(0, 10)}T${run.hourLocal.slice(11, 13)}`, run);
  return `
    <div class="police-heatmap" aria-label="7 日每天 24 格警政全新資料入帳熱力圖">
      <div class="heatmap-hours" aria-hidden="true">
        <span></span>${Array.from({ length: 24 }, (_, hour) => `<span>${String(hour).padStart(2, "0")}</span>`).join("")}
      </div>
      ${dates
        .map((date) => {
          const cells = Array.from({ length: 24 }, (_, hour) => {
            const key = `${date}T${String(hour).padStart(2, "0")}`;
            const run = bySlot.get(key);
            const count = run?.newPoliceRelatedCount ?? 0;
            const minimum = run?.minimumNewPerHour ?? 0;
            const ratio = minimum > 0 ? Math.min(1, count / minimum) : 0;
            const cls = !run ? "empty" : count >= minimum ? "ok" : count > 0 ? "warn" : "bad";
            const level = ratio >= 1 ? 4 : ratio >= 0.75 ? 3 : ratio >= 0.35 ? 2 : count > 0 ? 1 : 0;
            const title = run
              ? `${date} ${String(hour).padStart(2, "0")}:00：${count}/${minimum}，候選池 ${run.deferredNewCandidateCount || 0}`
              : `${date} ${String(hour).padStart(2, "0")}:00：尚無紀錄`;
            return `<span class="heatmap-cell ${cls} level-${level}" title="${esc(title)}"></span>`;
          }).join("");
          return `<div class="heatmap-row"><b>${esc(date.slice(5))}</b>${cells}</div>`;
        })
        .join("")}
      <div class="heatmap-legend"><span>少</span><i class="heatmap-cell empty"></i><i class="heatmap-cell warn level-1"></i><i class="heatmap-cell warn level-2"></i><i class="heatmap-cell ok level-4"></i><span>達標</span></div>
    </div>`;
}

function renderTrendSwitcher(runs: HourlyRun[]): string {
  return `
    <div class="trend-toolbar" role="tablist" aria-label="警政入帳趨勢範圍">
      <button type="button" class="active" data-trend-range="24h">24 小時</button>
      <button type="button" data-trend-range="7d">7 日</button>
    </div>
    <div class="trend-panel" data-trend-panel="24h">${renderHourlyTrend(runs)}</div>
    <div class="trend-panel hidden" data-trend-panel="7d">${renderDailyTrend(runs)}</div>`;
}

function statusOrder(source: ProvSource, police?: PipelineStatus["police"]): number {
  const status = sourceStatus(source, police);
  if (status.cls === "bad") return 0;
  if (status.cls === "warn") return 1;
  return 2;
}

async function retryFailedSources(container: HTMLElement, failedSources: ProvSource[]): Promise<void> {
  const status = container.querySelector<HTMLElement>("[data-retry-status]");
  const keys = [...new Set(failedSources.map((s) => s.key).filter((key): key is string => Boolean(key)))];
  if (!keys.length) {
    if (status) status.textContent = "目前沒有可重試的失敗來源。";
    return;
  }
  if (status) status.textContent = `正在送出重試：${keys.join("、")}`;
  try {
    const res = await fetch("./api/retry-police-source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: keys }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (status) status.textContent = "已送出重試請求，稍後重新載入健康檢查。";
    window.setTimeout(() => void renderPoliceHealthPanel(container), 1500);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (status) {
      status.textContent = `後端重試 API 不可用（${message}）。請在主機端執行 npm run fetch:police 後重新整理。`;
    }
  }
}

export async function renderPoliceHealthPanel(container: HTMLElement): Promise<void> {
  const [provRes, historyRes] = await Promise.all([
    fetch("./data/provenance.json"),
    fetch("./data/police-hourly-history.json"),
  ]);
  if (!provRes.ok) {
    container.innerHTML = `<p class="empty">警政健康檢查不可用</p>`;
    return;
  }
  const provenance = (await provRes.json()) as ProvenanceManifest;
  const history = historyRes.ok ? ((await historyRes.json()) as HourlyHistory) : { runs: [] };
  const police = provenance.pipeline?.police;
  const policeSources = provenance.sources.filter(isPoliceSource);
  const okSources = policeSources.filter((s) => sourceStatus(s, police).cls === "ok").length;
  const failedSources = policeSources.filter((s) => sourceStatus(s, police).cls === "bad");
  const generated = new Date(provenance.generatedAt).toLocaleString("zh-TW", { hour12: false });
  const prioritizedSources = [...policeSources].sort((a, b) => {
    const order = statusOrder(a, police) - statusOrder(b, police);
    if (order) return order;
    return b.count - a.count;
  });
  const rowItems = prioritizedSources
    .map((source) => {
      const status = sourceStatus(source, police);
      const sub = sourceSubstatus(source, police);
      const stack = sub?.stack || sub?.error || "";
      const lastSuccess = sourceLastSuccess(source, sub);
      return `<li class="health-source-item">
        <details>
          <summary>
            <span class="health-dot ${status.cls}">${status.label}</span>
            <b>${esc(source.name)}</b>
            <small>${esc(status.detail)}</small>
          </summary>
          <dl class="source-debug">
            <div><dt>來源 key</dt><dd>${esc(source.key || "no-key")}</dd></div>
            <div><dt>Dataset</dt><dd>${esc(source.datasetId || "no-id")}</dd></div>
            <div><dt>分類</dt><dd>${esc(source.category || "未分類")}</dd></div>
            <div><dt>本次筆數</dt><dd>${source.count} 筆</dd></div>
            <div><dt>最近成功時間</dt><dd>${esc(formatDateTime(lastSuccess))}</dd></div>
            <div><dt>本次抓取時間</dt><dd>${esc(formatDateTime(source.fetchedAt))}</dd></div>
            <div><dt>查詢</dt><dd>${esc(source.query || `twinkle-hub police/${source.key || source.datasetId || "unknown"}`)}</dd></div>
          </dl>
          <p class="source-error-title">錯誤堆疊</p>
          <pre class="source-error-stack">${stack ? esc(stack) : "無錯誤"}</pre>
        </details>
      </li>`;
    });
  const visibleRows = rowItems.slice(0, 5).join("");
  const hiddenRows = rowItems.slice(5).join("");

  container.innerHTML = `
    <section class="police-health-card">
      <h4>警政資料源健康檢查</h4>
      <div class="health-kpis">
        <div><b>${policeSources.length}</b><span>來源</span></div>
        <div><b>${okSources}</b><span>正常</span></div>
        <div><b>${police?.newPoliceRelatedCount ?? 0}</b><span>本小時全新</span></div>
        <div><b>${police?.deferredNewCandidateCount ?? 0}</b><span>候選池</span></div>
      </div>
      <p class="health-decision"><b>處理建議</b>${failedSources.length ? `先重試 ${failedSources.length} 個失敗來源` : "來源狀態正常，細節可按需展開"}</p>
      <p class="health-meta">更新：${esc(generated)}｜目標：${police?.newMinimumPerHour ?? 200} 筆／小時</p>
      <div class="retry-row">
        <button type="button" class="retry-btn" data-retry-failed ${failedSources.length ? "" : "disabled"}>
          失敗來源重試
        </button>
        <span data-retry-status>${failedSources.length ? `待重試 ${failedSources.length} 個來源` : "目前沒有失敗來源"}</span>
      </div>
      <ul class="health-source-list">${visibleRows}</ul>
      ${
        hiddenRows
          ? `<details class="health-more">
              <summary>展開其餘 ${rowItems.length - 5} 個來源明細</summary>
              <ul class="health-source-list health-source-list-extra">${hiddenRows}</ul>
            </details>`
          : ""
      }
    </section>
    <section class="police-health-card">
      <details class="health-trend-details">
        <summary>查看每小時入帳趨勢</summary>
        ${renderTrendSwitcher(history.runs)}
      </details>
    </section>`;

  container.querySelectorAll<HTMLButtonElement>("[data-trend-range]").forEach((button) => {
    button.addEventListener("click", () => {
      const range = button.dataset.trendRange;
      container.querySelectorAll<HTMLButtonElement>("[data-trend-range]").forEach((b) => {
        b.classList.toggle("active", b === button);
      });
      container.querySelectorAll<HTMLElement>("[data-trend-panel]").forEach((panel) => {
        panel.classList.toggle("hidden", panel.dataset.trendPanel !== range);
      });
    });
  });

  container.querySelector<HTMLButtonElement>("[data-retry-failed]")?.addEventListener("click", () => {
    void retryFailedSources(container, failedSources);
  });
}
