import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// @ts-expect-error — JS ESM module without types
import { mapBulkInternationalNews } from "../scripts/lib/news-bulk.mjs";

type BenchCase = { sample: string; n: number; title: string; summary: string; expected: string[]; geminiError?: boolean };
const bench: { cases: BenchCase[] } = JSON.parse(
  readFileSync(new URL("./fixtures/intl-location-benchmark.json", import.meta.url), "utf8"),
);

// 國際國家地點的品質基準（issue #43）：Gemini 逐筆判讀過的正式站新聞。
// 改地點規則時這個分數只能持平或變好；分數變好時把下限往上調。
const MIN_CORRECT = 240;

function scoreBenchmark() {
  const misses: string[] = [];
  let correct = 0;
  for (const c of bench.cases) {
    const [event] = mapBulkInternationalNews([
      { title: c.title, description: c.summary, link: `https://bench.example/${c.sample}/${c.n}`, source: "bench" },
    ]);
    const region = event?.lat != null ? event.region : "";
    if (c.expected.includes(region)) correct++;
    else misses.push(`${c.sample}#${c.n} 得到「${region || "無地點"}」應為「${c.expected.map((x) => x || "無地點").join("／")}」｜${c.title.slice(0, 60)}`);
  }
  return { correct, total: bench.cases.length, misses };
}

describe("國際國家地點基準", () => {
  it(`至少 ${MIN_CORRECT} 筆判對`, () => {
    const { correct, total, misses } = scoreBenchmark();
    if (correct < MIN_CORRECT) console.log(misses.join("\n"));
    expect(total).toBe(249);
    expect(correct).toBeGreaterThanOrEqual(MIN_CORRECT);
  });
});
