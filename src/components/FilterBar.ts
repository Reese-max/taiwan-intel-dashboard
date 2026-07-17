import { getState, setState } from "../store";
import type { NewsAuthority, RiskLevel, Scope } from "../types/event";
import { esc } from "../utils/escape";
import { debounce } from "../utils/debounce";

const CATS: Record<Scope, string[]> = {
  domestic: ["治安", "社會", "反詐", "災防", "國防", "海事", "採購", "協尋", "交通", "食安", "衛生", "環境", "資安", "能源", "水情"],
  international: ["地緣政治", "災害", "資安", "金融"],
};

export function renderFilterBar(container: HTMLElement, scope: Scope): void {
  const state = getState();
  const cats = CATS[scope].map((c) => `<option value="${c}">${c}</option>`).join("");
  container.innerHTML = `
    <select id="f-cat" aria-label="分類篩選"><option value="">全部分類</option>${cats}</select>
    ${scope === "domestic" ? `<select id="f-authority" aria-label="警政新聞來源篩選">
      <option value="">全部警政新聞</option>
      <option value="official">官方警政新聞</option>
      <option value="media">媒體警政新聞</option>
    </select>` : ""}
    <select id="f-risk" aria-label="風險篩選">
      <option value="">全部風險</option>
      <option value="medium">中以上</option>
      <option value="high">高以上</option>
      <option value="critical">僅危急</option>
    </select>
    <select id="f-range" aria-label="時間範圍">
      <option value="3">近 3 天</option>
      <option value="5">近 5 天</option>
      <option value="">全部時間</option>
    </select>
    <div class="search-box">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="16.5" y1="16.5" x2="21" y2="21"></line></svg>
      <input id="f-query" type="search" aria-label="關鍵字搜尋" placeholder="搜尋情報關鍵字…（自動帶出關聯）" value="${esc(state.query ?? "")}">
      <kbd class="search-hint" aria-hidden="true">/</kbd>
    </div>`;
  container.querySelector<HTMLSelectElement>("#f-cat")!.value = state.category ?? "";
  const authority = container.querySelector<HTMLSelectElement>("#f-authority");
  if (authority) authority.value = state.newsAuthority ?? "";
  container.querySelector<HTMLSelectElement>("#f-risk")!.value = state.minRisk ?? "";
  container.querySelector<HTMLSelectElement>("#f-range")!.value = state.sinceDays ? String(state.sinceDays) : "";
  container.querySelector<HTMLSelectElement>("#f-cat")!.onchange = (ev) =>
    setState({ category: (ev.target as HTMLSelectElement).value || undefined });
  if (authority) {
    authority.onchange = (ev) =>
      setState({ newsAuthority: ((ev.target as HTMLSelectElement).value || undefined) as NewsAuthority | undefined });
  }
  container.querySelector<HTMLSelectElement>("#f-risk")!.onchange = (ev) =>
    setState({
      minRisk: ((ev.target as HTMLSelectElement).value || undefined) as RiskLevel | undefined,
    });
  container.querySelector<HTMLSelectElement>("#f-range")!.onchange = (ev) => {
    const v = (ev.target as HTMLSelectElement).value;
    setState({ sinceDays: v ? Number(v) : undefined });
  };
  container.querySelector<HTMLInputElement>("#f-query")!.oninput = debounce((ev: unknown) => {
    const input = (ev as Event).target as HTMLInputElement;
    setState({ query: input.value.trim() || undefined });
  }, 200);
}
