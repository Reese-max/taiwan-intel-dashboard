import type { RiskLevel } from "../types/event";

const LABEL: Record<RiskLevel, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "危急",
};

export function riskBadge(level: RiskLevel): string {
  return `<span class="risk-badge risk-${level}">${LABEL[level]}</span>`;
}
