import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";

const { createTransport, SseTransport } = createRequire(import.meta.url)("../../server/mcp/transports.js");

const listen = async server => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
};
const close = server => new Promise(resolve => server.close(resolve));

test("HTTP MCP 的 307 重定向不能转发自定义凭据到另一个端口", async () => {
  let leaked = 0;
  const target = http.createServer((req, res) => {
    leaked++;
    res.end();
  });
  const targetUrl = await listen(target);
  const redirector = http.createServer((req, res) => {
    res.writeHead(307, { Location: targetUrl + "/capture" });
    res.end();
  });
  const redirectUrl = await listen(redirector);
  try {
    const transport = createTransport({ url: redirectUrl + "/mcp", headers: { "X-Private-Token": "sentinel" } });
    await assert.rejects(() => transport.send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }));
    assert.equal(leaked, 0, "被重定向的服务器绝不能收到机密头");
    transport.close();
  } finally {
    await close(redirector);
    await close(target);
  }
});

test("旧式 SSE 拒绝跨源 endpoint 通知", async t => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response("event: endpoint\ndata: http://127.0.0.1:65534/messages\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      })
  );
  const transport = new SseTransport({ url: "https://example.invalid/sse", headers: { "X-Private-Token": "sentinel" } });
  await assert.rejects(() => transport.start(), /不能跨源/);
  transport.close();
});
