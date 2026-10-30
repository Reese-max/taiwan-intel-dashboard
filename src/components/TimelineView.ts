import type { IntelEvent } from "../types/event";
import { esc } from "../utils/escape";

export function renderTimeline(container: HTMLElement, events: IntelEvent[]): void {
  const days: { label: string; count: number; y: number; m: number; d: number }[] = [];
  const now = Date.now();
  // 5 天視窗，對齊 5 天保留窗（超窗事件已被剪除，畫 7 天會出現誤導的空日）。
  for (let i = 4; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    days.push({
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      count: 0,
      y: d.getFullYear(),
      m: d.getMonth(),
      d: d.getDate(),
    });
  }

  // 單趟走訪統計 5 天次數與最大時間，避免 5 次 filter 反覆建立與比對數萬個 Date 物件
  let latest = 0;
  for (let idx = 0; idx < events.length; idx++) {
    const e = events[idx];
    const t = new Date(e.timestamp);
    const ms = t.getTime();
    if (Number.isFinite(ms) && ms > latest) latest = ms;
    const ey = t.getFullYear();
    const em = t.getMonth();
    const ed = t.getDate();
    for (let b = 0; b < 5; b++) {
      const day = days[b];
      if (day.y === ey && day.m === em && day.d === ed) {
        day.count++;
        break;
      }
    }
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
  if (total === 0 && events.length && latest > 0) {
    const latestLabel = new Date(latest).toLocaleDateString("zh-TW");
    hint = `<p class="tl-hint">近 5 天無事件，最近事件於 ${esc(latestLabel)}</p>`;
  }

  container.innerHTML = `<div class="timeline">${bars}</div>${hint}`;
}
