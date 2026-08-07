import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestGet } from "../functions/api/[[path]].js";

const env = {
  TWINKLE_MCP_URL: "https://mcp.test",
  TWINKLE_MCP_TOKEN: "test-token",
};

function context(path: string, query: string): Parameters<typeof onRequestGet>[0] {
  return {
    request: new Request(`https://dashboard.test/api/${path}?${query}`),
    params: { path },
    env,
  } as Parameters<typeof onRequestGet>[0];
}

function mockMcp() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      id?: number;
      method?: string;
      params?: { name?: string; arguments?: Record<string, unknown> };
    };
    const headers = { "content-type": "application/json", "mcp-session-id": "test-session" };
    if (body.method === "notifications/initialized") return new Response(null, { status: 202, headers });
    if (body.method === "tools/call") {
      const name = body.params?.name ?? "";
      calls.push({ name, args: body.params?.arguments ?? {} });
      const payload = name === "query_rows"
        ? {
            columns: [
              "網域", "網站性質", "民國年月", "聲請單位", "WEBURL", "WEBSITE_NM",
              "STA_SDATE", "STA_EDATE", "標題", "發佈時間", "發佈內容",
            ],
            rows: [[
              "scam.example", "假投資", "11501", "警政署", "scam.example", "示範網站",
              "1150101", "1151231", "GhostBlade 詐騙提醒", "2026-01-01", "示範內容",
            ]],
          }
        : name === "search_datasets"
          ? { count: 1, hits: [{ dataset_id: "176455", name: "示範資料集", agency: "警政署", primary_domain: "反詐" }] }
          : name === "search_judicial"
            ? { hits: [{ jid: "J-1", jtitle: "示範判決", court_code: "TPD", jdate: "2026-01-01", key_reasoning: "示範理由" }] }
            : { hits: [{ name_zh: "示範物質", name_en: "Example", controlled_class: "三" }] };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ text: JSON.stringify(payload) }] } }), { headers });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), { headers });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("Pages API routes", () => {
  it("四個查詢端點與資料集預覽都回傳 JSON 並使用 runtime token", async () => {
    const calls = mockMcp();
    const results = new Map<string, Record<string, unknown>>();
    for (const [path, query] of [
      ["fraud", "q=GhostBlade"],
      ["judicial", "q=%E8%A9%90%E9%A8%99"],
      ["drug", "q=%E5%AE%89%E9%9D%9E%E4%BB%96%E5%91%BD"],
      ["catalog", "q=%E8%AD%A6%E6%94%BF"],
      ["dataset", "id=176455"],
    ] as const) {
      const response = await onRequestGet(context(path, query));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      results.set(path, await response.json() as Record<string, unknown>);
    }

    expect(results.get("fraud")).toMatchObject({ query: "GhostBlade", matched: true });
    expect(results.get("fraud")?.hits).toHaveLength(3);
    expect(results.get("judicial")).toMatchObject({ query: "詐騙" });
    expect(results.get("judicial")?.cases).toHaveLength(1);
    expect(results.get("drug")).toMatchObject({ query: "安非他命", found: true });
    expect(results.get("drug")?.items).toHaveLength(1);
    expect(results.get("catalog")).toMatchObject({ query: "警政", count: 1 });
    expect(results.get("catalog")?.datasets).toHaveLength(1);
    expect(results.get("dataset")).toMatchObject({ id: "176455", rowCount: 1 });
    expect(calls.map((call) => call.name)).toEqual(expect.arrayContaining([
      "query_rows", "search_judicial", "search_drug", "search_datasets",
    ]));
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.every(([, init]) => ((init as RequestInit).headers as Record<string, string>).Authorization === "Bearer test-token")).toBe(true);
  });

  it("拒絕空查詢與未知端點，不呼叫上游", async () => {
    const calls = mockMcp();
    expect((await onRequestGet(context("fraud", "q="))).status).toBe(400);
    expect((await onRequestGet(context("other", "q=x"))).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("Twinkle 不可用時改查官方來源，四個查詢與預覽仍可使用", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === env.TWINKLE_MCP_URL) return new Response("unauthorized", { status: 401 });
      if (url.endsWith("/data/query-snapshot.json")) {
        return Response.json({
          generatedAt: "2026-08-07T00:00:00.000Z",
          fraud: [{
            title: "涉詐網站停解析：scam.example",
            summary: "刑事警察局申請停止解析，網站性質：假投資。",
            timestamp: "2026-08-07T00:00:00+08:00",
            source: { datasetId: "176455", name: "165 涉詐網站", recordRef: "scam.example" },
          }],
        });
      }
      if (url.endsWith("/FJUD/default.aspx") && init?.method === "POST") {
        return new Response('<iframe src="qryresultlst.aspx?ty=JUDBOOK&amp;q=test"></iframe>');
      }
      if (url.endsWith("/FJUD/default.aspx")) {
        return new Response([
          '<input name="__VIEWSTATE" value="v">',
          '<input name="__VIEWSTATEGENERATOR" value="g">',
          '<input name="__VIEWSTATEENCRYPTED" value="">',
          '<input name="__EVENTVALIDATION" value="e">',
        ].join(""));
      }
      if (url.includes("qryresultlst.aspx")) {
        return new Response('<tr><td>1.</td><td><a href="data.aspx?ty=JD&amp;id=TPDM%2C115%2C%E8%A8%B4%2C1%2C20260807%2C1">臺灣臺北地方法院 115 年度 訴 字第 1 號刑事判決</a>（4K）</td><td>115.08.07</td><td>詐欺等</td></tr><tr class="summary"><td><span class="tdCut">被告涉犯詐騙案件。</span></td></tr>');
      }
      if (url.includes("data.fda.gov.tw/data/opendata/export/50/json")) {
        return Response.json([{ 藥物名稱: "(甲基)安非他命(Meth)amphetamine", 俗名: "安非他命", 分級: "第二級毒品", 醫療用途: "", 濫用方式: "吸食" }]);
      }
      if (url.endsWith("/api/front/dataset/list")) {
        return Response.json({ payload: { search_count: 1, search_result: [{ nid: 123, title: "警政示範資料", agency_name: "警政署", category_name: "生活安全", updatefreq_desc: "每日", quality_badge_type: "金", all_file_format_name: ["JSON"] }] } });
      }
      if (url.includes("/api/front/dataset/detail?nid=123")) {
        return Response.json({ payload: { resources: [{ file_format: "JSON", url: "https://official.test/data.json" }] } });
      }
      if (url === "https://official.test/data.json") return Response.json({ data: [{ 名稱: "示範", 數值: 1 }] });
      throw new Error(`unexpected fetch ${url}`);
    }));

    const queries = [
      ["fraud", "q=scam.example"],
      ["judicial", "q=%E8%A9%90%E9%A8%99"],
      ["drug", "q=%E5%AE%89%E9%9D%9E%E4%BB%96%E5%91%BD"],
      ["catalog", "q=%E8%AD%A6%E6%94%BF"],
      ["dataset", "id=123"],
    ] as const;
    const bodies = [];
    for (const [path, query] of queries) {
      const response = await onRequestGet(context(path, query));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      bodies.push(await response.json() as Record<string, unknown>);
    }
    expect(bodies[0]).toMatchObject({ matched: true, source: "警政署 165 官方資料快照" });
    expect(bodies[1]).toMatchObject({ source: "司法院裁判書查詢" });
    expect(bodies[1].cases).toHaveLength(1);
    expect(bodies[2]).toMatchObject({ found: true, source: "衛福部食藥署資料集 50" });
    expect(bodies[3]).toMatchObject({ count: 1, source: "政府資料開放平臺" });
    expect(bodies[4]).toMatchObject({ id: "123", rowCount: 1 });
  });
});
