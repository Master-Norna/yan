// MCP 的服务端知道清单变了，不等于页面拿到了变后的那一份：内部重拉只算自己知道，标记留到页面来取（见 server/mcp/index.js）；
// 补图要用实际起连接的那一份配置——游目只递几项选择，command / cwd 是 prepare 展开后挂进 client.config 的
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { McpClient } = require("../../server/mcp/client.js");
const createMcp = require("../../server/mcp/index.js");
const original = {
  connect: McpClient.prototype.connect,
  listTools: McpClient.prototype.listTools,
  call: McpClient.prototype.call
};
const restore = () => Object.assign(McpClient.prototype, original);

async function serve(prepare = config => config) {
  const pool = createMcp({ version: "test", toolEnv: env => env, prepare });
  const server = http
    .createServer((req, res) => {
      const route = pool.routes[`POST ${req.url}`];
      if (route) return route(req, res);
      res.statusCode = 404;
      res.end();
    })
    .listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: "POST", body: JSON.stringify(body) }).then(async r => ({
      status: r.status,
      ...(await r.json())
    }));
  return { post, close: () => new Promise(resolve => server.close(resolve)) };
}

test("客户端：调用时内部重拉不清标记——页面拿到新表才算交接完", async () => {
  const client = new McpClient({ name: "x", config: {}, version: "t", toolEnv: env => env });
  client.transport = { send: async () => {} };
  client.request = async method => (method === "tools/list" ? { tools: [{ name: "new_tool" }] } : { content: [] });
  client.tools = [{ name: "old_tool" }];
  client.toolsChanged = true;
  await client.call("some_tool", {});
  assert.deepEqual(
    client.tools.map(tool => tool.name),
    ["new_tool"],
    "调用前先内部重拉"
  );
  assert.equal(client.toolsChanged, true, "标记留着：页面还没拿到");
  client.tools = await client.listTools();
  client.toolsChanged = false;
  assert.deepEqual(
    client.tools.map(tool => tool.name),
    ["new_tool"]
  );
});

test("调用期间收到 list_changed：下一问 /api/mcp/list 交回新表，之后不再反复问上游", async () => {
  McpClient.prototype.connect = async function () {
    globalThis.__mcpTestClient = this;
    this.tools = [{ name: "old_tool" }];
    this.toolsChanged = false;
    this.server = {};
    this.instructions = "";
    this.listCount = 0;
    return this;
  };
  McpClient.prototype.listTools = async function () {
    this.listCount += 1;
    return [{ name: "new_tool" }];
  };
  // 这次调用期间服务发了 notifications/tools/list_changed
  McpClient.prototype.call = async function () {
    this.toolsChanged = true;
    return { content: [{ type: "text", text: "ok" }] };
  };
  const { post, close } = await serve();
  const servers = { fake: { command: "node" } };
  try {
    const first = await post("/api/mcp/list", { servers });
    assert.deepEqual(
      first.servers.fake.tools.map(tool => tool.name),
      ["old_tool"]
    );
    const called = await post("/api/mcp/call", { server: "fake", config: servers.fake, tool: "some_tool", arguments: {} });
    assert.equal(called.toolsChanged, true, "页面据此使缓存失效");
    const again = await post("/api/mcp/list", { servers });
    assert.deepEqual(
      again.servers.fake.tools.map(tool => tool.name),
      ["new_tool"],
      "重拉拿到的是新表"
    );
    const client = poolClient();
    const rounds = client.listCount;
    const third = await post("/api/mcp/list", { servers });
    assert.deepEqual(
      third.servers.fake.tools.map(tool => tool.name),
      ["new_tool"]
    );
    assert.equal(client.listCount, rounds, "已经交接过，不必再问上游");
  } finally {
    await close();
    restore();
  }
});

// 取这次的客户端实例（ensure 缓存在池里，原型上记着最后一回连上的那个）
function poolClient() {
  return globalThis.__mcpTestClient;
}

test("内置游目那样只递几项选择：补图用实际起连接的配置", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yan-mcp-shot-"));
  fs.writeFileSync(path.join(dir, "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
  McpClient.prototype.connect = async function () {
    globalThis.__mcpTestClient = this;
    this.tools = [{ name: "browser_take_screenshot" }];
    this.toolsChanged = false;
    this.server = {};
    return this;
  };
  McpClient.prototype.call = async function () {
    return { content: [{ type: "text", text: "- [Screenshot](./shot.png)" }] };
  };
  const prepare = config => (config.stage ? { ...config, command: "node", cwd: dir } : config);
  const { post, close } = await serve(prepare);
  try {
    const body = {
      server: "游目",
      config: { stage: { note: "游目" } },
      tool: "browser_take_screenshot",
      arguments: { filename: "shot.png" }
    };
    const builtin = await post("/api/mcp/call", body);
    assert.equal(builtin.result.content.filter(item => item.type === "image").length, 1, "内置游目的命名截图补成了图片结果");
    const full = await post("/api/mcp/call", { ...body, server: "完整", config: { command: "node", cwd: dir } });
    assert.equal(full.result.content.filter(item => item.type === "image").length, 1);
  } finally {
    await close();
    restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
