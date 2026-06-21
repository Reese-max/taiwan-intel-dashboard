// 警政查詢助手 — 前端（獨立頁）。三模組：詐騙查驗 / 判決檢索 / 毒品速查。
// 呼叫本機後端 /api/*，渲染結果卡片，固定附免責聲明。純 vanilla TS。
import "./styles/query.css";

type TabKey = "fraud" | "judicial" | "drug" | "catalog";

interface FraudHit {
  source: string;
  url?: string;
  name?: string;
  nature?: string;
  period?: string;
  applicant?: string;
  title?: string;
  time?: string;
  content?: string;
  from?: string;
  to?: string;
}
interface FraudResult { query: string; matched: boolean; hits: FraudHit[]; verdict: string; }

interface JudicialCase {
  jid: string;
  title: string;
  court: string;
  date: string;
  issue: string;
  outcome: string;
  winner: string;
  sentence: string;
  reasoning: string;
  pdf: string;
  similarity: number | null;
}
interface JudicialResult { query: string; cases: JudicialCase[]; }

interface DrugItem {
  nameZh: string;
  nameEn: string;
  controlledClass: string;
  indication: string;
  dosageForm: string;
  licenseNo: string;
}
interface DrugResult { query: string; found: boolean; items: DrugItem[]; caveat: string; }

interface CatalogDataset {
  id: string;
  name: string;
  agency: string;
  domain: string;
  updateFreq: string;
  quality: string;
  formats: string[];
  normalised: boolean;
  hasGeo: boolean;
}
interface CatalogResult { query: string; count: number; datasets: CatalogDataset[]; }
interface DatasetPreview { id: string; columns: string[]; rows: string[][]; rowCount: number; }

const TABS: { key: TabKey; label: string; placeholder: string; hint: string }[] = [
  { key: "fraud", label: "詐騙查驗", placeholder: "輸入網址、平台名稱或關鍵字（如 saxotader.top）", hint: "比對 165 涉詐網站停解析、假投資(博弈)網站、詐騙闢謠三份清單。" },
  { key: "judicial", label: "判決檢索", placeholder: "輸入案情或罪名（如 假投資詐欺 提供帳戶）", hint: "對全國 124 萬筆判決做語意檢索，回傳爭點、刑度、關鍵理由。" },
  { key: "drug", label: "毒品速查", placeholder: "輸入物質名稱（中/英，如 愷他命 / Ketamine）", hint: "查衛福部管制藥品許可庫的管制級別。查無不代表非毒品。" },
  { key: "catalog", label: "開放資料", placeholder: "輸入主題關鍵字（如 停車場、空氣品質、槍砲）", hint: "在全台 5 萬+ 政府開放資料集中搜尋；點資料集可預覽前 50 列。" },
];

const DISCLAIMER =
  "資料來源：政府開放資料（警政署 165 / 司法院裁判書 / 衛福部管制藥品）。本工具僅供輔助參考，非正式法律意見或鑑識結論，一切以官方公告為準。";

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

let current: TabKey = "fraud";

const app = document.getElementById("app");
if (!app) throw new Error("#app not found");

function shell(): void {
  app!.innerHTML = `
    <div class="wrap">
      <header class="app">
        <h1>警政查詢助手</h1>
        <span class="sub">開放資料即時查詢 · 輔助勤務判斷</span>
        <span class="badge">本機自用</span>
      </header>
      <nav class="tabs" role="tablist">
        ${TABS.map((t) => `<button class="tab" role="tab" data-key="${t.key}" aria-selected="${t.key === current}">${t.label}</button>`).join("")}
      </nav>
      <form class="searchbar" id="form">
        <input id="q" type="text" autocomplete="off" />
        <button type="submit" id="go">查詢</button>
      </form>
      <p class="hint" id="hint"></p>
      <div id="results"></div>
      <p class="disclaimer">${DISCLAIMER}</p>
    </div>`;

  const input = byId<HTMLInputElement>("q");
  const tab = TABS.find((t) => t.key === current)!;
  input.placeholder = tab.placeholder;
  byId("hint").textContent = tab.hint;

  app!.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      current = btn.dataset.key as TabKey;
      shell();
    });
  });
  byId<HTMLFormElement>("form").addEventListener("submit", (e) => {
    e.preventDefault();
    void run(input.value);
  });
  input.focus();
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
}

function setState(html: string): void {
  byId("results").innerHTML = html;
}

async function run(raw: string): Promise<void> {
  const q = raw.trim();
  if (!q) return;
  const go = byId<HTMLButtonElement>("go");
  go.disabled = true;
  setState(`<p class="state">查詢中…</p>`);
  try {
    const res = await fetch(`/api/${current}?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!res.ok) {
      setState(`<p class="state err">${esc(data.error || "查詢失敗")}</p>`);
      return;
    }
    if (current === "fraud") renderFraud(data as FraudResult);
    else if (current === "judicial") renderJudicial(data as JudicialResult);
    else if (current === "drug") renderDrug(data as DrugResult);
    else renderCatalog(data as CatalogResult);
  } catch {
    setState(`<p class="state err">無法連線到查詢服務，請確認後端是否啟動。</p>`);
  } finally {
    go.disabled = false;
  }
}

function renderFraud(d: FraudResult): void {
  const verdict = `<div class="verdict ${d.matched ? "hit" : "miss"}">${esc(d.verdict)}</div>`;
  const cards = d.hits
    .map((h) => {
      const head = h.url
        ? `<span class="tag url">${esc(h.url)}</span>`
        : `<span class="title">${esc(h.title || h.name || "")}</span>`;
      const meta = [h.nature, h.name, h.period, h.time, h.from && `${h.from}~${h.to || ""}`, h.applicant]
        .filter(Boolean)
        .map((m) => `<span>${esc(m)}</span>`)
        .join("");
      const body = h.content ? `<div class="body">${esc(h.content)}</div>` : "";
      return `<div class="card"><div class="src">${esc(h.source)}</div><div class="meta">${head}${meta}</div>${body}</div>`;
    })
    .join("");
  setState(verdict + (cards ? `<div class="cards">${cards}</div>` : ""));
}

function renderJudicial(d: JudicialResult): void {
  if (!d.cases.length) {
    setState(`<p class="state">查無相關判決。可換關鍵字或描述案情。</p>`);
    return;
  }
  const cards = d.cases
    .map((c) => {
      const meta = [c.court, c.date, c.outcome && `判決：${c.outcome}`, c.winner]
        .filter(Boolean)
        .map((m) => `<span>${esc(m)}</span>`)
        .join("");
      const sentence = c.sentence ? `<div class="meta"><span class="tag level">刑度：${esc(c.sentence)}</span></div>` : "";
      const issue = c.issue ? `<div class="body"><strong>爭點：</strong>${esc(c.issue)}</div>` : "";
      const reason = c.reasoning ? `<div class="body"><strong>理由：</strong>${esc(c.reasoning)}</div>` : "";
      const pdf = c.pdf ? `<div class="body"><a href="${esc(c.pdf)}" target="_blank" rel="noopener">判決書全文 PDF →</a></div>` : "";
      return `<div class="card j"><div class="src">${esc(c.jid)}</div><div class="title">${esc(c.title)}</div><div class="meta">${meta}</div>${sentence}${issue}${reason}${pdf}</div>`;
    })
    .join("");
  setState(`<div class="cards">${cards}</div>`);
}

function renderDrug(d: DrugResult): void {
  const caveat = `<div class="verdict ${d.found ? "miss" : "hit"}">${esc(d.caveat)}</div>`;
  const cards = d.items
    .map((it) => {
      const meta = [it.dosageForm, it.indication, it.licenseNo]
        .filter(Boolean)
        .map((m) => `<span>${esc(m)}</span>`)
        .join("");
      const cls = it.controlledClass
        ? `<div class="meta"><span class="tag level">${esc(it.controlledClass)}</span></div>`
        : "";
      return `<div class="card d"><div class="title">${esc(it.nameZh)} <span class="src">${esc(it.nameEn)}</span></div>${cls}<div class="meta">${meta}</div></div>`;
    })
    .join("");
  setState((cards ? `<div class="cards">${cards}</div>` : "") + caveat);
}

function renderCatalog(d: CatalogResult): void {
  if (!d.datasets.length) {
    setState(`<p class="state">查無相關資料集。可換主題關鍵字再試。</p>`);
    return;
  }
  const cards = d.datasets
    .map((ds) => {
      const meta = [ds.agency, ds.domain, ds.quality, ds.updateFreq && `更新：${ds.updateFreq}`, ds.formats.join("/"), ds.hasGeo && "含座標"]
        .filter(Boolean)
        .map((m) => `<span>${esc(m)}</span>`)
        .join("");
      return `<div class="card cat"><div class="title">${esc(ds.name)}</div><div class="meta">${meta}</div><div class="meta"><button class="mini" data-id="${esc(ds.id)}">預覽前 50 列 →</button><span class="src">id: ${esc(ds.id)}</span></div><div class="preview" id="pv-${esc(ds.id)}"></div></div>`;
    })
    .join("");
  setState(`<p class="hint">找到約 ${esc(d.count)} 個相關資料集，顯示前 ${d.datasets.length} 個。</p><div class="cards">${cards}</div>`);
  byId("results").querySelectorAll<HTMLButtonElement>("button.mini").forEach((btn) => {
    btn.addEventListener("click", () => void previewDataset(btn.dataset.id || "", btn));
  });
}

async function previewDataset(id: string, btn: HTMLButtonElement): Promise<void> {
  if (!id) return;
  const box = document.getElementById(`pv-${id}`);
  if (!box) return;
  btn.disabled = true;
  box.innerHTML = `<p class="state">載入中…</p>`;
  try {
    const res = await fetch(`/api/dataset?id=${encodeURIComponent(id)}`);
    const data = (await res.json()) as DatasetPreview & { error?: string };
    if (!res.ok) {
      box.innerHTML = `<p class="state err">${esc(data.error || "預覽失敗")}</p>`;
      return;
    }
    if (!data.columns.length) {
      box.innerHTML = `<p class="state">此資料集無可預覽欄位。</p>`;
      return;
    }
    const head = data.columns.map((c) => `<th>${esc(c)}</th>`).join("");
    const body = data.rows
      .map((r) => `<tr>${data.columns.map((_, i) => `<td>${esc(r[i])}</td>`).join("")}</tr>`)
      .join("");
    box.innerHTML = `<div class="pv"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div><p class="src">顯示 ${data.rows.length} / 共 ${esc(data.rowCount)} 列</p>`;
  } catch {
    box.innerHTML = `<p class="state err">無法連線到查詢服務。</p>`;
  } finally {
    btn.disabled = false;
  }
}

shell();
