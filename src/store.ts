import type { Scope, RiskLevel } from "./types/event";

export interface AppState {
  scope: Scope;
  category?: string;
  minRisk?: RiskLevel;
  source?: string;
  sinceDays?: number;
  query?: string;
}

type Listener = (s: AppState) => void;

const state: AppState = { scope: "domestic", sinceDays: 3 };
const listeners = new Set<Listener>();

export function getState(): AppState {
  return { ...state };
}

export function setState(patch: Partial<AppState>): void {
  Object.assign(state, patch);
  listeners.forEach((l) => l(getState()));
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
