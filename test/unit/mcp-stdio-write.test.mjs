import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createTransport } = require("../../server/mcp/transports.js");

test("stdio 输入管道错误关闭会话，后续发送不再假装成功", async () => {
  const transport = createTransport({ command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] });
  const closed = new Promise(resolve => { transport.onclose = resolve; });
  await transport.start();
  try {
    transport.child.stdin.destroy(Error("test pipe failure"));
    assert.match((await closed).message, /test pipe failure/);
    await assert.rejects(transport.send({ jsonrpc: "2.0", id: 1 }), /标准输入已关闭/);
  } finally {
    transport.close();
  }
});

test("stdio send 等待写入回调并传播错误", async () => {
  const transport = createTransport({ command: process.execPath });
  let callback;
  transport.child = { stdin: { writableLength: 0, write(_line, cb) { callback = cb; } } };
  let done = false;
  const pending = transport.send({ id: 1 }).then(() => { done = true; });
  await Promise.resolve();
  assert.equal(done, false);
  callback();
  await pending;
  assert.equal(done, true);
  const failed = transport.send({ id: 2 });
  callback(Error("write failed"));
  await assert.rejects(failed, /write failed/);
});
