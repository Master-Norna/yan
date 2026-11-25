// 可流式 HTTP 的 MCP：回复走事件流时，close() 要掐得到还在读的流；流半路断了，等回复的那一问当场落空，不干等到超时
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Readable } from "node:stream";

const require = createRequire(import.meta.url);
const { createTransport, readEvents } = require("../../server/mcp/transports.js");
const { McpClient } = require("../../server/mcp/client.js");
const createMcp = require("../../server/mcp/index.js");
const { OUTBOUND_MARK } = require("../../server/web.js");

// 一个回事件流的假服务：流先不结束，由测试决定何时出错或收尾
function fakeStream(signal) {
  let controller;
  const body = new ReadableStream({ start: c => (controller = c) });
  const response = new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  const abort = () => fail(signal.reason);
  const fail = error => {
    signal?.removeEventListener("abort", abort);
    controller.error(error);
  };
  signal?.addEventListener("abort", abort, { once: true });
  return {
    response,
    write: text => controller.enqueue(Buffer.from(text)),
    end() {
      signal?.removeEventListener("abort", abort);
      controller.close();
    },
    fail
  };
}
function legacyStream(signal) {
  const stream = fakeStream(signal);
  stream.write("event: endpoint\ndata: /messages\n\n");
  return stream;
}
const waitForAbort = signal => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
const tick = () => new Promise(resolve => setImmediate(resolve));

test("close() 掐断仍在读的事件流", async t => {
  const signals = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    signals.push(init.signal);
    return fakeStream().response;
  });
  const transport = createTransport({ url: "http://127.0.0.1:1/mcp" });
  await transport.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} });
  assert.equal(signals[0].aborted, false);
  transport.close();
  assert.equal(signals[0].aborted, true);
});

test("事件流半路断了：等这条回复的那一问收到错误", async t => {
  const stream = fakeStream();
  t.mock.method(globalThis, "fetch", async () => stream.response);
  const transport = createTransport({ url: "http://127.0.0.1:1/mcp" });
  const got = [];
  transport.onmessage = message => got.push(message);
  await transport.send({ jsonrpc: "2.0", id: 7, method: "tools/call", params: {} });
  stream.fail(Error("连接被重置"));
  await tick();
  await tick();
  assert.equal(got.length, 1);
  assert.equal(got[0].id, 7);
  assert.match(got[0].error.message, /事件流中断/);
});

test("事件流读取：\\r\\n 被切在两块之间，事件不被拦腰切开、不丢事件名", async () => {
  const read = async chunks => {
    const got = [];
    await readEvents({ body: chunks.map(text => Buffer.from(text)) }, (event, data) => got.push([event, data]));
    return got;
  };
  assert.deepEqual(await read(["event: message\r\ndata: a\r", "\ndata: b\r\n\r\n"]), [["message", "a\nb"]]);
  assert.deepEqual(await read(["event: endpoint\r", "\ndata: /messages?s=1\r\n\r\n"]), [["endpoint", "/messages?s=1"]]);
  assert.deepEqual(await read(["data: a\r\n\r", "\ndata: b\r\n\r\n"]), [
    ["message", "a"],
    ["message", "b"]
  ]);
  // 只用 \r 换行的：流收尾时留着的那个 \r 也要算数
  assert.deepEqual(await read(["data: a\r\r"]), [["message", "a"]]);
  assert.deepEqual(await read(["data: a\n\n", "data: b\n\n"]), [
    ["message", "a"],
    ["message", "b"]
  ]);
});

test("自己 close() 掐的流不当作出错", async t => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const stream = fakeStream();
    init.signal.addEventListener("abort", () => stream.fail(Error("aborted")));
    return stream.response;
  });
  const transport = createTransport({ url: "http://127.0.0.1:1/mcp" });
  const got = [];
  transport.onmessage = message => got.push(message);
  await transport.send({ jsonrpc: "2.0", id: 9, method: "tools/call", params: {} });
  transport.close();
  await tick();
  await tick();
  assert.deepEqual(got, []);
});

test("等回复的那一问超时了：传输把还在读的正文一并收掉，不挂着连接", async t => {
  const signals = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    signals.push(init.signal);
    return fakeStream().response;
  });
  const transport = createTransport({ url: "http://127.0.0.1:1/mcp" });
  // 只测客户端与传输的交接：连接照常待着，这一条请求 20 毫秒就超时
  const client = new McpClient({ name: "test", config: {}, version: "0", toolEnv: env => env });
  client.transport = transport;
  await assert.rejects(() => client.request("tools/call", {}, 20), /超时/);
  assert.equal(signals.length, 2);
  assert.equal(signals[0].aborted, true, "超时之后要掐掉还在读的正文");
  transport.close();
});

test("出站请求都带标记：MCP 服务借跳转盲打桥接受信接口的路堵上", async t => {
  // 服务把回应 307 到 127.0.0.1 的受信接口时，Node 的 fetch 会跟着跳、保留方法与正文，
  // 且不带 Origin——桥接自己分不出来，只认这个标记。三种出口（http 的 POST 与 DELETE、sse 的两处）
  // 一个漏了就等于没有。
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    seen.push({ url: String(url), headers: init?.headers || {} });
    if (String(url).endsWith("/sse")) return legacyStream(init.signal).response;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s1" } });
  });
  const http = createTransport({ url: "http://127.0.0.1:1/mcp" });
  await http.send({ jsonrpc: "2.0", id: 1, method: "initialize" });
  http.close();
  const sse = createTransport({ url: "http://127.0.0.1:1/sse", type: "sse" });
  try {
    await sse.start();
    await sse.send({ jsonrpc: "2.0", id: 2, method: "initialize" });
  } finally {
    sse.close();
  }
  assert.ok(seen.length >= 4, `出口没走全：${seen.map(item => item.url).join(" ")}`);
  for (const item of seen) assert.equal(item.headers[OUTBOUND_MARK], "1", `${item.url} 漏了标记`);
});

test("MCP 工具持续发进度也不能跨过绝对超时上限", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_700_000_000_000 });
  const client = new McpClient({ name: "test", config: {}, version: "0", toolEnv: env => env });
  let id;
  client.transport = {
    send: async message => {
      if (message.id !== undefined) id = message.id;
    },
    abort() {}
  };
  const pending = client.request("tools/call", {}, 30);
  for (let i = 0; i < 5; i++) {
    t.mock.timers.tick(10);
    client.receive({ method: "notifications/progress", params: { progressToken: id } });
  }
  t.mock.timers.tick(10);
  await assert.rejects(pending, /超时：已达绝对时限.*距上次进度 0 秒/, "持续进度应按绝对上限终止，并注明最近进度");
  assert.equal(client.pending.size, 0);
});

test("旧式 SSE transport 的 abort 是 AbortController，超时不得把它当函数调用", async () => {
  const client = new McpClient({ name: "test", config: {}, version: "0", toolEnv: env => env });
  const transport = { abort: new AbortController(), send: async () => {} };
  client.transport = transport;
  await assert.rejects(client.request("tools/call", {}, 10), /超时/);
  assert.equal(client.pending.size, 0, "超时应正常结清，而不是被 TypeError 打断");
  assert.equal(transport.abort.signal.aborted, false, "单条请求超时不能关闭整个 SSE 连接");
});

test("旧式 SSE：超时只取消本次 POST，关闭时取消其余投递和 GET", async t => {
  const signals = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    signals.push(init.signal);
    if (!init.method) return legacyStream(init.signal).response;
    return waitForAbort(init.signal);
  });
  const transport = createTransport({ url: "http://127.0.0.1:1/sse", type: "sse" });
  const closed = [];
  transport.onclose = error => closed.push(error);
  await transport.start();
  const client = new McpClient({ name: "test", config: {}, version: "0", toolEnv: env => env });
  client.transport = transport;
  const other = transport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  const otherRejected = assert.rejects(other, /aborted/i);
  try {
    await assert.rejects(client.request("tools/call", {}, 10), /超时/);
    assert.equal(signals[2].aborted, true);
    assert.equal(signals[1].aborted, false);
    assert.equal(signals[0].aborted, false);
  } finally {
    transport.close();
    await otherRejected;
  }
  transport.close();
  await tick();
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, true);
  assert.deepEqual(closed, [], "主动关闭及其引起的读取错误不再回报断线");
});

test("旧式 SSE：未收到 endpoint 就结束时立即拒绝握手", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(""));
  const transport = createTransport({ url: "http://127.0.0.1:1/sse", type: "sse" });
  await assert.rejects(transport.start(), /事件流已断开/);
});

for (const [mode, errorText] of [
  ["GET 正常结束", "事件流已断开"],
  ["GET 读取出错", "读取连接失败"],
  ["POST 等到握手上限", "notifications/initialized 超时"]
])
  test(`旧式 SSE：${mode}时，结清所有投递并返回 MCP 清单`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const base = "http://127.0.0.1:1";
    let stream, getSignal, status, result;
    const posts = [];
    t.mock.method(globalThis, "fetch", async (url, init) => {
      if (url === `${base}/sse`) {
        getSignal = init.signal;
        return (stream = legacyStream(getSignal)).response;
      }
      const { id, method } = JSON.parse(init.body);
      if (url === `${base}/http`) {
        if (method === "notifications/initialized") return new Response(null, { status: 202 });
        const result = method === "tools/list" ? { tools: [{ name: "read" }] } : { protocolVersion: "2025-06-18" };
        return Response.json({ jsonrpc: "2.0", id, result });
      }
      posts.push({ method, signal: init.signal });
      // initialize 的 RPC 回复已经从 GET 到达，但它的 POST 与无编号通知的 POST 都还没收到回执。
      if (method === "initialize") {
        const reply = { jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18" } };
        stream.write(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
      }
      return waitForAbort(init.signal);
    });
    const { routes } = createMcp({ version: "0", toolEnv: env => env });
    const list = (servers, res) => routes["POST /api/mcp/list"](Readable.from([Buffer.from(JSON.stringify({ servers }))]), res);
    const res = {
      writeHead(code) {
        status = code;
      },
      end(text) {
        result = JSON.parse(text);
      }
    };
    const listing = list({ legacy: { url: `${base}/sse`, type: "sse" }, healthy: { url: `${base}/http` } }, res);
    try {
      await tick();
      assert.deepEqual(
        posts.map(post => post.method),
        ["initialize", "notifications/initialized"]
      );
      assert.ok(!getSignal.aborted && posts.every(post => !post.signal.aborted));
      assert.equal(status, undefined, "通知尚未收到回执，不能提前完成握手");
      if (mode === "GET 正常结束") stream.end();
      else if (mode === "GET 读取出错") stream.fail(Error(errorText));
      else {
        t.mock.timers.tick(59999);
        await tick();
        assert.equal(status, undefined, "通知享有同样的握手等待上限");
        t.mock.timers.tick(1);
      }
      await tick();
      assert.equal(status, 200, "断线或超时都须结清正在等待的 MCP 清单");
      await listing;
      assert.deepEqual(result.servers.legacy, { ok: false, error: errorText });
      assert.equal(result.servers.healthy.tools[0].name, "read");
      assert.equal(getSignal.aborted, true);
      assert.ok(
        posts.every(post => post.signal.aborted),
        "无论 POST 是否有编号，都要收掉"
      );
    } finally {
      await list({}, { writeHead() {}, end() {} });
      await listing;
    }
  });

for (const type of ["http", "sse"])
  test(`MCP ${type}：服务端同编号请求的回执不占用本机请求的取消开关`, async t => {
    const signals = [];
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      if (!init.method) return legacyStream(init.signal).response;
      signals.push(init.signal);
      return waitForAbort(init.signal);
    });
    const transport = createTransport({ url: "http://127.0.0.1:1/mcp", type });
    await transport.start();
    const client = new McpClient({ name: "test", config: {}, version: "0", toolEnv: env => env });
    client.transport = transport;
    try {
      const pending = client.request("tools/call", {}, 20, 17);
      client.receive({ jsonrpc: "2.0", id: 17, method: "ping" });
      await assert.rejects(pending, /超时/);
      assert.equal(signals.length, 3);
      assert.equal(signals[0].aborted, true);
      assert.equal(signals[1].aborted, false);
    } finally {
      transport.close();
    }
    assert.equal(signals[1].aborted, true);
  });
