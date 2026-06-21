import type { IntelEvent } from "../types/event";
import { esc } from "../utils/escape";

export function renderTimeline(container: HTMLElement, events: IntelEvent[]): void {
  const days: { label: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    const count = events.filter((e) => {
      const t = new Date(e.timestamp);
      return (
        t.getFullYear() === d.getFullYear() &&
        t.getMonth() === d.getMonth() &&
        t.getDate() === d.getDate()
      );
    }).length;
    days.push({ label, count });
  }

  const total = days.reduce((a, b) => a + b.count, 0);
  const max = Math.max(1, ...days.map((d) => d.count));
  const bars = days
    .map(
      (d) =>
        `<div class="tl-bar"><div class="tl-fill" style="height:${(d.count / max) * 100}%"></div><span>${d.label}</span><b>${d.count}</b></div>`,
    )
    .join("");

  let hint = "";
  if (total === 0 && events.length) {
    const latest = events
      .map((e) => new Date(e.timestamp).getTime())
      .reduce((a, b) => Math.max(a, b), 0);
    const latestLabel = new Date(latest).toLocaleDateString("zh-TW");
    hint = `<p class="tl-hint">近 7 天無事件，最近事件於 ${esc(latestLabel)}</p>`;
  }

  container.innerHTML = `<div class="timeline">${bars}</div>${hint}`;
}
