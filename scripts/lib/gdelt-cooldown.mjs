// GDELT DOC is an optional supplement with a shared public API quota.
export const GDELT_RATE_LIMIT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export function gdeltRetryAt(previous, { now = Date.now(), cooldownMs = GDELT_RATE_LIMIT_COOLDOWN_MS } = {}) {
  if (previous?.ok === true) return null;
  const limited = /GDELT HTTP 429/i.test(String(previous?.error || "")) || Boolean(previous?.lastRateLimitAt);
  if (!limited) return null;
  const limitedAt = Date.parse(previous?.lastRateLimitAt || previous?.lastAttemptAt);
  const age = Number(now) - limitedAt;
  if (!Number.isFinite(age) || age < 0 || age >= cooldownMs) return null;
  return new Date(limitedAt + cooldownMs).toISOString();
}
