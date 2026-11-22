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
    const called = await post("/api/mcp/call", { server: "fake", config: servers.fake, tool: "old_tool", arguments: {} });
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
    await post("/api/mcp/list", {
      servers: {
        游目: body.config,
        完整: { command: "node", cwd: dir }
      }
    });
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

test("补图只读工作目录与显式 output-dir，忽略越界和链接逃逸", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "yan-mcp-images-")),
    work = path.join(base, "work"),
    output = path.join(base, "output"),
    secret = path.join(base, "outside.png");
  fs.mkdirSync(work);
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(work, "ok.png"), "work");
  fs.writeFileSync(path.join(output, "out.png"), "output");
  fs.writeFileSync(secret, "private");
  let linked = false;
  try {
    fs.symlinkSync(secret, path.join(work, "link.png"));
    linked = true;
  } catch {}
  McpClient.prototype.connect = async function () {
    this.tools = [{ name: "take" }];
    this.toolsChanged = false;
    this.server = {};
    return this;
  };
  McpClient.prototype.call = async function () {
    return {
      content: [
        {
          type: "text",
          text:
            "- [Okay](./ok.png)\n- [Output](" +
            path.join(output, "out.png").replaceAll("\\", "/") +
            ")\n- [Secret](../outside.png)" +
            (linked ? "\n- [Symlink](./link.png)" : "")
        }
      ]
    };
  };
  const { post, close } = await serve();
  try {
    await post("/api/mcp/list", {
      servers: { images: { command: "node", cwd: work, args: ["--output-dir", output] } }
    });
    const result = await post("/api/mcp/call", {
      server: "images",
      config: { command: "node", cwd: work, args: ["--output-dir", output] },
      tool: "take",
      arguments: {}
    });
    const images = result.result.content.filter(item => item.type === "image");
    assert.deepEqual(
      images.map(item => Buffer.from(item.data, "base64").toString()),
      ["work", "output"]
    );
  } finally {
    await close();
    restore();
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("工具清单：服务重复返回分页游标时停止，而非无限请求", async () => {
  const client = new McpClient({ name: "x", config: {}, version: "t", toolEnv: env => env });
  const cursors = [];
  client.request = async (_method, params) => {
    cursors.push(params.cursor || "");
    return { tools: [{ name: "tool" }], nextCursor: "repeat" };
  };
  await assert.rejects(() => client.listTools(), /分页游标重复/);
  assert.deepEqual(cursors, ["", "repeat"]);
});

test("调用只接受已登记服务、当前配置和工具清单，移除服务后不能继续调用", async () => {
  const called = [];
  McpClient.prototype.connect = async function () {
    this.tools = [{ name: "read" }];
    this.server = {};
    this.instructions = "";
    return this;
  };
  McpClient.prototype.call = async function (tool) {
    called.push(tool);
    return { content: [{ type: "text", text: "ok" }] };
  };
  const { post, close } = await serve();
  const config = { command: "node" };
  const call = (server, tool = "read", passed = config) => post("/api/mcp/call", { server, config: passed, tool, arguments: {} });
  try {
    assert.equal((await call("fake")).status, 400, "未登记的服务不能临时起 MCP 进程");
    assert.equal((await post("/api/mcp/list", { servers: { fake: config } })).status, 200);
    assert.equal((await call("fake", "read", { command: "other" })).status, 400, "不可替换已登记的连接配置");
    const removed = await call("fake", "write");
    assert.equal(removed.status, 409, "不可调用没有出现在清单中的工具");
    assert.equal(removed.toolsChanged, true, "通知页面下一问刷新工具清单");
    assert.equal((await call("fake")).status, 200, "清单里的工具仍正常工作");
    assert.deepEqual(called, ["read"], "拒绝的调用不应进入 MCP 客户端");
    assert.equal((await post("/api/mcp/list", { servers: {} })).status, 200);
    assert.equal((await call("fake")).status, 400, "已移除的服务不能继续调用");
  } finally {
    await close();
    restore();
  }
});

test("已登记的 MCP 断线后仍可重连；清单失效的拒绝会提醒页面刷新", async () => {
  let connects = 0;
  McpClient.prototype.connect = async function () {
    globalThis.__mcpTestClient = this;
    connects++;
    this.closed = false;
    this.tools = [{ name: connects === 1 ? "old_tool" : "new_tool" }];
    this.server = {};
    this.instructions = "";
    return this;
  };
  McpClient.prototype.call = async function () {
    return { content: [{ type: "text", text: "ok" }] };
  };
  const { post, close } = await serve();
  const config = { command: "node" };
  try {
    await post("/api/mcp/list", { servers: { fake: config } });
    assert.equal((await post("/api/mcp/call", { server: "fake", config, tool: "old_tool" })).status, 200);
    const old = poolClient();
    old.closed = true;
    const invalid = await post("/api/mcp/call", { server: "fake", config, tool: "old_tool" });
    assert.equal(connects, 2, "断线后按原登记配置重连");
    assert.equal(invalid.status, 409, "旧工具不能在新连接上调用");
    assert.equal(invalid.toolsChanged, true, "页面需重新载入工具清单");
    assert.equal((await post("/api/mcp/call", { server: "fake", config, tool: "new_tool" })).status, 200);
  } finally {
    await close();
    restore();
  }
});
