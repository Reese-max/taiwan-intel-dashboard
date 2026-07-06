const JUDICIAL_RESULT_RE = /判決|定讞|判刑|判賠|宣判|判處|改判|更審|上訴駁回|無罪(?:確定|定讞)|判.{0,4}(?:徒刑|拘役|罰金)/;

export function temporalStateFor(event, { now = Date.now(), historicalDays = 180 } = {}) {
  const title = String(event?.title || "");
  if (JUDICIAL_RESULT_RE.test(title)) return "judicial";

  if (event?.category === "協尋") return undefined;

  const timestamp = Date.parse(event?.timestamp);
  if (!Number.isFinite(timestamp)) return undefined;

  return timestamp < now - historicalDays * 86400e3 ? "historical" : undefined;
}

export function applyTemporal(events, opts) {
  return (Array.isArray(events) ? events : []).map((event) => {
    const temporal = temporalStateFor(event, opts);
    return temporal ? { ...event, temporal } : event;
  });
}
