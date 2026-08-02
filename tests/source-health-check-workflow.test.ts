import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workflowPath = join(process.cwd(), ".github/workflows/source-health-check.yml");
const allowedActions = new Set([
  "actions/checkout@v4",
  "actions/setup-node@v4",
  "actions/upload-artifact@v4",
]);
const readOnlyScripts = [
  "scripts/audit-source-health.mjs",
  "scripts/lib/source-health.mjs",
  "scripts/audit-source-freshness.mjs",
];

function violations(content: string) {
  const problems: string[] = [];
  if (!/^permissions:\r?\n  contents: read$/m.test(content)) problems.push("缺少全域唯讀權限");
  if (!/^    permissions:\r?\n      contents: read$/m.test(content)) problems.push("缺少工作唯讀權限");
  if (!content.includes("ref: pipeline-state") || !content.includes("path: state")) problems.push("未從唯讀狀態快照稽核");
  if (content.includes("workflow_call") || content.includes("uses: ./.github/workflows/")) problems.push("不得呼叫可寫入的共用 workflow");
  if (content.includes("secrets.")) problems.push("純檢查不得取得 secrets");

  const actions = [...content.matchAll(/^\s+uses:\s*([^\s#]+)\s*$/gm)].map((match) => match[1]);
  if (actions.some((action) => !allowedActions.has(action))) problems.push("含未允許的 Action");

  const forbidden = /\b(?:git\s+push|npm\s+run|node\s+scripts\/(?!audit-source-(?:health|freshness)\.mjs\b)|curl\b|wget\b|gh\s+workflow|peaceiris\/actions-gh-pages|cloudflare\/wrangler-action|pages\s+deploy)\b/i;
  if (forbidden.test(content)) problems.push("含資料寫入或部署命令");
  if (!content.includes("git diff --exit-code") || !content.includes("find public/data -type f -print -quit")) {
    problems.push("缺少執行期資料寫入防護");
  }
  if (!content.includes("find dist -type f -print -quit")) problems.push("缺少執行期網站輸出防護");
  if (!content.includes("actions/upload-artifact@v4") || !content.includes("source-health-reports")) {
    problems.push("缺少報告 artifact");
  }
  return problems;
}

describe("source-health-check.yml（純檢查資料來源健康度 workflow）", () => {
  it("只讀取狀態快照，僅執行健康度測試與稽核", () => {
    const content = readFileSync(workflowPath, "utf8");
    expect(violations(content)).toEqual([]);
    expect(content).toContain("tests/source-health.test.ts tests/source-freshness.test.ts tests/source-health-check-workflow.test.ts");
    expect(content).toContain("--file=state/data/provenance.json");
    expect(content).toContain("--json --provenance=state/data/provenance.json --domain-coverage=state/data/domain-coverage.json > \"$report_dir/source-health-report.json\"");
    expect(content).toContain("--report=\"$report_dir/source-health-report.json\"");
    expect(content).toContain("--provenance=state/data/provenance.json --domain-coverage=state/data/domain-coverage.json");
  });

  it("偵測新增的資料寫入、部署或共用抓取 workflow", () => {
    const content = readFileSync(workflowPath, "utf8");
    for (const mutation of [
      "\n      - run: npm run refresh",
      "\n      - run: node scripts/fetch-live.mjs",
      "\n      - run: git push origin pipeline-state",
      "\n      - uses: cloudflare/wrangler-action@v3",
      "\n    uses: ./.github/workflows/pipeline-fetch.yml",
    ]) {
      expect(violations(`${content}${mutation}`)).not.toEqual([]);
    }
  });

  it("稽核程式本身不含檔案寫入或外部執行 API", () => {
    const mutatingApi = /\b(?:writeFile|appendFile|mkdir|rm|unlink|rename|copyFile|chmod|exec|spawn)\w*\s*\(|\bfetch\s*\(/;
    for (const file of readOnlyScripts) {
      expect(readFileSync(join(process.cwd(), file), "utf8")).not.toMatch(mutatingApi);
    }
  });
});
