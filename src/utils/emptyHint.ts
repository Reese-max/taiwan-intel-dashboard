import type { IntelEvent } from "../types/event";

export function emptyListHint(
  all: IntelEvent[],
  state: {
    category?: string;
    sinceDays?: number;
    minRisk?: string;
    query?: string;
  },
  nowMs: number,
): string | null {
  if (!state.sinceDays) return null;
  if (state.query || state.minRisk) return null;

  const matching = state.category ? all.filter((e) => e.category === state.category) : all;
  if (!matching.length) return null;

  let newest = Number.NEGATIVE_INFINITY;
  for (const e of matching) {
    const t = new Date(e.timestamp).getTime();
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  if (!Number.isFinite(newest)) return null;

  const ageDays = Math.ceil((nowMs - newest) / 86_400_000);
  if (ageDays <= state.sinceDays) return null;

  return state.category
    ? `此分類最近一筆在 ${ageDays} 天前，改選「全部時間」可檢視`
    : `此視圖最近一筆在 ${ageDays} 天前，改選「全部時間」可檢視`;
}
