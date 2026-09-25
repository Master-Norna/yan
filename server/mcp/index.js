// 言 · MCP 服务池：按设置里的配置起、连各个 MCP 服务，接口只有两个——
//   POST /api/mcp/list  { servers: { 名字: 配置 }, restart?: [名字] }  → 各服务的工具、说明，或连不上的原因
//   POST /api/mcp/call  { server, config, tool, arguments, timeout? }   → 那件工具的结果
// 配置照通行的 mcpServers 写法：本机进程给 command / args / cwd / env，远端给 url / headers（旧式 SSE 另写 type: "sse"）。
// 连接按名字复用，连接相关的几项变了就重连；进程随桥接退出一并结束
"use strict";
const { sendJson, readJson, jsonRoute, errorText } = require("../http.js");
const { McpClient } = require("./client.js");

const CONNECTION_KEYS = ["command", "args", "cwd", "env", "url", "headers", "type", "transport"];

module.exports = function createMcp({ version, toolEnv }) {
  /** @type {Map<string, { key: string, client: McpClient, ready: Promise<McpClient> }>} */
  const clients = new Map();
  const keyOf = config => JSON.stringify(CONNECTION_KEYS.map(key => config[key]));

  function ensure(name, config) {
    const key = keyOf(config);
    let entry = clients.get(name);
    if (entry && (entry.key !== key || entry.client.closed)) {
      entry.client.close();
      entry = null;
    }
    if (!entry) {
      const client = new McpClient({ name, config, version, toolEnv });
      entry = { key, client, ready: client.connect() };
      // 连不上的收掉，下次用到时重来
      entry.ready.catch(() => client.close());
      clients.set(name, entry);
    }
    return entry;
  }
  function drop(name) {
    clients.get(name)?.client.close();
    clients.delete(name);
  }

  const handleList = jsonRoute(
    async ({ servers = {}, restart = [] }) => {
      for (const name of [...clients.keys()]) if (!servers[name] || restart.includes(name)) drop(name);
      const names = Object.keys(servers);
      const settled = await Promise.allSettled(names.map(name => ensure(name, servers[name]).ready));
      const out = {};
      settled.forEach((result, i) => {
        const name = names[i];
        if (result.status === "rejected") return (out[name] = { ok: false, error: String(result.reason?.message || result.reason) });
        const client = result.value;
        out[name] = {
          ok: true,
          server: client.server,
          instructions: client.instructions,
          tools: client.tools.map(({ name, title, description, inputSchema, annotations }) => ({
            name,
            title,
            description,
            inputSchema,
            annotations
          }))
        };
      });
      return { servers: out };
    },
    error => errorText(error, Infinity)
  );

  async function handleCall(req, res) {
    const abort = new AbortController();
    // 页面那头停了（用户按了停止）：连接一断，就告诉服务端取消这次调用
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });
    try {
      const body = await readJson(req);
      const client = await ensure(body.server, body.config).ready;
      const result = await client.call(body.tool, body.arguments || {}, {
        timeout: Number(body.timeout) > 0 ? Number(body.timeout) * 1000 : undefined,
        signal: abort.signal
      });
      sendJson(res, 200, { result, toolsChanged: client.toolsChanged });
    } catch (error) {
      if (!res.destroyed) sendJson(res, 400, { error: String(error.message || error) });
    }
  }

  process.on("exit", () => {
    for (const { client } of clients.values()) client.close();
  });

  return { routes: { "POST /api/mcp/list": handleList, "POST /api/mcp/call": handleCall } };
};
