import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import { probeTestPort } from "../helpers/test-ports.mjs";

test("测试端口预检拒绝不说 HTTP 的 TCP 监听者，且不占住可用端口", async () => {
  const listener = createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const { port } = listener.address();
  try {
    await assert.rejects(probeTestPort(port), { code: "EADDRINUSE" });
  } finally {
    await new Promise(resolve => listener.close(resolve));
  }
  await probeTestPort(port);
  await probeTestPort(port);
});
