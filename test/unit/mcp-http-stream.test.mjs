// 可流式 HTTP 的 MCP：回复走事件流时，close() 要掐得到还在读的流；流半路断了，等回复的那一问当场落空，不干等到超时
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createTransport, readEvents } = require("../../server/mcp/transports.js");
const { McpClient } = require("../../server/mcp/client.js");
const { OUTBOUND_MARK } = require("../../server/web.js");

// 一个回事件流的假服务：流先不结束，由测试决定何时出错
function fakeStream() {
  let controller;
  const body = new ReadableStream({ start: c => (controller = c) });
  const response = new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  return { response, fail: error => controller.error(error) };
}
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
  assert.equal(signals.length, 1);
  assert.equal(signals[0].aborted, true, "超时之后要掐掉还在读的正文");
});

test("出站请求都带标记：MCP 服务借跳转盲打桥接受信接口的路堵上", async t => {
  // 服务把回应 307 到 127.0.0.1 的受信接口时，Node 的 fetch 会跟着跳、保留方法与正文，
  // 且不带 Origin——桥接自己分不出来，只认这个标记。三种出口（http 的 POST 与 DELETE、sse 的两处）
  // 一个漏了就等于没有。
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    seen.push({ url: String(url), headers: init?.headers || {} });
    if (String(url).endsWith("/sse")) {
      return new Response([Buffer.from("event: endpoint\ndata: /messages\n\n")], {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s1" } });
  });
  const http = createTransport({ url: "http://127.0.0.1:1/mcp" });
  await http.send({ jsonrpc: "2.0", id: 1, method: "initialize" });
  http.close();
  const sse = createTransport({ url: "http://127.0.0.1:1/sse", type: "sse" });
  sse.onclose = () => {};
  await sse.start();
  await sse.send({ jsonrpc: "2.0", id: 2, method: "initialize" });
  assert.ok(seen.length >= 4, `出口没走全：${seen.map(item => item.url).join(" ")}`);
  for (const item of seen) assert.equal(item.headers[OUTBOUND_MARK], "1", `${item.url} 漏了标记`);
});

test("MCP 工具持续发进度也不能跨过绝对超时上限", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_700_000_000_000 });
  const client = new McpClient({ name: "test", config: {}, version: "0", toolEnv: env => env });
  let id;
  client.transport = { send: async message => { id = message.id; }, abort() {} };
  const pending = client.request("tools/call", {}, 30);
  for (let i = 0; i < 5; i++) {
    t.mock.timers.tick(10);
    client.receive({ method: "notifications/progress", params: { progressToken: id } });
  }
  t.mock.timers.tick(10);
  await assert.rejects(pending, /超时/, "持续进度不得无限重置原本的超时限制");
  assert.equal(client.pending.size, 0);
});
