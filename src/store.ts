import type { Scope, RiskLevel, NewsAuthority } from "./types/event";

export interface AppState {
  scope: Scope;
  category?: string;
  minRisk?: RiskLevel;
  source?: string;
  newsAuthority?: NewsAuthority;
  sinceDays?: number;
  query?: string;
  region?: string;
  day?: string;
}

type Listener = (s: AppState) => void;

export const DEFAULT_SINCE_DAYS = 3;
const state: AppState = { scope: "domestic", sinceDays: DEFAULT_SINCE_DAYS };
let sinceDaysBeforeDay: number | undefined = DEFAULT_SINCE_DAYS;
const listeners = new Set<Listener>();

export function getState(): AppState {
  return { ...state };
}

export function setState(patch: Partial<AppState>): void {
  if ("day" in patch) {
    if (patch.day) {
      // 網址還原沒有選日前的紀錄，回到預設時間範圍。
      if (!state.day || "sinceDays" in patch) {
        sinceDaysBeforeDay = "sinceDays" in patch ? DEFAULT_SINCE_DAYS : state.sinceDays;
      }
      patch = { ...patch, sinceDays: undefined };
    } else if (state.day && !("sinceDays" in patch)) {
      patch = { ...patch, sinceDays: sinceDaysBeforeDay };
    }
  }
  Object.assign(state, patch);
  listeners.forEach((l) => l(getState()));
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
