import { getState, setState } from "../store";
import type { RiskLevel, Scope } from "../types/event";
import { esc } from "../utils/escape";

const CATS: Record<Scope, string[]> = {
  domestic: ["治安", "反詐", "災防", "採購", "交通"],
  international: ["地緣政治", "災害", "資安", "金融"],
};

export function renderFilterBar(container: HTMLElement, scope: Scope): void {
  const state = getState();
  const cats = CATS[scope].map((c) => `<option value="${c}">${c}</option>`).join("");
  container.innerHTML = `
    <select id="f-cat" aria-label="分類篩選"><option value="">全部分類</option>${cats}</select>
    <select id="f-risk" aria-label="風險篩選">
      <option value="">全部風險</option>
      <option value="medium">中以上</option>
      <option value="high">高以上</option>
      <option value="critical">僅危急</option>
    </select>
    <select id="f-range" aria-label="時間範圍">
      <option value="3">近 3 天</option>
      <option value="7">近 7 天</option>
      <option value="">全部時間</option>
    </select>
    <input id="f-query" type="search" aria-label="關鍵字搜尋" placeholder="搜尋關鍵字→子網" value="${esc(state.query ?? "")}">`;
  container.querySelector<HTMLSelectElement>("#f-cat")!.value = state.category ?? "";
  container.querySelector<HTMLSelectElement>("#f-risk")!.value = state.minRisk ?? "";
  container.querySelector<HTMLSelectElement>("#f-range")!.value = state.sinceDays ? String(state.sinceDays) : "";
  container.querySelector<HTMLSelectElement>("#f-cat")!.onchange = (ev) =>
    setState({ category: (ev.target as HTMLSelectElement).value || undefined });
  container.querySelector<HTMLSelectElement>("#f-risk")!.onchange = (ev) =>
    setState({
      minRisk: ((ev.target as HTMLSelectElement).value || undefined) as RiskLevel | undefined,
    });
  container.querySelector<HTMLSelectElement>("#f-range")!.onchange = (ev) => {
    const v = (ev.target as HTMLSelectElement).value;
    setState({ sinceDays: v ? Number(v) : undefined });
  };
  container.querySelector<HTMLInputElement>("#f-query")!.oninput = (ev) =>
    setState({ query: (ev.target as HTMLInputElement).value.trim() || undefined });
}
