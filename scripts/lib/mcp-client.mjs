// 最小可用的 MCP over Streamable-HTTP client（JSON-RPC）。
// 只實作 pipeline 需要的：initialize → notifications/initialized → tools/call。
// twinkle-hub 回 text/event-stream，需解析 SSE 取 data。

function parseBody(contentType, text) {
  if (contentType.includes("text/event-stream")) {
    const dataLines = text.split("\n").filter((l) => l.startsWith("data:"));
    if (!dataLines.length) return text;
    return JSON.parse(dataLines[dataLines.length - 1].slice(5).trim());
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class McpClient {
  constructor(url, token) {
    this.url = url;
    this.token = token;
    this.sessionId = null;
    this.nextId = 1;
  }

  headers() {
    const h = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.token}`,
    };
    if (this.sessionId) h["Mcp-Session-Id"] = this.sessionId;
    return h;
  }

  async send(method, params, isNotification = false) {
    const payload = { jsonrpc: "2.0", method, params };
    if (!isNotification) payload.id = this.nextId++;

    // 429 / 5xx 退避重試（twinkle-hub 限流時）
    let res;
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await fetch(this.url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
      });
      if (res.status !== 429 && res.status < 500) break;
      if (attempt < 3) {
        const waitMs = 1500 * Math.pow(2, attempt); // 1.5s, 3s, 6s
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (isNotification) return null;
    const text = await res.text();
    const body = parseBody(res.headers.get("content-type") || "", text);
    if (!res.ok) throw new Error(`MCP ${method} HTTP ${res.status}: ${text.slice(0, 200)}`);
    if (body && body.error) throw new Error(`MCP ${method} error: ${JSON.stringify(body.error).slice(0, 200)}`);
    return body;
  }

  async init() {
    await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "taiwan-intel-dashboard-pipeline", version: "1.0.0" },
    });
    await this.send("notifications/initialized", {}, true);
  }

  // 呼叫 tool，回傳合併後的純文字內容（content[].text）
  async callTool(name, args) {
    const body = await this.send("tools/call", { name, arguments: args });
    const content = body?.result?.content;
    if (!Array.isArray(content)) throw new Error(`MCP tool ${name} 無 content: ${JSON.stringify(body).slice(0, 200)}`);
    return content.map((c) => c.text || "").join("\n");
  }
}
