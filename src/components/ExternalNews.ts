import { parseSearchQuery } from "../search-query";
import { relateExternal } from "../search";
import type { IntelEvent } from "../types/event";
import { esc } from "../utils/escape";
import { fmtDate } from "./EventCard";

interface ExternalItem {
  title: string;
  link: string;
  source: string;
  pubDate: string | null;
}
interface ExternalResult {
  items: ExternalItem[];
  upstream: "ok" | "error";
}

function isExternalItem(item: unknown): item is ExternalItem {
  if (!item || typeof item !== "object") return false;
  const value = item as ExternalItem;
  if (typeof value.title !== "string" || typeof value.source !== "string" || typeof value.link !== "string") return false;
  if (value.pubDate !== null && (typeof value.pubDate !== "string" || !Number.isFinite(Date.parse(value.pubDate)))) return false;
  try { return ["http:", "https:"].includes(new URL(value.link).protocol); } catch { return false; }
}

export function createExternalNews(container: HTMLElement, onFocus: (id: string) => void) {
  let current = 0;
  const requests = new Map<string, { expires: number; result: Promise<ExternalResult> }>();
  container.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-rel]");
    if (button?.dataset.rel) onFocus(button.dataset.rel);
  });
  const render = (body: string) => {
    container.innerHTML = `<h2>站外即時新聞（Google News，未經本站驗證）</h2>${body}`;
  };

  return async (text: string | undefined, events: IntelEvent[]): Promise<void> => {
    const version = ++current;
    container.hidden = !text?.trim();
    if (container.hidden) { container.innerHTML = ""; return; }
    const parsed = parseSearchQuery(text!);
    // 各詞 AND、同義詞 OR；每組最多 6 個同義詞以免超過 120 字上限。
    const q = parsed.groups.map(group => group.length > 1 ? `(${group.slice(0, 6).join(" OR ")})` : group[0]).join(" ") || "新聞";
    const windowDays = parsed.windowDays ?? 7;
    // API 僅接受固定天數；其他天數向上取整後，再依原時間窗篩選回應。
    const days = [1, 2, 3, 7, 30].find(day => day >= windowDays)!;
    if ([...q].length > 120 || /[\p{Cc}\p{Cf}]/u.test(q)) {
      render('<p class="empty" role="status">站外查詢須為 1–120 字且不得含控制字元，請縮短或調整搜尋內容。</p>');
      return;
    }
    const key = new URLSearchParams({ q, days: String(days) }).toString();
    const now = Date.now();
    for (const [key, value] of requests) if (value.expires <= now) requests.delete(key);
    let cached = requests.get(key);
    if (!cached) {
      const result = (async (): Promise<ExternalResult> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
          const response = await fetch(`/api/search?${key}`, { signal: controller.signal });
          if (!response.ok) throw new Error("站外搜尋暫時無法使用");
          const body = await response.json();
          if (!Array.isArray(body?.items) || !["ok", "error"].includes(body?.upstream)) throw new Error("站外回應格式錯誤");
          return { items: body.items.filter(isExternalItem).slice(0, 30), upstream: body.upstream };
        } catch { return { items: [], upstream: "error" }; }
        finally { clearTimeout(timer); }
      })();
      cached = { expires: now + 600_000, result };
      requests.set(key, cached);
      // 只共用進行中的請求；失敗結果不快取，下次搜尋重新查。
      const entry = cached;
      void result.then(r => { if (r.upstream === "error" && requests.get(key) === entry) requests.delete(key); });
    }
    render('<p class="empty" role="status">站外新聞載入中…</p>');
    const result = await cached.result;
    if (version !== current) return;
    if (result.upstream === "error") {
      render('<p class="empty" role="status">Google News 暫時無法使用，仍可查看站內結果。</p>');
      return;
    }
    const cards = result.items.flatMap(item => {
      if (parsed.windowDays !== null) {
        const timestamp = item.pubDate ? Date.parse(item.pubDate) : NaN;
        if (!(timestamp >= now - windowDays * 86_400_000 && timestamp <= now)) return [];
      }
      const { related, duplicate } = relateExternal(item, events);
      if (duplicate) return [];
      return [`<article class="event-card">
        <h3>${esc(item.title)}</h3>
        <footer><span>${esc(item.source || "來源未提供")}</span>
          <time>${esc(item.pubDate ? fmtDate(item.pubDate) : "時間未提供")}</time>
          <a class="src-link" href="${esc(item.link)}" target="_blank" rel="noopener noreferrer">開啟原文 ↗</a>
        </footer>
        ${related.length ? `<p class="summary">${related.map(event => `<button type="button" class="rel-link" data-rel="${esc(event.id)}">站內相關：${esc(event.title)}</button>`).join(" ")}</p>` : ""}
      </article>`];
    });
    render(cards.join("") || '<p class="empty" role="status">沒有其他站外新聞（與站內重複的報導已隱藏）。</p>');
  };
}
