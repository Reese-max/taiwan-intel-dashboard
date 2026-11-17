// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExternalNews } from "../src/components/ExternalNews";
import type { IntelEvent } from "../src/types/event";

const event = (title: string): IntelEvent => ({
  id: '站內"事件', title, summary: "", timestamp: "2026-11-16T00:00:00Z", category: "", region: "",
  scope: "domestic", riskLevel: "low", source: { name: "測試", type: "manual", fetchedAt: "2026-11-16T00:00:00Z" },
});
const item = (title: string, pubDate = "2026-11-16T00:00:00Z") => ({ title, pubDate, source: "測試來源", link: "https://example.com/news?a=1&b=2" });
const setup = () => {
  const container = document.createElement("section");
  document.body.append(container);
  const focus = vi.fn();
  return { container, focus, update: createExternalNews(container, focus) };
};
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = ""; });

describe("站外即時新聞", () => {
  it("失敗結果不快取，同一查詢下次會重新請求", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ upstream: "error", items: [] }))
      .mockResolvedValueOnce(Response.json({ upstream: "ok", items: [item("颱風來襲停班停課")] }));
    vi.stubGlobal("fetch", fetcher);
    const { container, update } = setup();
    await update("颱風", []);
    expect(container.textContent).toContain("暫時無法使用");
    await Promise.resolve();
    await update("颱風", []);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("颱風來襲停班停課");
  });

  it("顯示載入狀態、跳脫文字與連結，並沿用事件聚焦回呼", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    const { container, focus, update } = setup();
    const pending = update("火災", [event("台北工廠火災消防搶救")]);
    expect(container.textContent).toContain("站外新聞載入中");
    resolve(Response.json({ upstream: "ok", items: [{ ...item("台北工廠火災現場 <img>"), source: '<img src=x onerror="惡意">' }] }));
    await pending;
    expect(container.textContent).toContain("未經本站驗證");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("h3")?.textContent).toContain("<img>");
    expect(container.textContent).toContain('<img src=x onerror="惡意">');
    const link = container.querySelector("a")!;
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(link.href).toBe("https://example.com/news?a=1&b=2");
    container.querySelector<HTMLButtonElement>("button")!.click();
    expect(focus).toHaveBeenCalledWith('站內"事件');
  });

  it("同義詞以 OR 分組、各詞 AND，同一查詢跨重新繪製與返回時只抓一次", async () => {
    const fetcher = vi.fn(async () => Response.json({ upstream: "ok", items: [] }));
    vi.stubGlobal("fetch", fetcher);
    const { update } = setup();
    await Promise.all([update("最近的電信新聞", []), update("最近的電信新聞", [])]);
    await update("火災", []);
    await update("最近的電信新聞", []);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const params = new URL(fetcher.mock.calls[0][0], "https://site.test").searchParams;
    expect(params.get("q")).toBe("(電信 OR 中華電信 OR 台灣大哥大 OR 遠傳 OR 5G OR 基地台)");
    expect(params.get("q")).toContain("中華電信");
    expect(params.get("days")).toBe("7");
  });

  it("舊查詢晚到與清空後的回應都不能覆蓋目前畫面", async () => {
    const replies: Array<(response: Response) => void> = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => replies.push(resolve))));
    const { update, container } = setup();
    const first = update("電信", []);
    const second = update("火災", []);
    replies[1](Response.json({ upstream: "ok", items: [item("新查詢報導")] }));
    await second;
    replies[0](Response.json({ upstream: "ok", items: [item("舊查詢報導")] }));
    await first;
    expect(container.textContent).toContain("新查詢報導");
    expect(container.textContent).not.toContain("舊查詢報導");
    const third = update("颱風", []);
    await update(undefined, []);
    replies[2](Response.json({ upstream: "ok", items: [item("清空前報導")] }));
    await third;
    expect(container.hidden).toBe(true);
    expect(container.innerHTML).toBe("");
  });

  it("空結果、上游失敗、網路失敗與無效 JSON 各有降級文字", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ upstream: "ok", items: [] }))
      .mockResolvedValueOnce(Response.json({ upstream: "error", items: [] }))
      .mockRejectedValueOnce(new Error("網路失敗"))
      .mockResolvedValueOnce(new Response("不是 JSON"));
    vi.stubGlobal("fetch", fetcher);
    const { update, container } = setup();
    await update("電信", []);
    expect(container.textContent).toContain("沒有其他站外新聞");
    for (const query of ["火災", "颱風", "國防"]) {
      await update(query, []);
      expect(container.textContent).toContain("仍可查看站內結果");
    }
  });

  it("重複新聞與不安全連結隱藏，站內事件載入後重新比對但不重抓", async () => {
    const fetcher = vi.fn(async () => Response.json({ upstream: "ok", items: [
      item("台北工廠火災消防搶救"), { ...item("不安全連結"), link: "javascript:alert(1)" },
    ] }));
    vi.stubGlobal("fetch", fetcher);
    const { update, container } = setup();
    await update("火災", []);
    expect(container.querySelectorAll("article")).toHaveLength(1);
    await update("火災", [event("台北工廠火災消防搶救")]);
    expect(container.querySelectorAll("article")).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("任意天數向上對齊 API 白名單，再精確排除時間窗外新聞", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
    const fetcher = vi.fn(async () => Response.json({ upstream: "ok", items: [item("近期報導"), item("較早報導", "2026-11-11T00:00:00Z")] }));
    vi.stubGlobal("fetch", fetcher);
    const { update, container } = setup();
    await update("近5天電信", []);
    expect(new URL(fetcher.mock.calls[0][0], "https://site.test").searchParams.get("days")).toBe("7");
    expect(container.textContent).toContain("近期報導");
    expect(container.textContent).not.toContain("較早報導");
  });

  it("只有時間詞可查詢新聞，過長查詢提示縮短並保留站內使用", async () => {
    const fetcher = vi.fn(async () => Response.json({ upstream: "ok", items: [] }));
    vi.stubGlobal("fetch", fetcher);
    const { update, container } = setup();
    await update("最近新聞", []);
    expect(new URL(fetcher.mock.calls[0][0], "https://site.test").searchParams.get("q")).toBe("新聞");
    await update("字".repeat(121), []);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("請縮短或調整搜尋內容");
  });
});
