import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { McpClient } = require("../../server/mcp/client.js");

test("工具超时与主动停止各发送一次对应的取消通知", async () => {
  const client = new McpClient({ name: "test", config: {}, version: "0", toolEnv: env => env });
  const sent = [];
  client.transport = { send: async message => { sent.push(message); }, abort() {} };
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
