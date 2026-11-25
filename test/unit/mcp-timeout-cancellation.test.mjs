import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { McpClient } = require("../../server/mcp/client.js");
const { createTransport } = require("../../server/mcp/transports.js");

test("工具超时与主动停止各发送一次对应的取消通知", async () => {
  const client = new McpClient({ name: "test", config: {}, version: "0", toolEnv: env => env });
  const sent = [];
  client.transport = {
    send: async message => {
      sent.push(message);
    },
    abort() {}
  };
  const controller = new AbortController();
  await assert.rejects(client.call("read", {}, { timeout: 15, signal: controller.signal }), /超时/);
  controller.abort();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].method, "notifications/cancelled");
  assert.equal(sent[1].params.requestId, sent[0].id);
  assert.match(sent[1].params.reason, /超时/);
  const stop = new AbortController();
  const call = client.call("read", {}, { signal: stop.signal });
  stop.abort();
  await assert.rejects(call, /已停止/);
  assert.equal(sent.length, 4);
  assert.equal(sent[3].params.requestId, sent[2].id);
  assert.equal(sent[3].params.reason, "用户停止");
  assert.equal(client.pending.size, 0);
});

for (const type of ["http", "sse"])
  test(`MCP ${type}：取消通知的投递有独立时限，不积压连接`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const signals = [];
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      if (!init.method) return new Response("event: endpoint\\ndata: /messages\\n\\n");
      signals.push(init.signal);
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    });
    const transport = createTransport({ url: "http://127.0.0.1:1/mcp", type });
    // 旧式 SSE 的 GET 要保持连接；只测已经握手后的 POST，不启动 GET。
    if (type === "sse") transport.endpoint = "http://127.0.0.1:1/messages";
    const pending = transport.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } });
    const rejected = assert.rejects(pending, /aborted/i);
    try {
      t.mock.timers.tick(4999);
      assert.equal(signals[0].aborted, false);
      t.mock.timers.tick(1);
      await rejected;
      assert.equal(signals[0].aborted, true);
      assert.equal((transport.aborts || transport.posts).size, 0);
    } finally {
      transport.close();
    }
  });
