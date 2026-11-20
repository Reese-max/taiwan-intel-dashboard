import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { mapBulkInternationalNews } from "../scripts/lib/news-bulk.mjs";

// expected：判對的答案；notExpected：審查判錯的答案（其他答案都算對）。
type BenchCase = { sample: string; n: number | string; title: string; summary: string; expected?: string[]; notExpected?: string[]; geminiError?: boolean };
const bench: { cases: BenchCase[] } = JSON.parse(
  readFileSync(new URL("./fixtures/intl-location-benchmark.json", import.meta.url), "utf8"),
);

// 國際國家地點的品質基準（issue #43）：Gemini 逐筆判讀過的正式站新聞（含 Codex 協調者的審查樣本）。
// 改地點規則時這個分數只能持平或變好；分數變好時把下限往上調。
const MIN_CORRECT = 499;

function scoreBenchmark() {
  const misses: string[] = [];
  let correct = 0;
  for (const c of bench.cases) {
    const [event] = mapBulkInternationalNews([
      { title: c.title, description: c.summary, link: `https://bench.example/${c.sample}/${c.n}`, source: "bench" },
    ]);
    const region = event?.lat != null ? event.region : "";
    const ok = c.expected ? c.expected.includes(region) : !c.notExpected!.includes(region);
    if (ok) correct++;
    else {
      const want = c.expected ? `應為「${c.expected.map((x) => x || "無地點").join("／")}」` : `不應為「${c.notExpected!.map((x) => x || "無地點").join("／")}」`;
      misses.push(`${c.sample}#${c.n} 得到「${region || "無地點"}」${want}｜${c.title.slice(0, 60)}`);
    }
  }
  return { correct, total: bench.cases.length, misses };
}

describe("國際國家地點基準", () => {
  it(`至少 ${MIN_CORRECT} 筆判對`, () => {
    const { correct, total, misses } = scoreBenchmark();
    if (correct < MIN_CORRECT) console.log(misses.join("\n"));
    expect(total).toBe(511);
    expect(correct).toBeGreaterThanOrEqual(MIN_CORRECT);
  });
});
