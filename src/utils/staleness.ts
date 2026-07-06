const MS_PER_HOUR = 60 * 60 * 1000;

export function stalenessHours(generatedAt: string | undefined, now: number): number | null {
  if (!generatedAt) return null;
  const generatedMs = Date.parse(generatedAt);
  if (!Number.isFinite(generatedMs) || !Number.isFinite(now)) return null;
  return (now - generatedMs) / MS_PER_HOUR;
}

export function stalenessNotice(
  generatedAt: string | undefined,
  now: number,
  thresholdHours = 6,
): string | null {
  if (!generatedAt) return null;
  const hours = stalenessHours(generatedAt, now);
  if (hours === null || hours <= thresholdHours) return null;
  const lastUpdated = new Date(generatedAt).toLocaleString("zh-TW", { hour12: false });
  return `資料已 ${Math.floor(hours)} 小時未更新（最後更新 ${lastUpdated}）`;
}
