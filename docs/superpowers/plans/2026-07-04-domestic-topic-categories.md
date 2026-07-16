# 國內新主題分類（食安/衛生/環境/資安）＋EN 來源支援 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 9 個近零貢獻的新聞來源產生實際貢獻——7 個中文主題來源改走各自主題關鍵字漏斗、入四個新分類（食安/衛生/環境/資安），2 個 EN 來源補英文警政關鍵字走既有漏斗。

**Architecture:** 相關性判定由單一 `POLICE_RE` 改為「hint 分派」：feed 的 hint 若在新表 `TOPIC_RE` 中，用該主題正則；否則照舊走 `POLICE_RE`（既有來源零行為改變）。分類經 `HINT_TO_CAT` 直通新分類。EN 支援 = `POLICE_RE` 與風險評級各補一組英文正則 OR 進去。

**Tech Stack:** Node.js ESM（`scripts/lib/*.mjs`）、Vitest、Vanilla TS 前端。

**Spec:** `docs/specs/2026-07-04-domestic-topic-categories.md`

## Global Constraints

- 既有 hint（治安/反詐/災防/交通）的來源行為零改變——回歸測試保護。
- 不動來源 URL、不增刪來源、不新增資料檔、不動 CI。
- 全部既有測試（210+）不得退化。
- Commit 格式：`type(scope): description`（不加 attribution）。
- 測試指令：單檔 `npx vitest run tests/<file>.test.ts`，全套 `npm test`。
- 工作目錄：`D:\Users\Administrator\Desktop\爬蟲資料\taiwan-intel-dashboard`。

---

### Task 1: hint 分派相關性判定 + 新分類映射（news-bulk.mjs）

**Files:**
- Modify: `scripts/lib/news-bulk.mjs`（`HINT_TO_CAT` 約 line 42、`POLICE_RE`/`isPoliceRelevant` 約 line 64-69、`mapBulkNews` 內的 gate 約 line 90）
- Modify: `scripts/fetch-live.mjs:26`（import）與 `scripts/fetch-live.mjs:270`（預篩呼叫點）
- Test: `tests/news-bulk.test.ts`

**Interfaces:**
- Consumes: 既有 `POLICE_RE`、`HINT_TO_CAT`、`mapBulkNews`。
- Produces: `export function isRelevantNewsItem(item)`（item 需有 `title`/`description`/`hint`；回傳 boolean）。`isPoliceRelevant(title, description)` 維持既有簽名不變。Task 3 依賴新 hint 值 `食安`/`衛生`/`環境`；`HINT_TO_CAT` 將 `資安→資安`（原為 `資安→治安`）。

- [ ] **Step 1: 寫失敗測試**

在 `tests/news-bulk.test.ts` 底部加：

```ts
import { isRelevantNewsItem } from "../scripts/lib/news-bulk.mjs";

describe("isRelevantNewsItem（hint 分派主題漏斗）", () => {
  const mk = (title: string, hint: string, description = "") => ({ title, hint, description, link: "https://x/t", source: "s", sourceUrl: "u", pubDate: "x" });

  it("食安 hint 用食安關鍵字（不再被警政漏斗擋掉）", () => {
    expect(isRelevantNewsItem(mk("知名餐廳使用餿水油遭勒令下架", "食安"))).toBe(true);
    expect(isRelevantNewsItem(mk("農委會推廣有機農業補助說明會", "食安"))).toBe(false);
  });

  it("衛生 hint 用衛生關鍵字", () => {
    expect(isRelevantNewsItem(mk("腸病毒疫情升溫 幼兒園爆群聚", "衛生"))).toBe(true);
    expect(isRelevantNewsItem(mk("醫院擴建工程動土典禮", "衛生"))).toBe(false);
  });

  it("環境 hint 用環境關鍵字", () => {
    expect(isRelevantNewsItem(mk("電鍍廠偷排廢水遭裁罰百萬", "環境"))).toBe(true);
    expect(isRelevantNewsItem(mk("公園綠美化志工招募", "環境"))).toBe(false);
  });

  it("資安 hint 用資安關鍵字", () => {
    expect(isRelevantNewsItem(mk("駭客入侵上市公司 個資外洩百萬筆", "資安"))).toBe(true);
    expect(isRelevantNewsItem(mk("新款筆電開箱評測", "資安"))).toBe(false);
  });

  it("未列 TOPIC_RE 的 hint 照舊走警政漏斗（回歸保護）", () => {
    expect(isRelevantNewsItem(mk("高雄街頭砍人送醫", "治安"))).toBe(true);
    expect(isRelevantNewsItem(mk("新北市躋身全球幸福城市前50名", "治安"))).toBe(false);
    expect(isRelevantNewsItem(mk("台南工廠火警濃煙竄天 消防搶救", "災防"))).toBe(true);
  });
});

describe("mapBulkNews 新主題分類", () => {
  it("食安/環境/資安 item 入庫且歸到自己的分類", () => {
    const items = [
      { title: "台中查獲黑心食品工廠", link: "https://x/f1", description: "", source: "GN 食安黑心", sourceUrl: "u", hint: "食安", pubDate: "x" },
      { title: "高雄工廠偷排廢水遭稽查裁罰", link: "https://x/e1", description: "", source: "環境部官網", sourceUrl: "u", hint: "環境", pubDate: "x" },
      { title: "勒索病毒攻擊醫院系統 個資外洩", link: "https://x/c1", description: "", source: "TechNews", sourceUrl: "u", hint: "資安", pubDate: "x" },
    ];
    const ev = mapBulkNews(items, { fetchedAt: FETCHED_AT });
    expect(ev).toHaveLength(3);
    expect(ev.find((e) => e.title.includes("黑心"))!.category).toBe("食安");
    expect(ev.find((e) => e.title.includes("廢水"))!.category).toBe("環境");
    expect(ev.find((e) => e.title.includes("勒索病毒"))!.category).toBe("資安");
  });
});
```

注意：`勒索病毒攻擊醫院系統` 標題不可含 CAT_RULES 會攔截的詞（詐騙/車禍/火警等），上面選詞已避開。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/news-bulk.test.ts`
Expected: FAIL —— `isRelevantNewsItem` is not exported / category 斷言失敗。

- [ ] **Step 3: 實作 news-bulk.mjs**

3a. `HINT_TO_CAT`（line 42）改為：

```js
const HINT_TO_CAT = { 治安: "治安", 交通: "交通", 反詐: "反詐", 災防: "災防", 資安: "資安", 食安: "食安", 衛生: "衛生", 環境: "環境" };
```

3b. 在 `POLICE_RE` 定義之後、`isPoliceRelevant` 之前加：

```js
// 主題來源專用相關性關鍵字（hint 命中此表 → 以主題正則取代警政漏斗；未列者照舊走 POLICE_RE）。
// 來源漏斗診斷（docs/reports/2026-07-03）：食安/環保/衛生/科技來源過不了警政關鍵字，貢獻歸零。
const TOPIC_RE = {
  食安: /黑心|食安|餿水油|病死豬|瘦肉精|農藥殘留|逾期|竄改|標示不實|下架|回收|查獲|違規|走私|摻偽|偽藥|禁藥|食物中毒/,
  衛生: /疫情|群聚|確診|疫苗|傳染|染疫|食物中毒|中毒|院內感染|防疫|隔離/,
  環境: /污染|廢水|偷排|裁罰|稽查|廢棄物|棄置|排放|空污|盜採|濫墾|噪音|毒物|外洩/,
  資安: /資安|駭客|個資|外洩|漏洞|勒索|釣魚|盜刷|木馬|殭屍網路|網攻|入侵/,
};

// 單一相關性出口：fetch-live 預篩與 mapBulkNews 皆走此函式，確保漏斗一致。
export function isRelevantNewsItem(item) {
  const topicRe = TOPIC_RE[item?.hint];
  if (topicRe) return topicRe.test(String(item?.title || "") + " " + String(item?.description || ""));
  return isPoliceRelevant(item?.title, item?.description);
}
```

3c. `mapBulkNews` 內（約 line 90）：

```js
    if (!isRelevantNewsItem(it)) continue; // 濾掉與來源主題無關內容
```

（原為 `if (!isPoliceRelevant(it.title, it.description)) continue;`）

- [ ] **Step 4: 改 fetch-live.mjs 預篩呼叫點**

line 26 import 改為：

```js
import { mapBulkNews, titleKey as bulkTitleKey, isRelevantNewsItem } from "./lib/news-bulk.mjs";
```

line 270 改為：

```js
      const policeUniq = uniq.filter((it) => isRelevantNewsItem(it));
```

- [ ] **Step 5: 跑測試確認通過＋無回歸**

Run: `npx vitest run tests/news-bulk.test.ts` → Expected: PASS（含既有案例）
Run: `npm test` → Expected: 全綠。

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/news-bulk.mjs scripts/fetch-live.mjs tests/news-bulk.test.ts
git commit -m "feat(twnews): hint 分派主題漏斗＋食安/衛生/環境/資安分類映射"
```

---

### Task 2: EN 警政關鍵字＋EN 風險評級（news-bulk.mjs）

**Files:**
- Modify: `scripts/lib/news-bulk.mjs`（`HIGH`/`MED`/`riskFromTitle` 約 line 55-62、`isPoliceRelevant` 約 line 67）
- Test: `tests/news-bulk.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `isRelevantNewsItem`（EN 來源 hint 為 `治安`，會 fallback 到 `isPoliceRelevant`）。
- Produces: `isPoliceRelevant` 對英文警政內容回 true；`riskFromTitle`（內部函式）對英文標題給 high/medium。簽名皆不變。

- [ ] **Step 1: 寫失敗測試**

在 `tests/news-bulk.test.ts` 底部加：

```ts
describe("EN 來源支援（Focus Taiwan / Taipei Times）", () => {
  const mk = (title: string) => ({ title, hint: "治安", description: "", link: "https://x/en", source: "Focus Taiwan (EN)", sourceUrl: "u", pubDate: "x" });

  it("英文警政標題通過相關性漏斗", () => {
    expect(isRelevantNewsItem(mk("Police arrest fraud ring leader in Taipei"))).toBe(true);
    expect(isRelevantNewsItem(mk("Drug smuggling suspects detained at port"))).toBe(true);
    expect(isRelevantNewsItem(mk("Taiwan shares close higher on tech gains"))).toBe(false);
  });

  it("英文標題風險評級正確（不再全判 low）", () => {
    const ev = mapBulkNews(
      [
        { ...mk("Man killed in Kaohsiung shooting incident"), link: "https://x/en1" },
        { ...mk("Police arrest fraud suspects in Taichung"), link: "https://x/en2" },
      ],
      { fetchedAt: FETCHED_AT },
    );
    expect(ev.find((e) => e.title.includes("killed"))!.riskLevel).toBe("high");
    expect(ev.find((e) => e.title.includes("fraud"))!.riskLevel).toBe("medium");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/news-bulk.test.ts`
Expected: FAIL —— 英文標題被 `POLICE_RE` 全擋、風險全 low。

- [ ] **Step 3: 實作**

3a. `HIGH`/`MED` 之後加英文對應，並改 `riskFromTitle`：

```js
const HIGH_EN = /\b(murder|homicide|killed|dead|death|fatal|shooting|stabbing|explosion|kidnap\w*|rape|sexual assault|arson)\b/i;
const MED_EN = /\b(fraud|scam|drug|narcotic|arrest\w*|theft|robbery|burglar\w*|smuggl\w*|drunk driving|DUI|crash|fire|indict\w*|prosecut\w*|detain\w*|assault)\b/i;
function riskFromTitle(title) {
  const s = String(title || "");
  if (HIGH.test(s) || HIGH_EN.test(s)) return "high";
  if (MED.test(s) || MED_EN.test(s)) return "medium";
  return "low";
}
```

3b. `POLICE_RE` 之後加英文警政正則，並改 `isPoliceRelevant`：

```js
// 英文警政關鍵字（EN 來源靠此通過；POLICE_RE 為中文導向，對英文內容全 miss）。
const POLICE_EN_RE = /\b(police|arrest\w*|fraud|scam|drug|narcotic|smuggl\w*|murder|homicide|kidnap\w*|robbery|theft|burglar\w*|assault|prosecut\w*|indict\w*|convict\w*|sentenc\w*|detain\w*|custody|wanted|gang|trafficking|launder\w*|bribe\w*|corruption|counterfeit|hack\w*|ransomware|phishing|crash|collision|drunk driving|DUI|blaze|explosion|rescue|drown\w*|manhunt|shooting|stabbing|crime|criminal|missing)\b/i;

export function isPoliceRelevant(title, description) {
  const text = String(title || "") + " " + String(description || "");
  return POLICE_RE.test(text) || POLICE_EN_RE.test(text);
}
```

- [ ] **Step 4: 跑測試確認通過＋無回歸**

Run: `npx vitest run tests/news-bulk.test.ts` → PASS
Run: `npm test` → 全綠。

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/news-bulk.mjs tests/news-bulk.test.ts
git commit -m "feat(twnews): EN 警政關鍵字＋EN 風險評級（Focus Taiwan/Taipei Times 解鎖）"
```

---

### Task 3: Feed hint 改值（fetch-rss.mjs）

**Files:**
- Modify: `scripts/lib/fetch-rss.mjs`（line 104、128、170、171、172、173——行號以 label 為準）
- Test: `tests/tw-news-feeds.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `TOPIC_RE` 鍵名（食安/衛生/環境/資安）與 `HINT_TO_CAT`。
- Produces: `TW_NEWS_FEEDS` 中 6 個 feed 的 hint 新值（label 與 URL 不變）。

- [ ] **Step 1: 寫失敗測試**

在 `tests/tw-news-feeds.test.ts` 底部加（該檔已 import `TW_NEWS_FEEDS`，沿用；若無則加 `import { TW_NEWS_FEEDS } from "../scripts/lib/fetch-rss.mjs";`）：

```ts
describe("主題來源 hint（2026-07-04 漏斗診斷處置）", () => {
  const hintOf = (label: string) => TW_NEWS_FEEDS.find((f) => f.label === label)?.hint;
  it("食安/衛生/環境來源掛上主題 hint", () => {
    expect(hintOf("GN 食安黑心")).toBe("食安");
    expect(hintOf("農業部官網")).toBe("食安");
    expect(hintOf("食藥署官網")).toBe("食安");
    expect(hintOf("疾管署官網")).toBe("衛生");
    expect(hintOf("GN 環境污染偷排")).toBe("環境");
    expect(hintOf("環境部官網")).toBe("環境");
  });
  it("資安與 EN 來源 hint 不變", () => {
    expect(hintOf("TechNews 科技新報 RSS")).toBe("資安");
    expect(hintOf("Focus Taiwan (EN)")).toBe("治安");
    expect(hintOf("Taipei Times (EN)")).toBe("治安");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/tw-news-feeds.test.ts`
Expected: FAIL —— hint 仍為舊值（治安/災防）。

- [ ] **Step 3: 改 6 個 feed 的 hint**

`scripts/lib/fetch-rss.mjs` 逐行改（只動 `hint:` 值）：

```js
  { label: "GN 食安黑心", url: gq("黑心食品 OR 食安 OR 病死豬 OR 餿水油"), hint: "食安" },
  { label: "GN 環境污染偷排", url: gq("環境 污染 OR 廢水 OR 偷排"), hint: "環境" },
  { label: "疾管署官網", url: gq("site:cdc.gov.tw 疫情 OR 防疫 OR 群聚"), hint: "衛生" },
  { label: "農業部官網", url: gq("site:moa.gov.tw 走私 OR 防疫 OR 查獲"), hint: "食安" },
  { label: "食藥署官網", url: gq("site:fda.gov.tw 查獲 OR 違規 OR 回收"), hint: "食安" },
```

- [ ] **Step 4: 跑測試確認通過＋無回歸**

Run: `npx vitest run tests/tw-news-feeds.test.ts` → PASS
Run: `npm test` → 全綠。

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/fetch-rss.mjs tests/tw-news-feeds.test.ts
git commit -m "feat(twnews): 主題來源改掛食安/衛生/環境 hint（漏斗診斷處置）"
```

---

### Task 4: LLM 分類清單擴充（nvidia.mjs）

**Files:**
- Modify: `scripts/lib/nvidia.mjs:515`（`TW_CATEGORIES`，加 `export`）
- Test: `tests/llm-fields.test.ts`（若該檔 import nvidia.mjs 失敗成本高，改放 `tests/news-bulk.test.ts` 同款斷言亦可）

**Interfaces:**
- Consumes: 無（獨立常數）。
- Produces: `export const TW_CATEGORIES`（9 元素陣列）。`clampTwCat` 行為：新分類不再被打回「社會」。LLM prompt line 533 自動吃到新清單（`JSON.stringify(TW_CATEGORIES)`）。

- [ ] **Step 1: 寫失敗測試**

在 `tests/llm-fields.test.ts` 底部加：

```ts
import { TW_CATEGORIES } from "../scripts/lib/nvidia.mjs";

describe("TW_CATEGORIES 新主題分類", () => {
  it("含四個新分類（LLM 精修不再把新主題 clamp 回社會）", () => {
    for (const c of ["食安", "衛生", "環境", "資安"]) expect(TW_CATEGORIES).toContain(c);
    for (const c of ["治安", "社會", "交通", "災防", "反詐"]) expect(TW_CATEGORIES).toContain(c);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/llm-fields.test.ts`
Expected: FAIL —— `TW_CATEGORIES` 未 export。

- [ ] **Step 3: 實作**

`scripts/lib/nvidia.mjs:515` 改為：

```js
export const TW_CATEGORIES = ["治安", "社會", "交通", "災防", "反詐", "食安", "衛生", "環境", "資安"];
```

（line 516 `clampTwCat` 與 line 533 prompt 引用同一常數，自動生效，不需改。）

- [ ] **Step 4: 跑測試確認通過＋無回歸**

Run: `npx vitest run tests/llm-fields.test.ts` → PASS
Run: `npm test` → 全綠。

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/nvidia.mjs tests/llm-fields.test.ts
git commit -m "feat(llm): TW_CATEGORIES 擴充食安/衛生/環境/資安"
```

---

### Task 5: 前端分類篩選選項（FilterBar.ts）

**Files:**
- Modify: `src/components/FilterBar.ts:6-9`（`CATS.domestic`）
- Test: `tests/filter-bar.test.ts`（新建；模式仿 `tests/event-card.test.ts` 的 jsdom 用法）

**Interfaces:**
- Consumes: 無（靜態清單）。
- Produces: `CATS.domestic` 含 9 個分類；`renderFilterBar(container, "domestic")` 產出的 `#f-cat` select 含新選項。

- [ ] **Step 1: 寫失敗測試**

新建 `tests/filter-bar.test.ts`：

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderFilterBar } from "../src/components/FilterBar";

describe("FilterBar 國內分類選項", () => {
  it("含新主題分類 食安/衛生/環境/資安", () => {
    const el = document.createElement("div");
    renderFilterBar(el, "domestic");
    const options = [...el.querySelectorAll<HTMLOptionElement>("#f-cat option")].map((o) => o.value);
    for (const c of ["食安", "衛生", "環境", "資安", "治安", "反詐", "災防", "採購", "交通"]) {
      expect(options).toContain(c);
    }
  });
});
```

若 `renderFilterBar` 內部依賴 store 初始 state 拋錯，仿 `tests/event-card.test.ts` 開頭的 setup 方式補（讀該檔照抄其 store/DOM 前置）。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/filter-bar.test.ts`
Expected: FAIL —— options 缺 食安/衛生/環境/資安。

- [ ] **Step 3: 實作**

`src/components/FilterBar.ts:6-9` 改為：

```ts
const CATS: Record<Scope, string[]> = {
  domestic: ["治安", "反詐", "災防", "採購", "交通", "食安", "衛生", "環境", "資安"],
  international: ["地緣政治", "災害", "資安", "金融"],
};
```

- [ ] **Step 4: 跑測試確認通過＋無回歸＋build**

Run: `npx vitest run tests/filter-bar.test.ts` → PASS
Run: `npm test` → 全綠
Run: `npm run build` → 成功（tsc 無型別錯誤）。

- [ ] **Step 5: Commit**

```bash
git add src/components/FilterBar.ts tests/filter-bar.test.ts
git commit -m "feat(ui): 國內分類篩選加食安/衛生/環境/資安"
```

---

### Task 6: 端到端驗證（實跑 twnews 管線）

**Files:**
- 不改程式。產出驗證證據；跑完還原 `public/data/`（資料檔由 CI 產）。

**Interfaces:**
- Consumes: Task 1-5 全部成果；本地 `.env`（`LLM_API_KEY` 等已存在）。
- Produces: 驗證紀錄（來源貢獻報表輸出），貼進 commit message 或回報。

- [ ] **Step 1: 實跑 twnews 管線**

```bash
node --env-file=.env scripts/fetch-live.mjs --sources=twnews 2>&1 | tee /tmp/twnews-verify.log
```

Expected: 結尾印出來源貢獻報表；無 error。注意此步吃 LLM 成本（正常單輪量）。

- [ ] **Step 2: 檢查 9 個來源貢獻**

在 log 的來源貢獻報表中確認：`GN 食安黑心`、`GN 環境污染偷排`、`農業部官網`、`食藥署官網`、`環境部官網`、`疾管署官網`、`TechNews 科技新報 RSS`、`Focus Taiwan (EN)`、`Taipei Times (EN)` 的 finalEvents > 0（依當日新聞而定，至少多數 >0；若某源當日原始就 0 則屬正常，記錄即可）。

再確認新分類事件真的產出：

```bash
node -e "
const d = JSON.parse(require('fs').readFileSync('public/data/domestic.json','utf8'));
const cats = {};
for (const e of d) if (['食安','衛生','環境','資安'].includes(e.category)) cats[e.category]=(cats[e.category]||0)+1;
console.log(cats);
"
```

Expected: 至少 2 個新分類 count > 0。

- [ ] **Step 3: 還原本地產出的資料檔**

```bash
git checkout -- public/data/
git status --short
```

Expected: 工作區乾淨（資料由 CI 排程重抓，本地驗證產物不入 repo）。

- [ ] **Step 4: 全套最終驗證＋收尾 commit（若 README 需要）**

Run: `npm test` → 全綠；`npm run build` → 成功。

README 的資料管線表 `twnews` 行提及「警政關鍵字預篩」，補一句主題來源：

```markdown
| `twnews` | 台灣社會新聞 | 警政關鍵字預篩（食安/衛生/環境/資安來源走各自主題關鍵字）→ LLM 精修＋輕量收錄，保留窗 5 天 |
```

```bash
git add README.md
git commit -m "docs: README twnews 管線補主題分類漏斗說明"
```

- [ ] **Step 5: 回報驗證結果**

彙整：測試數、build 結果、貢獻報表關鍵行、新分類事件數。push 由使用者決定（CI 綁 main push 會觸發部署）。
