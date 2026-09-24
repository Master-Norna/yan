// 假的 MCP 服务：默认走 stdio（逐行一条 JSON），--http 端口 则走可流式 HTTP（tools/call 的回复放在事件流里），--sse 端口 走旧式 HTTP+SSE。
// 工具：echo（只读）、write_note（会写）；--many 再添四十件说明很长的，好让页面按需给。握手时带一句用法 FAKE-MCP-HINT
import http from "node:http";
import readline from "node:readline";

const many = process.argv.includes("--many");
const tools = [
  {
    name: "echo",
    title: "Echo",
    description: "原样回声。",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    annotations: { readOnlyHint: true }
  },
  {
    name: "write_note",
    description: "记一句话（会写）。",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    annotations: { readOnlyHint: false }
  },
  ...(many
    ? Array.from({ length: 40 }, (_, i) => ({
        name: `tool_${String(i).padStart(2, "0")}`,
        description: `第 ${i} 件工具。${"这件工具的说明很长。".repeat(30)}`,
        inputSchema: { type: "object", properties: { n: { type: "number", description: "一个数" } }, required: ["n"] },
        annotations: { readOnlyHint: true }
      }))
    : [])
];
function handle(message) {
  const { id, method, params } = message;
  if (id === undefined) return null; // 通知不回
  const reply = result => ({ jsonrpc: "2.0", id, result });
  if (method === "initialize")
    return reply({
      protocolVersion: params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "fake", title: "假服务", version: "0.1.0" },
      instructions: "FAKE-MCP-HINT"
    });
  if (method === "tools/list") {
    // 分两页给：页面得顺着 nextCursor 拉全
    const half = Math.ceil(tools.length / 2);
    return params?.cursor ? reply({ tools: tools.slice(half) }) : reply({ tools: tools.slice(0, half), nextCursor: "p2" });
  }
  if (method === "tools/call") {
    const { name, arguments: args } = params;
    if (name === "echo") return reply({ content: [{ type: "text", text: `回声：${args.text}` }] });
    if (name === "write_note") return reply({ content: [{ type: "text", text: `已记：${args.text}` }] });
    if (name.startsWith("tool_")) return reply({ content: [], structuredContent: { tool: name, n: args.n } });
    return reply({ content: [{ type: "text", text: `没有 ${name}` }], isError: true });
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `unknown ${method}` } };
}

const httpAt = process.argv.indexOf("--http"),
  sseAt = process.argv.indexOf("--sse");
if (sseAt >= 0) {
  // 旧式 HTTP+SSE：GET /sse 开一条事件流，先报投递地址，回复都从这条流里回；往 /sse 直接 POST（新式的握手）一律 405
  let stream = null;
  http
    .createServer((req, res) => {
      if (req.method === "GET" && req.url === "/sse") {
        stream = res;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        return res.write("event: endpoint\ndata: /messages?session=1\n\n");
      }
      if (req.method === "POST" && req.url.startsWith("/messages")) {
        let body = "";
        req.on("data", chunk => (body += chunk));
        return req.on("end", () => {
          const out = handle(JSON.parse(body));
          res.writeHead(202).end();
          if (out) stream.write(`event: message\ndata: ${JSON.stringify(out)}\n\n`);
        });
      }
      res.writeHead(405).end();
    })
    .listen(Number(process.argv[sseAt + 1]), "127.0.0.1");
} else if (httpAt < 0) {
  const lines = readline.createInterface({ input: process.stdin });
  lines.on("line", line => {
    const out = handle(JSON.parse(line));
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  });
} else {
  http
    .createServer((req, res) => {
      if (req.method !== "POST") return res.writeHead(405).end();
      let body = "";
      req.on("data", chunk => (body += chunk));
      req.on("end", () => {
        const message = JSON.parse(body),
          out = handle(message);
        if (!out) return res.writeHead(202).end();
        const headers = message.method === "initialize" ? { "Mcp-Session-Id": "s1" } : {};
        if (message.method === "tools/call") {
          res.writeHead(200, { ...headers, "Content-Type": "text/event-stream" });
          res.write(`event: message\ndata: ${JSON.stringify(out)}\n\n`);
          return res.end();
        }
        res.writeHead(200, { ...headers, "Content-Type": "application/json" });
        res.end(JSON.stringify(out));
      });
    })
    .listen(Number(process.argv[httpAt + 1]), "127.0.0.1");
}
